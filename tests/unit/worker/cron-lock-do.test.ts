/**
 * Unit tests for CronLockDO — the distributed cron lock Durable Object.
 *
 * Uses a fake Map-backed DurableObjectState so tests run without
 * a real Workers runtime. Fake timers drive the 25-minute expiry.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

// cloudflare:workers is aliased in vitest.config.ts to tests/mocks/cloudflare-workers.ts.
// The alias makes DurableObject available automatically — no vi.mock needed here.
// Import makeFakeCtx directly from the mock for constructing test instances.
import { makeFakeCtx } from '../../mocks/cloudflare-workers';

// Import CronLockDO after the alias is in place so it resolves the base class correctly.
const { CronLockDO } = await import('@/worker');

// 25 minutes in milliseconds — must match LOCK_TIMEOUT_MS in worker.ts
const LOCK_TIMEOUT_MS = 25 * 60 * 1000;

function makeDO() {
  const ctx = makeFakeCtx();
  // env cast: CronLockDO only needs ctx for these tests
  const do_ = new CronLockDO(ctx, {} as Cloudflare.Env);
  return do_;
}

describe('CronLockDO', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Lock acquisition ──────────────────────────────────────────────────────

  describe('acquireLock', () => {
    it('returns acquired:true when lock is free', async () => {
      const do_ = makeDO();
      const result = await do_.acquireLock('worker-a');

      expect(result.acquired).toBe(true);
      expect(result.lockHolder).toBe('worker-a');
    });

    it('returns acquired:false when lock is already held', async () => {
      const do_ = makeDO();
      await do_.acquireLock('worker-a');

      const result = await do_.acquireLock('worker-b');

      expect(result.acquired).toBe(false);
      expect(result.lockHolder).toBe('worker-a');
    });

    it('uses "unknown" as default holder when none is provided', async () => {
      const do_ = makeDO();
      const result = await do_.acquireLock();

      expect(result.acquired).toBe(true);
      expect(result.lockHolder).toBe('unknown');
    });
  });

  // ── Lock expiry ───────────────────────────────────────────────────────────

  describe('lock expiry (LOCK_TIMEOUT_MS = 25 min)', () => {
    it('denies acquisition before timeout elapses', async () => {
      const do_ = makeDO();
      await do_.acquireLock('worker-a');

      // Advance just under the timeout
      vi.advanceTimersByTime(LOCK_TIMEOUT_MS - 1);

      const result = await do_.acquireLock('worker-b');
      expect(result.acquired).toBe(false);
    });

    it('auto-expires the stale lock and grants acquisition after timeout', async () => {
      const do_ = makeDO();
      await do_.acquireLock('worker-a');

      // Advance past the timeout
      vi.advanceTimersByTime(LOCK_TIMEOUT_MS);

      const result = await do_.acquireLock('worker-b');
      expect(result.acquired).toBe(true);
      expect(result.lockHolder).toBe('worker-b');
    });
  });

  // ── Lock release ──────────────────────────────────────────────────────────

  describe('releaseLock', () => {
    it('returns released:false when lock is not held', async () => {
      const do_ = makeDO();
      const result = await do_.releaseLock('worker-a');

      expect(result.released).toBe(false);
    });

    it('returns released:false when holder does not match', async () => {
      const do_ = makeDO();
      await do_.acquireLock('worker-a');

      const result = await do_.releaseLock('worker-b');

      expect(result.released).toBe(false);
    });

    it('returns released:true when correct holder releases', async () => {
      const do_ = makeDO();
      await do_.acquireLock('worker-a');

      const result = await do_.releaseLock('worker-a');

      expect(result.released).toBe(true);
    });

    it('lock is available for re-acquisition after correct release', async () => {
      const do_ = makeDO();
      await do_.acquireLock('worker-a');
      await do_.releaseLock('worker-a');

      const result = await do_.acquireLock('worker-b');
      expect(result.acquired).toBe(true);
    });
  });

  // ── getStatus ─────────────────────────────────────────────────────────────

  describe('getStatus', () => {
    it('returns unlocked status when no lock is held', async () => {
      const do_ = makeDO();
      const status = await do_.getStatus();

      expect(status.locked).toBe(false);
      expect(status.lockHolder).toBeNull();
      expect(status.lockAcquiredAt).toBeNull();
      expect(status.timeHeldMs).toBeNull();
      expect(status.expiresAt).toBeNull();
    });

    it('returns locked status with correct holder and timing', async () => {
      const do_ = makeDO();
      const acquiredAt = Date.now();
      await do_.acquireLock('worker-a');

      vi.advanceTimersByTime(5000); // 5 seconds later

      const status = await do_.getStatus();

      expect(status.locked).toBe(true);
      expect(status.lockHolder).toBe('worker-a');
      expect(status.lockAcquiredAt).toBe(acquiredAt);
      expect(status.timeHeldMs).toBe(5000);
      expect(status.expiresAt).toBe(acquiredAt + LOCK_TIMEOUT_MS);
    });

    it('auto-releases expired lock when getStatus is called', async () => {
      const do_ = makeDO();
      await do_.acquireLock('worker-a');

      vi.advanceTimersByTime(LOCK_TIMEOUT_MS);

      const status = await do_.getStatus();

      expect(status.locked).toBe(false);
      expect(status.lockHolder).toBeNull();
    });
  });

  // ── HTTP fetch dispatcher ─────────────────────────────────────────────────

  describe('fetch dispatcher', () => {
    it('POST /acquire returns acquire JSON', async () => {
      const do_ = makeDO();
      const req = new Request('http://localhost/acquire?holder=http-test', { method: 'POST' });
      const resp = await do_.fetch(req);

      expect(resp.status).toBe(200);
      const body = (await resp.json()) as { acquired: boolean; lockHolder: string };
      expect(body.acquired).toBe(true);
      expect(body.lockHolder).toBe('http-test');
    });

    it('GET /acquire returns 405', async () => {
      const do_ = makeDO();
      const req = new Request('http://localhost/acquire', { method: 'GET' });
      const resp = await do_.fetch(req);

      expect(resp.status).toBe(405);
    });

    it('POST /release returns release JSON', async () => {
      const do_ = makeDO();
      await do_.acquireLock('http-test');

      const req = new Request('http://localhost/release?holder=http-test', { method: 'POST' });
      const resp = await do_.fetch(req);

      expect(resp.status).toBe(200);
      const body = (await resp.json()) as { released: boolean };
      expect(body.released).toBe(true);
    });

    it('GET /release returns 405', async () => {
      const do_ = makeDO();
      const req = new Request('http://localhost/release', { method: 'GET' });
      const resp = await do_.fetch(req);

      expect(resp.status).toBe(405);
    });

    it('GET /status returns current status', async () => {
      const do_ = makeDO();
      const req = new Request('http://localhost/status', { method: 'GET' });
      const resp = await do_.fetch(req);

      expect(resp.status).toBe(200);
      const body = (await resp.json()) as { locked: boolean };
      expect(body.locked).toBe(false);
    });

    it('unknown path returns 404', async () => {
      const do_ = makeDO();
      const req = new Request('http://localhost/unknown-path', { method: 'GET' });
      const resp = await do_.fetch(req);

      expect(resp.status).toBe(404);
    });

    it('default holder is "http-request" when no holder query param provided', async () => {
      const do_ = makeDO();
      const req = new Request('http://localhost/acquire', { method: 'POST' });
      const resp = await do_.fetch(req);

      const body = (await resp.json()) as { lockHolder: string };
      expect(body.lockHolder).toBe('http-request');
    });
  });

  // ── State persistence ─────────────────────────────────────────────────────

  describe('state persistence', () => {
    it('persists lock state to durable storage on acquire', async () => {
      // The real CF Workers blockConcurrencyWhile blocks synchronously before the
      // DO becomes available. In Node/vitest, the async blockConcurrencyWhile runs
      // after the constructor returns, so we test persistence at the storage level
      // rather than across two DO instances.
      const ctx = makeFakeCtx();
      const do_ = new CronLockDO(ctx, {} as Cloudflare.Env);
      await do_.acquireLock('worker-a');

      // Verify the state was written to storage by reading it directly
      const stored = await ctx.storage.get<{
        locked: boolean;
        lockHolder: string | null;
      }>('lock_state');

      expect(stored?.locked).toBe(true);
      expect(stored?.lockHolder).toBe('worker-a');
    });

    it('persists unlocked state to durable storage on release', async () => {
      const ctx = makeFakeCtx();
      const do_ = new CronLockDO(ctx, {} as Cloudflare.Env);
      await do_.acquireLock('worker-a');
      await do_.releaseLock('worker-a');

      const stored = await ctx.storage.get<{ locked: boolean }>('lock_state');
      expect(stored?.locked).toBe(false);
    });
  });
});
