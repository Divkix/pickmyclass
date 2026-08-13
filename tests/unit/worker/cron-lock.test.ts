import { describe, expect, it, vi } from 'vite-plus/test';
import { createCronLockClient, createCronLockLifecycle } from '@/lib/worker/cron-lock';

// eslint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: test helper decodes unknown at I/O boundary; caller passes wire JSON
function createMemoryLock(initial: unknown = null) {
  let stored = initial;
  let now = Date.parse('2026-07-12T12:00:00.000Z');
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: test helper decodes unknown at I/O boundary; persists structuredClone of lock state
  const save = vi.fn(async (state: unknown) => {
    stored = structuredClone(state);
  });
  const lifecycle = createCronLockLifecycle(
    {
      load: async () => stored,
      save,
    },
    () => now
  );

  return {
    lifecycle,
    save,
    setNow(value: number) {
      now = value;
    },
    stored: () => stored,
  };
}

describe('cron lock lifecycle', () => {
  it('acquires, reports status, and releases only for the owning holder', async () => {
    const memory = createMemoryLock();
    await memory.lifecycle.initialize();

    const acquired = await memory.lifecycle.acquire('worker-a');
    const status = await memory.lifecycle.status();
    const wrongRelease = await memory.lifecycle.release('worker-b');
    const release = await memory.lifecycle.release('worker-a');

    expect(acquired).toMatchObject({ acquired: true, lockHolder: 'worker-a' });
    expect(status).toMatchObject({ locked: true, lockHolder: 'worker-a' });
    expect(status.expiresAt).toBeGreaterThan(status.lockAcquiredAt!);
    expect(wrongRelease).toMatchObject({ released: false });
    expect(release).toMatchObject({ released: true });
    await expect(memory.lifecycle.status()).resolves.toMatchObject({ locked: false });
  });

  it('denies another holder until the reported expiry and then grants it', async () => {
    const memory = createMemoryLock();
    await memory.lifecycle.initialize();
    await memory.lifecycle.acquire('worker-a');
    const status = await memory.lifecycle.status();

    memory.setNow(status.expiresAt! - 1);
    await expect(memory.lifecycle.acquire('worker-b')).resolves.toMatchObject({
      acquired: false,
      lockHolder: 'worker-a',
    });

    memory.setNow(status.expiresAt!);
    await expect(memory.lifecycle.acquire('worker-b')).resolves.toMatchObject({
      acquired: true,
      lockHolder: 'worker-b',
    });
  });

  it('expires stale persisted state during initialization', async () => {
    const memory = createMemoryLock({
      locked: true,
      lockAcquiredAt: Date.parse('2026-07-12T10:00:00.000Z'),
      lockHolder: 'dead-worker',
    });

    await memory.lifecycle.initialize();

    await expect(memory.lifecycle.status()).resolves.toEqual({
      locked: false,
      lockHolder: null,
      lockAcquiredAt: null,
      timeHeldMs: null,
      expiresAt: null,
    });
    expect(memory.save).toHaveBeenCalled();
  });

  it('normalizes corrupt persisted state instead of leaving a permanent lock', async () => {
    const memory = createMemoryLock({ locked: true, lockAcquiredAt: null, lockHolder: null });

    await memory.lifecycle.initialize();

    await expect(memory.lifecycle.acquire('worker-a')).resolves.toMatchObject({
      acquired: true,
      lockHolder: 'worker-a',
    });
  });
});

