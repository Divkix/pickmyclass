/**
 * Integration tests for worker.ts queue handler and scheduled handler.
 *
 * Queue handler tests (plan 004) — direct-call ack/retry mapping:
 * - processSection returns { success: true }  → message.ack()
 * - processSection returns { success: false } → message.retry() (DB upsert error)
 * - processSection throws AuthError           → message.ack()  (non-retryable)
 * - processSection throws NotFoundError       → message.ack()  (non-retryable)
 * - processSection throws RateLimitError      → message.retry()
 * - processSection throws ApiError            → message.retry()
 * - processSection throws unknown Error       → message.retry()
 *
 * Scheduled handler tests — cron routing, headers, no-throw, and 207 logging.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { ClassCheckMessage, QueueMessageBatch } from '@/lib/types/queue';
import type { Env } from '@/lib/types/env';

// ── Module mocks (must be hoisted above imports) ──────────────────────────────

// Mock cloudflare:workers DurableObject base class used by CronLockDO
vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {
    constructor(
      protected ctx: unknown,
      protected env: unknown
    ) {}
  },
  env: {},
}));

// Mock handleDLQMessage so DLQ branch works without real email binding
const mockHandleDLQMessage = vi.fn();
vi.mock('@/lib/queue/dlq-consumer', () => ({
  handleDLQMessage: (...args: unknown[]) => mockHandleDLQMessage(...args),
}));

// Mock processSection — core of plan 004's queue handler tests
const mockProcessSection = vi.fn();
vi.mock('@/lib/queue/process-section', () => ({
  processSection: (...args: unknown[]) => mockProcessSection(...args),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { ApiError, AuthError, NotFoundError, RateLimitError } from '@/lib/asu/api';

// Import worker default export for scheduled handler tests
// (queue handler tests re-import inside beforeEach so vi.mock hoisting applies cleanly)
const workerModule = await import('@/worker');
const workerDefault = workerModule.default;

// Import the vinext handler mock so scheduled handler tests can control fetch responses
const handlerMock = await import('vinext/server/app-router-entry');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMessage(
  class_nbr: string,
  term = '2261'
): { body: ClassCheckMessage; ack: ReturnType<typeof vi.fn>; retry: ReturnType<typeof vi.fn> } {
  return {
    body: {
      class_nbr,
      term,
      enqueued_at: new Date().toISOString(),
      stagger_group: 'even',
    },
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

function makeBatch(
  messages: ReturnType<typeof makeMessage>[],
  queue = 'pickmyclass-queue'
): QueueMessageBatch {
  return {
    queue,
    messages: messages as unknown as QueueMessageBatch['messages'],
  };
}

const successResult = (classNbr: string) => ({
  success: true,
  classNbr,
  changes: { seatBecameAvailable: false, seatsFilled: false, instructorAssigned: false, newOpenSeats: 0 },
  emailsSent: 0,
  processingTimeMs: 10,
});

const dbFailResult = (classNbr: string) => ({
  success: false,
  classNbr,
  changes: { seatBecameAvailable: false, seatsFilled: false, instructorAssigned: false, newOpenSeats: 0 },
  emailsSent: 0,
  processingTimeMs: 10,
  error: 'duplicate key value violates unique constraint',
});

// Minimal env stub for queue handler tests
const mockEnv = {
  CRON_SECRET: 'test-secret',
  ASU_API_BASE_URL: 'https://api.asu.edu',
  ASU_API_TOKEN: 'test-token',
  EMAIL: {},
  NOTIFICATION_FROM_EMAIL: 'no-reply@test.com',
} as unknown as Parameters<(typeof import('@/worker'))['default']['queue']>[1];

// Minimal ExecutionContext stub
const testCtx = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
} as unknown as ExecutionContext;

// ── Queue handler tests (plan 004) ────────────────────────────────────────────

describe('worker queue handler — direct processSection call ack/retry mapping', () => {
  let worker: typeof import('@/worker')['default'];

  beforeEach(async () => {
    vi.clearAllMocks();
    // Import inside beforeEach so vi.mock hoisting is applied each time
    const mod = await import('@/worker');
    worker = mod.default;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('acks message when processSection returns success:true', async () => {
    mockProcessSection.mockResolvedValue(successResult('12345'));

    const msg = makeMessage('12345');
    await worker.queue(makeBatch([msg]), mockEnv, {} as ExecutionContext);

    expect(msg.ack).toHaveBeenCalledOnce();
    expect(msg.retry).not.toHaveBeenCalled();
    expect(mockProcessSection).toHaveBeenCalledWith('12345', '2261', mockEnv);
  });

  it('retries message when processSection returns success:false (DB upsert error)', async () => {
    mockProcessSection.mockResolvedValue(dbFailResult('12345'));

    const msg = makeMessage('12345');
    await worker.queue(makeBatch([msg]), mockEnv, {} as ExecutionContext);

    expect(msg.retry).toHaveBeenCalledOnce();
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it('acks message when processSection throws AuthError (non-retryable)', async () => {
    mockProcessSection.mockRejectedValue(new AuthError('401 Unauthorized from ASU'));

    const msg = makeMessage('12345');
    await worker.queue(makeBatch([msg]), mockEnv, {} as ExecutionContext);

    expect(msg.ack).toHaveBeenCalledOnce();
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it('acks message when processSection throws NotFoundError (non-retryable)', async () => {
    mockProcessSection.mockRejectedValue(new NotFoundError('Section 99999 not found'));

    const msg = makeMessage('99999');
    await worker.queue(makeBatch([msg]), mockEnv, {} as ExecutionContext);

    expect(msg.ack).toHaveBeenCalledOnce();
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it('retries message when processSection throws RateLimitError', async () => {
    mockProcessSection.mockRejectedValue(new RateLimitError('Rate limit exceeded'));

    const msg = makeMessage('12345');
    await worker.queue(makeBatch([msg]), mockEnv, {} as ExecutionContext);

    expect(msg.retry).toHaveBeenCalledOnce();
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it('retries message when processSection throws ApiError (upstream failure)', async () => {
    mockProcessSection.mockRejectedValue(new ApiError('ASU API 502 Bad Gateway', 502));

    const msg = makeMessage('12345');
    await worker.queue(makeBatch([msg]), mockEnv, {} as ExecutionContext);

    expect(msg.retry).toHaveBeenCalledOnce();
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it('retries message when processSection throws unknown error (defensive)', async () => {
    mockProcessSection.mockRejectedValue(new Error('Unexpected internal error'));

    const msg = makeMessage('12345');
    await worker.queue(makeBatch([msg]), mockEnv, {} as ExecutionContext);

    expect(msg.retry).toHaveBeenCalledOnce();
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it('processes multiple messages concurrently with independent ack/retry per message', async () => {
    mockProcessSection
      .mockResolvedValueOnce(successResult('11111'))
      .mockRejectedValueOnce(new RateLimitError('Rate limited'))
      .mockResolvedValueOnce(dbFailResult('33333'));

    const msg1 = makeMessage('11111');
    const msg2 = makeMessage('22222');
    const msg3 = makeMessage('33333');

    await worker.queue(makeBatch([msg1, msg2, msg3]), mockEnv, {} as ExecutionContext);

    // msg1: success → ack
    expect(msg1.ack).toHaveBeenCalledOnce();
    expect(msg1.retry).not.toHaveBeenCalled();

    // msg2: RateLimitError → retry
    expect(msg2.retry).toHaveBeenCalledOnce();
    expect(msg2.ack).not.toHaveBeenCalled();

    // msg3: success:false (DB error) → retry
    expect(msg3.retry).toHaveBeenCalledOnce();
    expect(msg3.ack).not.toHaveBeenCalled();
  });

  it('routes DLQ messages to DLQ handler without calling processSection', async () => {
    mockHandleDLQMessage.mockResolvedValue(undefined);

    const msg = makeMessage('12345');
    await worker.queue(makeBatch([msg], 'pickmyclass-dlq'), mockEnv, {} as ExecutionContext);

    // processSection should NOT be called for DLQ messages
    expect(mockProcessSection).not.toHaveBeenCalled();
    // DLQ messages are always acked
    expect(msg.ack).toHaveBeenCalledOnce();
  });
});

// ── Scheduled handler tests ───────────────────────────────────────────────────

describe('worker.ts scheduled handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const scheduledEnv: Partial<Env> = {
    CRON_SECRET: 'test-cron-secret',
  };

  it('routes "0 4 * * *" cron to /api/cron/update-disposable-domains', async () => {
    const fetchSpy = vi
      .spyOn(handlerMock.default, 'fetch')
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    await workerDefault.scheduled(
      { cron: '0 4 * * *', scheduledTime: Date.now() },
      scheduledEnv as Env,
      testCtx
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledRequest = fetchSpy.mock.calls[0]![0] as Request;
    expect(calledRequest.url).toContain('/api/cron/update-disposable-domains');
    expect(calledRequest.headers.get('Authorization')).toBe('Bearer test-cron-secret');
  });

  it('routes all other cron patterns to /api/cron', async () => {
    const fetchSpy = vi
      .spyOn(handlerMock.default, 'fetch')
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    await workerDefault.scheduled(
      { cron: '0,30 * * * *', scheduledTime: Date.now() },
      scheduledEnv as Env,
      testCtx
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledRequest = fetchSpy.mock.calls[0]![0] as Request;
    expect(calledRequest.url).toBe('http://localhost/api/cron');
  });

  it('passes X-Cron-Scheduled-Time header with scheduled time', async () => {
    const scheduledTime = 1718446800000; // fixed timestamp
    const fetchSpy = vi
      .spyOn(handlerMock.default, 'fetch')
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    await workerDefault.scheduled(
      { cron: '0,30 * * * *', scheduledTime },
      scheduledEnv as Env,
      testCtx
    );

    const calledRequest = fetchSpy.mock.calls[0]![0] as Request;
    expect(calledRequest.headers.get('X-Cron-Scheduled-Time')).toBe(String(scheduledTime));
  });

  it('does not throw when handler returns error status', async () => {
    vi.spyOn(handlerMock.default, 'fetch').mockResolvedValueOnce(
      new Response('Internal error', { status: 500 })
    );

    await expect(
      workerDefault.scheduled(
        { cron: '0,30 * * * *', scheduledTime: Date.now() },
        scheduledEnv as Env,
        testCtx
      )
    ).resolves.toBeUndefined();
  });

  it('does not throw when handler throws an error', async () => {
    vi.spyOn(handlerMock.default, 'fetch').mockRejectedValueOnce(new Error('Handler crashed'));

    await expect(
      workerDefault.scheduled(
        { cron: '0,30 * * * *', scheduledTime: Date.now() },
        scheduledEnv as Env,
        testCtx
      )
    ).resolves.toBeUndefined();
  });

  it('logs CRON_PARTIAL_FAILURE to console.error when cron response is 207', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.spyOn(handlerMock.default, 'fetch').mockResolvedValueOnce(
      new Response('partial', { status: 207 })
    );

    await workerDefault.scheduled(
      { cron: '0,30 * * * *', scheduledTime: Date.now() },
      scheduledEnv as Env,
      testCtx
    );

    // console.error is called with multiple args: ('[Scheduled] CRON_PARTIAL_FAILURE status:', 207, 'body:', 'partial')
    // Assert the first argument contains the greppable tag
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringMatching(/CRON_PARTIAL_FAILURE/),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );

    errSpy.mockRestore();
  });
});
