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
      batches_failed: number;
      batches_total: number;
    };
    expect(responseData.success).toBe(false);
    expect(responseData.batches_failed).toBeGreaterThan(0);
    expect(responseData.batches_total).toBeGreaterThan(0);
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

  it('returns success:false with partial failure info when some batches fail', async () => {
    // Arrange: Mock sections to check (need at least 2 batches)
    const mockSections = Array.from({ length: 150 }, (_, i) => ({
      class_nbr: String(10000 + i),
      term: '2261',
    }));
    vi.mocked(getSectionsToCheck).mockResolvedValue(mockSections);

    // Arrange: Mock queue to fail only the second batch
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

    // Assert: Should return success:false when there are any failed batches
    const responseData = data as {
      success: boolean;
      batches_failed: number;
      batches_total: number;
    };
    expect(responseData.success).toBe(false);
    expect(responseData.batches_failed).toBe(1);
    expect(responseData.batches_total).toBe(2);
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
