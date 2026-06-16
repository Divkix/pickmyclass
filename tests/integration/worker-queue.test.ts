/**
 * Integration tests for worker.ts queue consumer and scheduled handler.
 *
 * Tests the ack/retry decisions, DLQ short-circuit, and cron routing
 * by mocking vinext handler and dlq-consumer dependencies.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { ClassCheckMessage, QueueMessageBatch } from '@/lib/types/queue';
import type { Env } from '@/lib/types/env';

// cloudflare:workers is aliased in vitest.config.ts to the mock file.
// vinext/server/app-router-entry is aliased to the mock file.
// Both DurableObject and the handler are available automatically.

// Mock the dlq-consumer to isolate queue handler behavior
const mockHandleDLQMessage = vi.fn();
vi.mock('@/lib/queue/dlq-consumer', () => ({
  handleDLQMessage: (...args: unknown[]) => mockHandleDLQMessage(...args),
}));

// Import worker default export after mocks are in place
const workerModule = await import('@/worker');
const workerDefault = workerModule.default;

// Import the vinext handler mock so we can control fetch responses per test
const handlerMock = await import('vinext/server/app-router-entry');

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMessage(
  class_nbr: string,
  overrides?: Partial<ClassCheckMessage>
): {
  id: string;
  timestamp: Date;
  body: ClassCheckMessage;
  ack: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
} {
  return {
    id: `msg-${class_nbr}`,
    timestamp: new Date(),
    body: {
      class_nbr,
      term: '2261',
      enqueued_at: new Date().toISOString(),
      stagger_group: 'even',
      ...overrides,
    },
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

function makeBatch(
  messages: ReturnType<typeof makeMessage>[],
  queue = 'pickmyclass-queue'
): QueueMessageBatch<ClassCheckMessage> {
  return { queue, messages } as unknown as QueueMessageBatch<ClassCheckMessage>;
}

// Minimal env required by the queue handler
const testEnv: Partial<Env> = {
  CRON_SECRET: 'test-cron-secret',
  EMAIL: { send: vi.fn() } as unknown as Env['EMAIL'],
  NOTIFICATION_FROM_EMAIL: 'noreply@test.example.com',
};

// Minimal ExecutionContext stub
const testCtx = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
} as unknown as ExecutionContext;

// ── Tests ──────────────────────────────────────────────────────────────────

describe('worker.ts queue consumer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHandleDLQMessage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Normal queue: ack/retry decisions ────────────────────────────────────

  describe('normal queue (pickmyclass-queue)', () => {
    it('acks message when handler returns 200 with JSON body', async () => {
      const msg = makeMessage('12345');
      vi.spyOn(handlerMock.default, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await workerDefault.queue(makeBatch([msg]), testEnv as Env, testCtx);

      expect(msg.ack).toHaveBeenCalledTimes(1);
      expect(msg.retry).not.toHaveBeenCalled();
    });

    it('retries message when handler returns non-OK status (500)', async () => {
      const msg = makeMessage('12345');
      vi.spyOn(handlerMock.default, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Internal error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await workerDefault.queue(makeBatch([msg]), testEnv as Env, testCtx);

      expect(msg.retry).toHaveBeenCalledTimes(1);
      expect(msg.ack).not.toHaveBeenCalled();
    });

    it('retries message when handler returns OK status but non-JSON body', async () => {
      const msg = makeMessage('12345');
      vi.spyOn(handlerMock.default, 'fetch').mockResolvedValueOnce(
        new Response('plain text body (not JSON)', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        })
      );

      await workerDefault.queue(makeBatch([msg]), testEnv as Env, testCtx);

      // Non-JSON response → parse fails → retry (documents current behavior)
      expect(msg.retry).toHaveBeenCalledTimes(1);
      expect(msg.ack).not.toHaveBeenCalled();
    });

    it('retries message when handler throws an error', async () => {
      const msg = makeMessage('12345');
      vi.spyOn(handlerMock.default, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      await workerDefault.queue(makeBatch([msg]), testEnv as Env, testCtx);

      expect(msg.retry).toHaveBeenCalledTimes(1);
      expect(msg.ack).not.toHaveBeenCalled();
    });

    it('processes multiple messages concurrently with correct ack/retry per message', async () => {
      const msgOk = makeMessage('11111');
      const msgFail = makeMessage('22222');

      vi.spyOn(handlerMock.default, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: 'failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        );

      await workerDefault.queue(makeBatch([msgOk, msgFail]), testEnv as Env, testCtx);

      expect(msgOk.ack).toHaveBeenCalledTimes(1);
      expect(msgOk.retry).not.toHaveBeenCalled();

      expect(msgFail.retry).toHaveBeenCalledTimes(1);
      expect(msgFail.ack).not.toHaveBeenCalled();
    });

    it('sends request to /api/queue/process-section with correct headers', async () => {
      const msg = makeMessage('12345');
      const fetchSpy = vi
        .spyOn(handlerMock.default, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ success: true }), { status: 200 })
        );

      await workerDefault.queue(makeBatch([msg]), testEnv as Env, testCtx);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const calledRequest = fetchSpy.mock.calls[0]![0] as Request;
      expect(calledRequest.url).toBe('http://localhost/api/queue/process-section');
      expect(calledRequest.method).toBe('POST');
      expect(calledRequest.headers.get('Authorization')).toBe('Bearer test-cron-secret');
    });
  });

  // ── DLQ short-circuit ─────────────────────────────────────────────────────

  describe('DLQ queue (pickmyclass-dlq)', () => {
    it('calls handleDLQMessage and acks — never retries', async () => {
      const msg = makeMessage('99999');

      await workerDefault.queue(makeBatch([msg], 'pickmyclass-dlq'), testEnv as Env, testCtx);

      expect(mockHandleDLQMessage).toHaveBeenCalledTimes(1);
      expect(mockHandleDLQMessage).toHaveBeenCalledWith(
        msg.body,
        testEnv.EMAIL,
        expect.objectContaining({ fromEmail: testEnv.NOTIFICATION_FROM_EMAIL })
      );
      expect(msg.ack).toHaveBeenCalledTimes(1);
      expect(msg.retry).not.toHaveBeenCalled();
    });

    it('acks DLQ message even when handleDLQMessage throws', async () => {
      const msg = makeMessage('99999');
      mockHandleDLQMessage.mockRejectedValueOnce(new Error('DLQ handler crashed'));

      await workerDefault.queue(makeBatch([msg], 'pickmyclass-dlq'), testEnv as Env, testCtx);

      // Always ack — DLQ messages must never retry
      expect(msg.ack).toHaveBeenCalledTimes(1);
      expect(msg.retry).not.toHaveBeenCalled();
    });

    it('does NOT call vinext handler for DLQ messages', async () => {
      const msg = makeMessage('99999');
      const fetchSpy = vi.spyOn(handlerMock.default, 'fetch');

      await workerDefault.queue(makeBatch([msg], 'pickmyclass-dlq'), testEnv as Env, testCtx);

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('processes multiple DLQ messages, each acked individually', async () => {
      const msg1 = makeMessage('11111');
      const msg2 = makeMessage('22222');

      await workerDefault.queue(
        makeBatch([msg1, msg2], 'pickmyclass-dlq'),
        testEnv as Env,
        testCtx
      );

      expect(mockHandleDLQMessage).toHaveBeenCalledTimes(2);
      expect(msg1.ack).toHaveBeenCalledTimes(1);
      expect(msg2.ack).toHaveBeenCalledTimes(1);
      expect(msg1.retry).not.toHaveBeenCalled();
      expect(msg2.retry).not.toHaveBeenCalled();
    });
  });
});

// ── Scheduled handler ─────────────────────────────────────────────────────

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
});
