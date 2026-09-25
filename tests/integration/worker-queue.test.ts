import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { ClassCheckMessage } from '@/lib/types/queue';

const mockProcessSection = vi.fn();

vi.mock('@/lib/queue/process-section', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queue/process-section')>()),
  processSection: (...args: unknown[]) => mockProcessSection(...args),
}));

const DB_HANDLE = { __dbHandle: 'queue-invocation-db' } as const;

const mockGetDb = vi.fn((_hyperdrive: CloudflareEnv['HYPERDRIVE']) => DB_HANDLE);

vi.mock('@/lib/db', () => ({
  getDb: (hyperdrive: CloudflareEnv['HYPERDRIVE']) => mockGetDb(hyperdrive),
}));

function makeMessage(class_nbr: string, term = '2261', attempts = 1) {
  return {
    id: `${class_nbr}-${term}`,
    timestamp: new Date(),
    attempts,
    body: {
      class_nbr,
      term,
      enqueued_at: new Date().toISOString(),
    },
    ack: vi.fn(),
    retry: vi.fn(),
  } satisfies Message<ClassCheckMessage>;
}

function makeBatch(messages: ReturnType<typeof makeMessage>[]): MessageBatch<ClassCheckMessage> {
  return {
    queue: 'pickmyclass-queue',
    messages,
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
    retryAll: vi.fn(),
    ackAll: vi.fn(),
  };
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

const rateLimitOutcome = (classNbr: string, retryAfterSeconds?: number) => ({
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
  retryAfterSeconds,
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

// SAFETY: the queue handler reads only HYPERDRIVE, EMAIL and NOTIFICATION_FROM_EMAIL.
const mockEnv = {
  ASU_API_BASE_URL: 'https://api.asu.edu',
  ASU_API_TOKEN: 'test-token',
  HYPERDRIVE: { connectionString: 'postgresql://hyperdrive.test/pickmyclass' },
  EMAIL: {},
  NOTIFICATION_FROM_EMAIL: 'no-reply@test.com',
} as Parameters<(typeof import('@/worker'))['default']['queue']>[1];

// SAFETY: worker.ts queue/scheduled declare `_ctx` and never read it (lines 174,215);
// no code under test reads or calls any member of this context double.
const testCtx = {} as ExecutionContext;

describe('worker queue handler — direct processSection call ack/retry mapping', () => {
  let worker: (typeof import('@/worker'))['default'];

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@/worker');
    worker = mod.default;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('acks message when processSection returns ack (success:true)', async () => {
    mockProcessSection.mockResolvedValue(successOutcome('12345'));

    const msg = makeMessage('12345');
    await worker.queue(makeBatch([msg]), mockEnv, testCtx);

    expect(msg.ack).toHaveBeenCalledOnce();
    expect(msg.retry).not.toHaveBeenCalled();
    expect(mockGetDb).toHaveBeenCalledTimes(1);
    expect(mockGetDb).toHaveBeenCalledWith(mockEnv.HYPERDRIVE);
    expect(mockProcessSection).toHaveBeenCalledWith(
      DB_HANDLE,
      expect.objectContaining({ class_nbr: '12345', term: '2261' }),
      mockEnv
    );
  });

  it('retries message when processSection returns retry (DB upsert error)', async () => {
    mockProcessSection.mockResolvedValue(dbFailOutcome('12345'));

    const msg = makeMessage('12345');
    await worker.queue(makeBatch([msg]), mockEnv, testCtx);

    // Non-429 retries fall back to the consumer's configured retry_delay.
    expect(msg.retry).toHaveBeenCalledWith(undefined);
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it('acks message when processSection returns ack for AuthError (non-retryable)', async () => {
    mockProcessSection.mockResolvedValue(authErrorOutcome('12345'));

    const msg = makeMessage('12345');
    await worker.queue(makeBatch([msg]), mockEnv, testCtx);

    expect(msg.ack).toHaveBeenCalledOnce();
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it('acks message when processSection returns ack for NotFoundError (non-retryable)', async () => {
    mockProcessSection.mockResolvedValue(notFoundOutcome('99999'));

    const msg = makeMessage('99999');
    await worker.queue(makeBatch([msg]), mockEnv, testCtx);

    expect(msg.ack).toHaveBeenCalledOnce();
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it('retries a rate-limited message with a delay that doubles per attempt', async () => {
    mockProcessSection.mockResolvedValue(rateLimitOutcome('12345'));

    const first = makeMessage('12345', '2261', 1);
    const third = makeMessage('12345', '2261', 3);
    await worker.queue(makeBatch([first, third]), mockEnv, testCtx);

    expect(first.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(third.retry).toHaveBeenCalledWith({ delaySeconds: 240 });
    expect(first.ack).not.toHaveBeenCalled();
  });

  it('honours a longer Retry-After, capped at 15 minutes', async () => {
    mockProcessSection
      .mockResolvedValueOnce(rateLimitOutcome('11111', 300))
      .mockResolvedValueOnce(rateLimitOutcome('22222', 7200));

    const msg1 = makeMessage('11111');
    const msg2 = makeMessage('22222');
    await worker.queue(makeBatch([msg1, msg2]), mockEnv, testCtx);

    expect(msg1.retry).toHaveBeenCalledWith({ delaySeconds: 300 });
    expect(msg2.retry).toHaveBeenCalledWith({ delaySeconds: 900 });
  });

  it('retries message when processSection returns retry for ApiError (upstream failure)', async () => {
    mockProcessSection.mockResolvedValue(apiErrorOutcome('12345'));

    const msg = makeMessage('12345');
    await worker.queue(makeBatch([msg]), mockEnv, testCtx);

    expect(msg.retry).toHaveBeenCalledOnce();
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it('retries message when processSection throws unknown error (defensive)', async () => {
    mockProcessSection.mockRejectedValue(new Error('Unexpected internal error'));

    const msg = makeMessage('12345');
    await worker.queue(makeBatch([msg]), mockEnv, testCtx);

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

    await worker.queue(makeBatch([msg1, msg2, msg3]), mockEnv, testCtx);

    expect(msg1.ack).toHaveBeenCalledOnce();
    expect(msg1.retry).not.toHaveBeenCalled();

    expect(msg2.retry).toHaveBeenCalledOnce();
    expect(msg2.ack).not.toHaveBeenCalled();

    expect(msg3.retry).toHaveBeenCalledOnce();
    expect(msg3.ack).not.toHaveBeenCalled();
  });

  it('creates one DB handle per invocation and threads it through every message', async () => {
    mockProcessSection.mockResolvedValue(successOutcome('11111'));

    const msg1 = makeMessage('11111');
    const msg2 = makeMessage('22222');
    await worker.queue(makeBatch([msg1, msg2]), mockEnv, testCtx);

    expect(mockGetDb).toHaveBeenCalledTimes(1);
    expect(mockGetDb).toHaveBeenCalledWith(mockEnv.HYPERDRIVE);
    expect(mockProcessSection).toHaveBeenCalledTimes(2);

    for (const call of mockProcessSection.mock.calls) {
      expect(call[0]).toBe(DB_HANDLE);
    }
  });
});
