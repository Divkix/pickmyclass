import { describe, expect, it } from 'vite-plus/test';
import { makeFakeCtx } from '../../mocks/cloudflare-workers';

const workerModule = await import('@/worker');
const { CronLockDO } = workerModule;

function makeDO() {
  return new CronLockDO(makeFakeCtx(), {} as Cloudflare.Env);
}

describe('CronLockDO adapter', () => {
  it('preserves the named, default, and tree-shaking-guard exports', () => {
    expect(workerModule.default.CronLockDO).toBe(CronLockDO);
    expect(workerModule.__durableObjectExports.CronLockDO).toBe(CronLockDO);
  });

  it('dispatches acquire, status, and release through the lifecycle', async () => {
    const lock = makeDO();

    const acquire = await lock.fetch(
      new Request('http://localhost/acquire?holder=cron%20run%2F1', { method: 'POST' })
    );
    const status = await lock.fetch(new Request('http://localhost/status'));
    const release = await lock.fetch(
      new Request('http://localhost/release?holder=cron%20run%2F1', { method: 'POST' })
    );

    await expect(acquire.json()).resolves.toMatchObject({
      acquired: true,
      lockHolder: 'cron run/1',
    });
    await expect(status.json()).resolves.toMatchObject({
      locked: true,
      lockHolder: 'cron run/1',
    });
    await expect(release.json()).resolves.toMatchObject({ released: true });
  });

  it.each(['/acquire', '/release'])('rejects GET %s', async (path) => {
    const response = await makeDO().fetch(new Request(`http://localhost${path}`));

    expect(response.status).toBe(405);
  });

  it('returns 404 for unknown operations', async () => {
    const response = await makeDO().fetch(new Request('http://localhost/unknown'));

    expect(response.status).toBe(404);
  });

  it('uses the HTTP adapter holder default', async () => {
    const response = await makeDO().fetch(
      new Request('http://localhost/acquire', { method: 'POST' })
    );

    await expect(response.json()).resolves.toMatchObject({ lockHolder: 'http-request' });
  });

  it('persists lifecycle state through the Durable Object storage adapter', async () => {
    const ctx = makeFakeCtx();
    const lock = new CronLockDO(ctx, {} as Cloudflare.Env);

    await lock.acquireLock('worker-a');
    await expect(ctx.storage.get('lock_state')).resolves.toMatchObject({
      locked: true,
      lockHolder: 'worker-a',
    });

    await lock.releaseLock('worker-a');
    await expect(ctx.storage.get('lock_state')).resolves.toMatchObject({ locked: false });
  });
});
