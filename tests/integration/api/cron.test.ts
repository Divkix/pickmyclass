import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

// Mock modules before importing route
vi.mock('@/lib/db/queries', () => ({
  getSectionsToCheck: vi.fn(),
}));

vi.mock('cloudflare:workers', () => ({
  env: {
    CRON_SECRET: 'test-cron-secret',
    PICKMYCLASS_QUEUE: {
      sendBatch: vi.fn(),
    },
  },
}));

import { GET } from '@/app/api/cron/route';
import { getSectionsToCheck } from '@/lib/db/queries';

function createRequest(authHeader?: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/cron', {
    method: 'GET',
    headers: authHeader ? { Authorization: authHeader } : {},
  });
}

describe('GET /api/cron', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('returns success:false when all queue batches fail', async () => {
    // Arrange: Mock sections to check
    const mockSections = Array.from({ length: 250 }, (_, i) => ({
      class_nbr: String(10000 + i),
      term: '2261',
    }));
    vi.mocked(getSectionsToCheck).mockResolvedValue(mockSections);

    // Arrange: Mock queue to always fail (simulating Cloudflare Queue outage)
    const { env } = await import('cloudflare:workers');
    // oxlint-disable-next-line typescript/unbound-method
    vi.mocked(env.PICKMYCLASS_QUEUE.sendBatch).mockRejectedValue(
      new Error('Queue service unavailable')
    );

    // Act
    const response = await GET(createRequest('Bearer test-cron-secret'));
    const data = await response.json();

    // Assert: Should return success:false when batches fail
    const responseData = data as {
      success: boolean;
      details?: { batches_failed: number; batches_total: number };
    };
    expect(responseData.success).toBe(false);
    expect(responseData.details?.batches_failed).toBeGreaterThan(0);
    expect(responseData.details?.batches_total).toBeGreaterThan(0);
  });

  it('returns success:true when all queue batches succeed', async () => {
    // Arrange: Mock sections to check
    const mockSections = Array.from({ length: 50 }, (_, i) => ({
      class_nbr: String(10000 + i),
      term: '2261',
    }));
    vi.mocked(getSectionsToCheck).mockResolvedValue(mockSections);

    // Arrange: Mock queue to succeed
    const { env } = await import('cloudflare:workers');
    // oxlint-disable-next-line typescript/unbound-method
    vi.mocked(env.PICKMYCLASS_QUEUE.sendBatch).mockResolvedValue({
      metadata: {},
    } as QueueSendBatchResponse);

    // Act
    const response = await GET(createRequest('Bearer test-cron-secret'));
    const data = await response.json();

    // Assert: Should return success:true when all batches succeed
    const responseData = data as {
      success: boolean;
      batches_failed: number;
      sections_enqueued: number;
    };
    expect(responseData.success).toBe(true);
    expect(responseData.batches_failed).toBe(0);
    expect(responseData.sections_enqueued).toBe(50);
  });

  it('retries failed batch once and returns success:true when retry succeeds', async () => {
    // Arrange: Mock sections to check (need at least 2 batches)
    const mockSections = Array.from({ length: 150 }, (_, i) => ({
      class_nbr: String(10000 + i),
      term: '2261',
    }));
    vi.mocked(getSectionsToCheck).mockResolvedValue(mockSections);

    // Arrange: Mock queue to fail only the second batch on first attempt,
    // then succeed on retry (calls: 1=success, 2=fail, 3=retry success)
    const { env } = await import('cloudflare:workers');
    let callCount = 0;
    // oxlint-disable-next-line typescript/unbound-method
    vi.mocked(env.PICKMYCLASS_QUEUE.sendBatch).mockImplementation(() => {
      callCount++;
      if (callCount === 2) {
        return Promise.reject(new Error('Transient error'));
      }
      return Promise.resolve({ metadata: {} } as QueueSendBatchResponse);
    });

    // Act
    const response = await GET(createRequest('Bearer test-cron-secret'));
    const data = await response.json();

    // Assert: Retry recovered the failed batch → success:true, batches_failed:0
    const responseData = data as {
      success: boolean;
      batches_failed: number;
      batches_total: number;
    };
    expect(responseData.success).toBe(true);
    expect(responseData.batches_failed).toBe(0);
    expect(responseData.batches_total).toBe(2);
    // sendBatch was called 3 times: 2 first-pass + 1 retry
    expect(callCount).toBe(3);
  });

  it('returns success:false with partial failure info when retry also fails', async () => {
    // Arrange: Mock sections to check (need at least 2 batches)
    const mockSections = Array.from({ length: 150 }, (_, i) => ({
      class_nbr: String(10000 + i),
      term: '2261',
    }));
    vi.mocked(getSectionsToCheck).mockResolvedValue(mockSections);

    // Arrange: Mock queue — first batch succeeds, second batch fails on both attempts
    const { env } = await import('cloudflare:workers');
    let callCount = 0;
    // oxlint-disable-next-line typescript/unbound-method
    vi.mocked(env.PICKMYCLASS_QUEUE.sendBatch).mockImplementation(() => {
      callCount++;
      if (callCount !== 1) {
        // call 1 (first pass batch 0) succeeds; calls 2 & 3 (batch 1 first + retry) fail
        return Promise.reject(new Error('Persistent error'));
      }
      return Promise.resolve({ metadata: {} } as QueueSendBatchResponse);
    });

    // Act
    const response = await GET(createRequest('Bearer test-cron-secret'));
    const data = await response.json();

    // Assert: Retry also failed → success:false with batches_failed reported in details
    const responseData = data as {
      success: boolean;
      details?: { batches_failed: number; batches_total: number };
    };
    expect(responseData.success).toBe(false);
    expect(responseData.details?.batches_failed).toBe(1);
    expect(responseData.details?.batches_total).toBe(2);
    // sendBatch was called 3 times: 2 first-pass + 1 retry
    expect(callCount).toBe(3);
  });

  it('does not enqueue sections whose term has already ended', async () => {
    // 2027-01-15: Spring 2026 (2261, ends 2026-05-09) is past; Spring 2027 (2271) is current.
    vi.setSystemTime(new Date('2027-01-15T19:00:00Z'));
    vi.mocked(getSectionsToCheck).mockResolvedValue([
      { class_nbr: '10001', term: '2261' }, // past — must be dropped
      { class_nbr: '10002', term: '2271' }, // current — must be kept
    ]);

    const { env } = await import('cloudflare:workers');
    // oxlint-disable-next-line typescript/unbound-method
    vi.mocked(env.PICKMYCLASS_QUEUE.sendBatch).mockResolvedValue({
      metadata: {},
    } as QueueSendBatchResponse);

    const response = await GET(createRequest('Bearer test-cron-secret'));
    // ok() spreads fields at the top level (see lib/api/response.ts); only fail()/207 nests
    // under `details`. The success path here exposes sections_enqueued at the top level.
    const data = (await response.json()) as { sections_enqueued?: number };

    expect(data.sections_enqueued).toBe(1);

    // oxlint-disable-next-line typescript/unbound-method
    const sendBatch = vi.mocked(env.PICKMYCLASS_QUEUE.sendBatch);
    const enqueuedTerms = sendBatch.mock.calls.flatMap(
      ([batch]) => (batch as { body: { term: string } }[]).map((m) => m.body.term)
    );
    expect(enqueuedTerms).toEqual(['2271']);
  });

  it('uses X-Cron-Scheduled-Time header for stagger group computation', async () => {
    // Arrange: Mock sections to check
    const mockSections = Array.from({ length: 50 }, (_, i) => ({
      class_nbr: String(10000 + i),
      term: '2261',
    }));
    vi.mocked(getSectionsToCheck).mockResolvedValue(mockSections);

    // Arrange: Mock queue to succeed
    const { env } = await import('cloudflare:workers');
    // oxlint-disable-next-line typescript/unbound-method
    vi.mocked(env.PICKMYCLASS_QUEUE.sendBatch).mockResolvedValue({
      metadata: {},
    } as QueueSendBatchResponse);

    // Set current time to :30 (odd stagger group)
    vi.setSystemTime(new Date('2024-01-15T12:30:00Z'));

    // Act: Send request with scheduled time header pointing to :00 (even stagger group)
    const scheduledTime = new Date('2024-01-15T12:00:00Z').getTime();
    const request = new NextRequest('http://localhost:3000/api/cron', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer test-cron-secret',
        'X-Cron-Scheduled-Time': String(scheduledTime),
      },
    });
    await GET(request);

    // Assert: Should use 'even' stagger group based on header, not 'odd' from current time
    expect(getSectionsToCheck).toHaveBeenCalledWith('even');
  });
});
