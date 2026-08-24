/**
 * Integration tests for worker.ts queue handler and scheduled handler.
 *
 * Queue handler tests — ack/retry mapping via SectionCheckOutcome:
 * - processSection returns { disposition: 'ack', result: { success: true } }  → message.ack()
 * - processSection returns { disposition: 'retry', result: { success: false } } → message.retry() (DB upsert error)
 * - processSection returns { disposition: 'ack', httpStatus: 200 } (AuthError/NotFound) → message.ack()
 * - processSection returns { disposition: 'retry', httpStatus: 429 } (RateLimit) → message.retry()
 * - processSection returns { disposition: 'retry', httpStatus: 502 } (ApiError) → message.retry()
 * - processSection throws unknown Error → message.retry() (defensive)
 *
 * Scheduled handler tests — cron routing, headers, no-throw, and 207 logging.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { ClassCheckMessage } from '@/lib/types/queue';
import type { Env } from '@/lib/types/env';

// ── Module mocks (must be hoisted above imports) ──────────────────────────────

// Mock cloudflare:workers DurableObject base class used by CronLockDO
vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {
    constructor(
      // eslint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: test mock mirrors DurableObject constructor which accepts unknown at I/O boundary
      protected ctx: unknown,
      // eslint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: test mock mirrors DurableObject constructor which accepts unknown at I/O boundary
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

// Mock processSection — core of queue handler tests
const mockProcessSection = vi.fn();
vi.mock('@/lib/queue/process-section', () => ({
  processSection: (...args: unknown[]) => mockProcessSection(...args),
}));

// Mock the DB client so worker.ts module-level setConnectionStringGetter call
// doesn't import the real `pg` driver (which would attempt a real pool).
vi.mock('@/lib/db/client', () => ({
  setConnectionStringGetter: vi.fn(),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

// Import worker default export for scheduled handler tests
// (queue handler tests re-import inside beforeEach so vi.mock hoisting applies cleanly)
const workerModule = await import('@/worker');
const workerDefault = workerModule.default;

// Import the vinext handler mock so scheduled handler tests can control fetch responses
const handlerMock = await import('vinext/server/app-router-entry');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMessage(class_nbr: string, term = '2261') {
  return {
    body: {
      class_nbr,
      term,
      enqueued_at: new Date().toISOString(),
    },
    ack: vi.fn(),
    retry: vi.fn(),
  } satisfies {
    body: ClassCheckMessage;
    ack: ReturnType<typeof vi.fn>;
    retry: ReturnType<typeof vi.fn>;
  };
}

function makeBatch(
  messages: ReturnType<typeof makeMessage>[],
  queue = 'pickmyclass-queue'
): MessageBatch<ClassCheckMessage> {
  // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double needs unknown to satisfy tsc overlap for minimal MessageBatch mock
  const raw: unknown = {
    queue,
    messages,
  };
  // eslint-disable-next-line anti-slop/no-widen-then-assert -- SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
  return raw as MessageBatch<ClassCheckMessage>;
}

const successOutcome = (classNbr: string) => ({
  disposition: 'ack' as const,
  result: {
    success: true,
    classNbr,
    changes: {
      seatBecameAvailable: false,
      seatsFilled: false,
      instructorAssigned: false,
      newOpenSeats: 0,
    },
    emailsSent: 0,
    processingTimeMs: 10,
  },
  httpStatus: 200 as const,
  retryable: false as const,
});

const dbFailOutcome = (classNbr: string) => ({
  disposition: 'retry' as const,
  result: {
    success: false,
    classNbr,
    changes: {
      seatBecameAvailable: false,
      seatsFilled: false,
      instructorAssigned: false,
      newOpenSeats: 0,
    },
    emailsSent: 0,
    processingTimeMs: 10,
    error: 'duplicate key value violates unique constraint',
  },
  httpStatus: 500 as const,
  retryable: true as const,
});

const authErrorOutcome = (classNbr: string) => ({
  disposition: 'ack' as const,
  result: {
    success: false,
    classNbr,
    changes: {
      seatBecameAvailable: false,
      seatsFilled: false,
      instructorAssigned: false,
      newOpenSeats: 0,
    },
    emailsSent: 0,
    processingTimeMs: 10,
    error: '401 Unauthorized from ASU',
  },
  httpStatus: 200 as const,
  retryable: false as const,
});

const notFoundOutcome = (classNbr: string) => ({
  disposition: 'ack' as const,
  result: {
    success: false,
    classNbr,
    changes: {
      seatBecameAvailable: false,
      seatsFilled: false,
      instructorAssigned: false,
      newOpenSeats: 0,
    },
    emailsSent: 0,
    processingTimeMs: 10,
    error: 'Section 99999 not found',
  },
  httpStatus: 200 as const,
  retryable: false as const,
});

const rateLimitOutcome = (classNbr: string) => ({
  disposition: 'retry' as const,
  result: {
    success: false,
    classNbr,
    changes: {
      seatBecameAvailable: false,
      seatsFilled: false,
      instructorAssigned: false,
      newOpenSeats: 0,
    },
    emailsSent: 0,
    processingTimeMs: 10,
    error: 'Rate limit exceeded',
  },
  httpStatus: 429 as const,
  retryable: true as const,
});

const apiErrorOutcome = (classNbr: string) => ({
  disposition: 'retry' as const,
  result: {
    success: false,
    classNbr,
    changes: {
      seatBecameAvailable: false,
      seatsFilled: false,
      instructorAssigned: false,
      newOpenSeats: 0,
    },
    emailsSent: 0,
    processingTimeMs: 10,
    error: 'ASU API 502 Bad Gateway',
  },
  httpStatus: 502 as const,
  retryable: true as const,
});

// SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
const mockEnv = {
  CRON_SECRET: 'test-secret',
  ASU_API_BASE_URL: 'https://api.asu.edu',
  ASU_API_TOKEN: 'test-token',
  EMAIL: {},
  NOTIFICATION_FROM_EMAIL: 'no-reply@test.com',
} as Parameters<(typeof import('@/worker'))['default']['queue']>[1];

// eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double needs unknown to satisfy tsc overlap for minimal ExecutionContext mock
const rawTestCtx: unknown = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
};
// eslint-disable-next-line anti-slop/no-widen-then-assert -- SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
const testCtx = rawTestCtx as ExecutionContext;

describe('worker queue handler — direct processSection call ack/retry mapping', () => {
  let worker: (typeof import('@/worker'))['default'];

  beforeEach(async () => {
    vi.clearAllMocks();
    // Import inside beforeEach so vi.mock hoisting is applied each time
    const mod = await import('@/worker');
    worker = mod.default;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('acks message when processSection returns ack (success:true)', async () => {
    mockProcessSection.mockResolvedValue(successOutcome('12345'));

    const msg = makeMessage('12345');
    // SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
    await worker.queue(makeBatch([msg]), mockEnv, {} as ExecutionContext);

    expect(msg.ack).toHaveBeenCalledOnce();
    expect(msg.retry).not.toHaveBeenCalled();
    expect(mockProcessSection).toHaveBeenCalledWith(
      expect.objectContaining({ class_nbr: '12345', term: '2261' }),
      mockEnv
    );
  });

  it('retries message when processSection returns retry (DB upsert error)', async () => {
    mockProcessSection.mockResolvedValue(dbFailOutcome('12345'));

    const msg = makeMessage('12345');
    // SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
    await worker.queue(makeBatch([msg]), mockEnv, {} as ExecutionContext);

    expect(msg.retry).toHaveBeenCalledOnce();
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it('acks message when processSection returns ack for AuthError (non-retryable)', async () => {
    mockProcessSection.mockResolvedValue(authErrorOutcome('12345'));

    const msg = makeMessage('12345');
    // SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
    await worker.queue(makeBatch([msg]), mockEnv, {} as ExecutionContext);

    expect(msg.ack).toHaveBeenCalledOnce();
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it('acks message when processSection returns ack for NotFoundError (non-retryable)', async () => {
    mockProcessSection.mockResolvedValue(notFoundOutcome('99999'));

    const msg = makeMessage('99999');
    // SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
    await worker.queue(makeBatch([msg]), mockEnv, {} as ExecutionContext);

    expect(msg.ack).toHaveBeenCalledOnce();
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it('retries message when processSection returns retry for RateLimitError', async () => {
    mockProcessSection.mockResolvedValue(rateLimitOutcome('12345'));

    const msg = makeMessage('12345');
    // SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
    await worker.queue(makeBatch([msg]), mockEnv, {} as ExecutionContext);

    expect(msg.retry).toHaveBeenCalledOnce();
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it('retries message when processSection returns retry for ApiError (upstream failure)', async () => {
    mockProcessSection.mockResolvedValue(apiErrorOutcome('12345'));

    const msg = makeMessage('12345');
    // SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
    await worker.queue(makeBatch([msg]), mockEnv, {} as ExecutionContext);

    expect(msg.retry).toHaveBeenCalledOnce();
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it('retries message when processSection throws unknown error (defensive)', async () => {
    mockProcessSection.mockRejectedValue(new Error('Unexpected internal error'));

    const msg = makeMessage('12345');
    // SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
    await worker.queue(makeBatch([msg]), mockEnv, {} as ExecutionContext);

    expect(msg.retry).toHaveBeenCalledOnce();
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it('processes multiple messages concurrently with independent ack/retry per message', async () => {
    mockProcessSection
      .mockResolvedValueOnce(successOutcome('11111'))
      .mockResolvedValueOnce(rateLimitOutcome('22222'))
      .mockResolvedValueOnce(dbFailOutcome('33333'));

    const msg1 = makeMessage('11111');
    const msg2 = makeMessage('22222');
    const msg3 = makeMessage('33333');

    // SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
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
    // SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
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

    // SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
    await workerDefault.scheduled(
      { cron: '0 4 * * *', scheduledTime: Date.now() },
      scheduledEnv as Env,
      testCtx
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
    const calledRequest = fetchSpy.mock.calls[0]![0] as Request;
    expect(calledRequest.url).toContain('/api/cron/update-disposable-domains');
    expect(calledRequest.headers.get('Authorization')).toBe('Bearer test-cron-secret');
  });

  it('routes all other cron patterns to /api/cron', async () => {
    const fetchSpy = vi
      .spyOn(handlerMock.default, 'fetch')
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    // SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
    await workerDefault.scheduled(
      { cron: '0,30 * * * *', scheduledTime: Date.now() },
      scheduledEnv as Env,
      testCtx
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
    const calledRequest = fetchSpy.mock.calls[0]![0] as Request;
    expect(calledRequest.url).toBe('http://localhost/api/cron');
  });

  it('passes X-Cron-Scheduled-Time header with scheduled time', async () => {
    const scheduledTime = 1718446800000; // fixed timestamp
    const fetchSpy = vi
      .spyOn(handlerMock.default, 'fetch')
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    // SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
    await workerDefault.scheduled(
      { cron: '0,30 * * * *', scheduledTime },
      scheduledEnv as Env,
      testCtx
    );

    // SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
    const calledRequest = fetchSpy.mock.calls[0]![0] as Request;
    expect(calledRequest.headers.get('X-Cron-Scheduled-Time')).toBe(String(scheduledTime));
  });

  it('does not throw when handler returns error status', async () => {
    vi.spyOn(handlerMock.default, 'fetch').mockResolvedValueOnce(
      new Response('Internal error', { status: 500 })
    );

    await expect(
      // SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
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
      // SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
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

    // SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
    await workerDefault.scheduled(
      { cron: '0,30 * * * *', scheduledTime: Date.now() },
      scheduledEnv as Env,
      testCtx
    );

    // The scoped logger emits the scope separately from the greppable tag.
    expect(errSpy).toHaveBeenCalledWith(
      '[Scheduled]',
      expect.stringMatching(/CRON_PARTIAL_FAILURE/),
      207,
      'body:',
      'partial'
    );

    errSpy.mockRestore();
  });
});
