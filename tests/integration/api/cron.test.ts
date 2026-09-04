import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const { mockAcquireLock, mockReleaseLock, mockGetDbFromEnv } = vi.hoisted(() => ({
  mockAcquireLock: vi.fn(),
  mockReleaseLock: vi.fn(),
  mockGetDbFromEnv: vi.fn(() => ({ execute: vi.fn() })),
}));

vi.mock('@/lib/db/queries', () => ({
  getSectionsToCheck: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getDbFromEnv: mockGetDbFromEnv,
}));

vi.mock('@/lib/worker/cron-lock', () => ({
  createCronLockClient: () => ({ acquire: mockAcquireLock }),
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
    mockReleaseLock.mockResolvedValue(undefined);
    mockAcquireLock.mockResolvedValue({
      configured: false,
      acquired: true,
      message: 'not configured',
      release: mockReleaseLock,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('returns success:false when all queue batches fail', async () => {
    const mockSections = Array.from({ length: 250 }, (_, i) => ({
      class_nbr: String(10000 + i),
      term: '2261',
    }));
    vi.mocked(getSectionsToCheck).mockResolvedValue(mockSections);

    const { env } = await import('cloudflare:workers');
    // oxlint-disable-next-line typescript/unbound-method
    vi.mocked(env.PICKMYCLASS_QUEUE.sendBatch).mockRejectedValue(
      new Error('Queue service unavailable')
    );

    const response = await GET(createRequest('Bearer test-cron-secret'));
    const data = await response.json();

    const responseData = data as {
      success: boolean;
      details?: { batches_failed: number; batches_total: number };
    };
    expect(responseData.success).toBe(false);
    expect(responseData.details?.batches_failed).toBeGreaterThan(0);
    expect(responseData.details?.batches_total).toBeGreaterThan(0);
  });

  it('returns success:true when all queue batches succeed', async () => {
    const mockSections = Array.from({ length: 50 }, (_, i) => ({
      class_nbr: String(10000 + i),
      term: '2261',
    }));
    vi.mocked(getSectionsToCheck).mockResolvedValue(mockSections);

    const { env } = await import('cloudflare:workers');
    // oxlint-disable-next-line typescript/unbound-method
    vi.mocked(env.PICKMYCLASS_QUEUE.sendBatch).mockResolvedValue({
      metadata: {},
    } as QueueSendBatchResponse);

    const response = await GET(createRequest('Bearer test-cron-secret'));
    const data = await response.json();

    const responseData = data as {
      success: boolean;
      batches_failed: number;
      sections_enqueued: number;
    };
    expect(responseData.success).toBe(true);
    expect(responseData.batches_failed).toBe(0);
    expect(responseData.sections_enqueued).toBe(50);
    expect(mockGetDbFromEnv).toHaveBeenCalledTimes(1);
  });

  it('retries failed batch once and returns success:true when retry succeeds', async () => {
    const mockSections = Array.from({ length: 150 }, (_, i) => ({
      class_nbr: String(10000 + i),
      term: '2261',
    }));
    vi.mocked(getSectionsToCheck).mockResolvedValue(mockSections);

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

    const response = await GET(createRequest('Bearer test-cron-secret'));
    const data = await response.json();

    const responseData = data as {
      success: boolean;
      batches_failed: number;
      batches_total: number;
    };
    expect(responseData.success).toBe(true);
    expect(responseData.batches_failed).toBe(0);
    expect(responseData.batches_total).toBe(2);
    expect(callCount).toBe(3);
  });

  it('returns success:false with partial failure info when retry also fails', async () => {
    const mockSections = Array.from({ length: 150 }, (_, i) => ({
      class_nbr: String(10000 + i),
      term: '2261',
    }));
    vi.mocked(getSectionsToCheck).mockResolvedValue(mockSections);

    const { env } = await import('cloudflare:workers');
    let callCount = 0;
    // oxlint-disable-next-line typescript/unbound-method
    vi.mocked(env.PICKMYCLASS_QUEUE.sendBatch).mockImplementation(() => {
      callCount++;
      if (callCount !== 1) {
        return Promise.reject(new Error('Persistent error'));
      }
      return Promise.resolve({ metadata: {} } as QueueSendBatchResponse);
    });

    const response = await GET(createRequest('Bearer test-cron-secret'));
    const data = await response.json();

    const responseData = data as {
      success: boolean;
      details?: { batches_failed: number; batches_total: number };
    };
    expect(responseData.success).toBe(false);
    expect(responseData.details?.batches_failed).toBe(1);
    expect(responseData.details?.batches_total).toBe(2);
    expect(callCount).toBe(3);
  });

  it('does not enqueue sections whose term has already ended', async () => {
    vi.setSystemTime(new Date('2027-01-15T19:00:00Z'));
    vi.mocked(getSectionsToCheck).mockResolvedValue([
      { class_nbr: '10001', term: '2261' },
      { class_nbr: '10002', term: '2271' },
    ]);

    const { env } = await import('cloudflare:workers');
    // oxlint-disable-next-line typescript/unbound-method
    vi.mocked(env.PICKMYCLASS_QUEUE.sendBatch).mockResolvedValue({
      metadata: {},
    } as QueueSendBatchResponse);

    const response = await GET(createRequest('Bearer test-cron-secret'));
    const data = (await response.json()) as { sections_enqueued?: number };

    expect(data.sections_enqueued).toBe(1);

    // oxlint-disable-next-line typescript/unbound-method
    const sendBatch = vi.mocked(env.PICKMYCLASS_QUEUE.sendBatch);
    const enqueuedTerms = sendBatch.mock.calls.flatMap(([batch]) =>
      (batch as { body: { term: string } }[]).map((m) => m.body.term)
    );
    expect(enqueuedTerms).toEqual(['2271']);
  });

  it('uses X-Cron-Scheduled-Time header for stagger group computation', async () => {
    const mockSections = Array.from({ length: 50 }, (_, i) => ({
      class_nbr: String(10000 + i),
      term: '2261',
    }));
    vi.mocked(getSectionsToCheck).mockResolvedValue(mockSections);

    const { env } = await import('cloudflare:workers');
    // oxlint-disable-next-line typescript/unbound-method
    vi.mocked(env.PICKMYCLASS_QUEUE.sendBatch).mockResolvedValue({
      metadata: {},
    } as QueueSendBatchResponse);

    vi.setSystemTime(new Date('2024-01-15T12:30:00Z'));

    const scheduledTime = new Date('2024-01-15T12:00:00Z').getTime();
    const request = new NextRequest('http://localhost:3000/api/cron', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer test-cron-secret',
        'X-Cron-Scheduled-Time': String(scheduledTime),
      },
    });
    await GET(request);

    expect(getSectionsToCheck).toHaveBeenCalledWith(
      mockGetDbFromEnv.mock.results[0]?.value,
      'even'
    );
  });

  it('returns 409 when the shared lock client reports an active run', async () => {
    mockAcquireLock.mockResolvedValue({
      configured: true,
      acquired: false,
      message: 'already held',
      currentHolder: 'worker-a',
      release: mockReleaseLock,
    });

    const response = await GET(createRequest('Bearer test-cron-secret'));
    const data = (await response.json()) as { error?: string };

    expect(response.status).toBe(409);
    expect(data.error).toBe('Another cron job is already running');
    expect(getSectionsToCheck).not.toHaveBeenCalled();
  });

  it('releases an acquired lease after cron work finishes', async () => {
    vi.mocked(getSectionsToCheck).mockResolvedValue([]);
    mockAcquireLock.mockResolvedValue({
      configured: true,
      acquired: true,
      message: 'acquired',
      release: mockReleaseLock,
    });

    const response = await GET(createRequest('Bearer test-cron-secret'));

    expect(response.status).toBe(200);
    expect(mockReleaseLock).toHaveBeenCalledOnce();
  });

  it('does not fail completed cron work when lease release throws', async () => {
    vi.mocked(getSectionsToCheck).mockResolvedValue([]);
    mockReleaseLock.mockRejectedValueOnce(new Error('release unavailable'));
    mockAcquireLock.mockResolvedValue({
      configured: true,
      acquired: true,
      message: 'acquired',
      release: mockReleaseLock,
    });

    const response = await GET(createRequest('Bearer test-cron-secret'));

    expect(response.status).toBe(200);
    expect(mockReleaseLock).toHaveBeenCalledOnce();
  });
});
