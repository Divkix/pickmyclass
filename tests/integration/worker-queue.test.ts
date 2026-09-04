import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { ClassCheckMessage } from '@/lib/types/queue';
import type { Env } from '@/lib/types/env';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {
    constructor(
      // eslint-disable-next-line anti-slop/no-unknown-parameters
      protected ctx: unknown,
      // eslint-disable-next-line anti-slop/no-unknown-parameters
      protected env: unknown
    ) {}
  },
  env: {},
}));

const mockHandleDLQMessage = vi.fn();
vi.mock('@/lib/queue/dlq-consumer', () => ({
  handleDLQMessage: (...args: unknown[]) => mockHandleDLQMessage(...args),
}));

const mockProcessSection = vi.fn();
vi.mock('@/lib/queue/process-section', () => ({
  processSection: (...args: unknown[]) => mockProcessSection(...args),
}));

const DB_HANDLE = { __dbHandle: 'queue-invocation-db' } as const;
const mockGetDb = vi.fn((_hyperdrive: CloudflareEnv['HYPERDRIVE']) => DB_HANDLE);
vi.mock('@/lib/db', () => ({
  getDb: (hyperdrive: CloudflareEnv['HYPERDRIVE']) => mockGetDb(hyperdrive),
}));

const workerModule = await import('@/worker');
const workerDefault = workerModule.default;

const handlerMock = await import('vinext/server/app-router-entry');

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
  // eslint-disable-next-line anti-slop/no-known-value-widening
  const raw: unknown = {
    queue,
    messages,
  };
  // eslint-disable-next-line anti-slop/no-widen-then-assert
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

const mockEnv = {
  CRON_SECRET: 'test-secret',
  ASU_API_BASE_URL: 'https://api.asu.edu',
  ASU_API_TOKEN: 'test-token',
  HYPERDRIVE: { connectionString: 'postgresql://hyperdrive.test/pickmyclass' },
  EMAIL: {},
  NOTIFICATION_FROM_EMAIL: 'no-reply@test.com',
} as Parameters<(typeof import('@/worker'))['default']['queue']>[1];

// eslint-disable-next-line anti-slop/no-known-value-widening
const rawTestCtx: unknown = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
};
// eslint-disable-next-line anti-slop/no-widen-then-assert
const testCtx = rawTestCtx as ExecutionContext;

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
    await worker.queue(makeBatch([msg]), mockEnv, {} as ExecutionContext);

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
    await worker.queue(makeBatch([msg]), mockEnv, {} as ExecutionContext);

    expect(msg.retry).toHaveBeenCalledOnce();
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it('acks message when processSection returns ack for AuthError (non-retryable)', async () => {
    mockProcessSection.mockResolvedValue(authErrorOutcome('12345'));

    const msg = makeMessage('12345');
    await worker.queue(makeBatch([msg]), mockEnv, {} as ExecutionContext);

    expect(msg.ack).toHaveBeenCalledOnce();
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it('acks message when processSection returns ack for NotFoundError (non-retryable)', async () => {
    mockProcessSection.mockResolvedValue(notFoundOutcome('99999'));

    const msg = makeMessage('99999');
    await worker.queue(makeBatch([msg]), mockEnv, {} as ExecutionContext);

    expect(msg.ack).toHaveBeenCalledOnce();
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it('retries message when processSection returns retry for RateLimitError', async () => {
    mockProcessSection.mockResolvedValue(rateLimitOutcome('12345'));

    const msg = makeMessage('12345');
    await worker.queue(makeBatch([msg]), mockEnv, {} as ExecutionContext);

    expect(msg.retry).toHaveBeenCalledOnce();
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it('retries message when processSection returns retry for ApiError (upstream failure)', async () => {
    mockProcessSection.mockResolvedValue(apiErrorOutcome('12345'));

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
      .mockResolvedValueOnce(successOutcome('11111'))
      .mockResolvedValueOnce(rateLimitOutcome('22222'))
      .mockResolvedValueOnce(dbFailOutcome('33333'));

    const msg1 = makeMessage('11111');
    const msg2 = makeMessage('22222');
    const msg3 = makeMessage('33333');

    await worker.queue(makeBatch([msg1, msg2, msg3]), mockEnv, {} as ExecutionContext);

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
    await worker.queue(makeBatch([msg1, msg2]), mockEnv, {} as ExecutionContext);

    expect(mockGetDb).toHaveBeenCalledTimes(1);
    expect(mockGetDb).toHaveBeenCalledWith(mockEnv.HYPERDRIVE);
    expect(mockProcessSection).toHaveBeenCalledTimes(2);
    for (const call of mockProcessSection.mock.calls) {
      expect(call[0]).toBe(DB_HANDLE);
    }
  });

  it('routes DLQ messages to DLQ handler without calling processSection', async () => {
    mockHandleDLQMessage.mockResolvedValue(undefined);

    const msg = makeMessage('12345');
    await worker.queue(makeBatch([msg], 'pickmyclass-dlq'), mockEnv, {} as ExecutionContext);

    expect(mockProcessSection).not.toHaveBeenCalled();
    expect(msg.ack).toHaveBeenCalledOnce();
    expect(mockGetDb).toHaveBeenCalledTimes(1);
    expect(mockHandleDLQMessage).toHaveBeenCalledWith(DB_HANDLE, msg.body, mockEnv.EMAIL, {
      fromEmail: mockEnv.NOTIFICATION_FROM_EMAIL,
    });
  });
});

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

  it('routes "0 4 * * *" cron to /api/cron/maintenance', async () => {
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
    expect(calledRequest.url).toContain('/api/cron/maintenance');
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
    const scheduledTime = 1718446800000;
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