describe('cron lock client', () => {
  it('fails open with a no-op lease when the binding is absent', async () => {
    const client = createCronLockClient(undefined);

    const lease = await client.acquire('cron-run');

    expect(lease).toMatchObject({ configured: false, acquired: true });
    await expect(lease.release()).resolves.toBeUndefined();
    await expect(client.status()).resolves.toBeNull();
  });

  it('hides DO identity, internal URLs, wire parsing, and release behind a lease', async () => {
    const fetch = vi.fn(async (input: string) => {
      const url = input;
      if (url.includes('/acquire')) {
        return Response.json({
          acquired: true,
          message: 'Lock acquired successfully',
          lockHolder: 'cron run/1',
          lockedSince: 100,
        });
      }
      return Response.json({ released: true, message: 'Lock released' });
    });
    const idFromName = vi.fn(() => 'lock-id');
    // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double needs unknown to satisfy tsc overlap for minimal DurableObjectNamespace mock
    const rawNamespace: unknown = {
      idFromName,
      get: vi.fn(() => ({ fetch })),
    };
    // eslint-disable-next-line anti-slop/no-widen-then-assert -- SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
    const namespace = rawNamespace as DurableObjectNamespace;
    const client = createCronLockClient(namespace);

    const lease = await client.acquire('cron run/1');
    await lease.release();

    expect(idFromName).toHaveBeenCalledWith('pickmyclass-cron-lock');
    expect(fetch).toHaveBeenNthCalledWith(1, 'http://do/acquire?holder=cron%20run%2F1', {
      method: 'POST',
    });
    expect(fetch).toHaveBeenNthCalledWith(2, 'http://do/release?holder=cron%20run%2F1', {
      method: 'POST',
    });
    expect(lease).toMatchObject({ configured: true, acquired: true });
  });

  it('maps denial and status responses into shared semantics', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          acquired: false,
          message: 'already held',
          lockHolder: 'worker-a',
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          locked: true,
          lockHolder: 'worker-a',
          lockAcquiredAt: 100,
          timeHeldMs: 50,
          expiresAt: 200,
        })
      );
    // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double needs unknown to satisfy tsc overlap for minimal DurableObjectNamespace mock
    const rawNamespace: unknown = {
      idFromName: vi.fn(() => 'lock-id'),
      get: vi.fn(() => ({ fetch })),
    };
    // eslint-disable-next-line anti-slop/no-widen-then-assert -- SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
    const namespace = rawNamespace as DurableObjectNamespace;
    const client = createCronLockClient(namespace);

    await expect(client.acquire('worker-b')).resolves.toMatchObject({
      configured: true,
      acquired: false,
      currentHolder: 'worker-a',
    });
    await expect(client.status()).resolves.toEqual({
      locked: true,
      lockHolder: 'worker-a',
      lockAcquiredAt: 100,
      timeHeldMs: 50,
      expiresAt: 200,
    });
  });

  it('rejects malformed Durable Object responses', async () => {
    // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double needs unknown to satisfy tsc overlap for minimal DurableObjectNamespace mock
    const rawNamespace: unknown = {
      idFromName: vi.fn(() => 'lock-id'),
      get: vi.fn(() => ({ fetch: vi.fn(async () => Response.json({ nope: true })) })),
    };
    // eslint-disable-next-line anti-slop/no-widen-then-assert -- SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
    const namespace = rawNamespace as DurableObjectNamespace;

    await expect(createCronLockClient(namespace).acquire('worker-a')).rejects.toThrow(
      'Invalid cron lock response'
    );
  });

  it('surfaces release failures so callers can rely on auto-expiry', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ acquired: true, message: 'acquired', lockHolder: 'worker-a' })
      )
      .mockResolvedValueOnce(Response.json({ released: false, message: 'storage unavailable' }));
    // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double needs unknown to satisfy tsc overlap for minimal DurableObjectNamespace mock
    const rawNamespace: unknown = {
      idFromName: vi.fn(() => 'lock-id'),
      get: vi.fn(() => ({ fetch })),
    };
    // eslint-disable-next-line anti-slop/no-widen-then-assert -- SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
    const namespace = rawNamespace as DurableObjectNamespace;
    const lease = await createCronLockClient(namespace).acquire('worker-a');

    await expect(lease.release()).rejects.toThrow('storage unavailable');
  });
});
