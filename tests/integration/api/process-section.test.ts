import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { SectionCheckOutcome } from '@/lib/queue/process-section';

const REQUEST_DB = { __dbHandle: 'request-db' };
const mockProcessSection = vi.hoisted(() => vi.fn());
const mockGetDbFromEnv = vi.hoisted(() => vi.fn());

vi.mock('cloudflare:workers', () => ({
  env: { CRON_SECRET: 'test-cron-secret' },
}));

vi.mock('@/lib/queue/process-section', () => ({
  processSection: mockProcessSection,
}));

vi.mock('@/lib/db', () => ({
  getDbFromEnv: (...args: unknown[]) => mockGetDbFromEnv(...args),
}));

import { POST } from '@/app/api/queue/process-section/route';

const successOutcome: SectionCheckOutcome = {
  disposition: 'ack',
  result: {
    success: true,
    classNbr: '12345',
    changes: {
      seatBecameAvailable: true,
      instructorAssigned: false,
      seatsFilled: false,
      newOpenSeats: 3,
    },
    emailsSent: 2,
    processingTimeMs: 15,
  },
  httpStatus: 200,
  retryable: false,
};

function makeOutcome(
  disposition: 'ack' | 'retry',
  httpStatus: 200 | 429 | 502 | 500,
  retryable: boolean,
  error: string
): SectionCheckOutcome {
  return {
    disposition,
    result: {
      success: false,
      classNbr: '12345',
      changes: {
        seatBecameAvailable: false,
        seatsFilled: false,
        instructorAssigned: false,
        newOpenSeats: 0,
      },
      emailsSent: 0,
      processingTimeMs: 15,
      error,
    },
    httpStatus,
    retryable,
  };
}

function createRequest(body: string, authorized = true): NextRequest {
  // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: headers needs index signature for dynamic Authorization
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authorized) headers.Authorization = 'Bearer test-cron-secret';
  return new NextRequest('http://localhost/api/queue/process-section', {
    method: 'POST',
    body,
    headers,
  });
}
function validRequest(): NextRequest {
  return createRequest(JSON.stringify({ class_nbr: '12345', term: '2261' }));
}

describe('POST /api/queue/process-section', () => {
  beforeEach(() => {
    mockProcessSection.mockReset();
    mockGetDbFromEnv.mockReset().mockReturnValue(REQUEST_DB);
  });

  it('rejects unauthorized requests', async () => {
    const response = await POST(
      createRequest(JSON.stringify({ class_nbr: '12345', term: '2261' }), false)
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ success: false, error: 'Unauthorized' });
    expect(mockProcessSection).not.toHaveBeenCalled();
    // Rejected requests never open a DB connection
    expect(mockGetDbFromEnv).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{"class_nbr":"12345"'],
    ['invalid message shape', JSON.stringify({ class_nbr: '123', term: 'bad' })],
  ])('acks %s as non-retryable', async (_label, body) => {
    const response = await POST(createRequest(body));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'Invalid message payload',
      retryable: false,
    });
    expect(mockProcessSection).not.toHaveBeenCalled();
    expect(mockGetDbFromEnv).not.toHaveBeenCalled();
  });

  it('maps a successful processing result to the HTTP response', async () => {
    mockProcessSection.mockResolvedValue(successOutcome);

    const response = await POST(validRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      class_nbr: '12345',
      changes_detected: {
        seat_became_available: true,
        instructor_assigned: false,
        seats_filled: false,
      },
      emails_sent: 2,
      processing_time_ms: 15,
    });
    expect(mockProcessSection).toHaveBeenCalledWith(
      REQUEST_DB,
      { class_nbr: '12345', term: '2261' },
      expect.objectContaining({ CRON_SECRET: 'test-cron-secret' })
    );
    // Exactly one request-scoped handle per invocation
    expect(mockGetDbFromEnv).toHaveBeenCalledTimes(1);
  });

  it('returns 500 for a failed processing result', async () => {
    mockProcessSection.mockResolvedValue(makeOutcome('retry', 500, true, 'Database unavailable'));

    const response = await POST(validRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Database unavailable',
      class_nbr: '12345',
      retryable: true,
    });
  });

  it.each([
    ['authentication failure', makeOutcome('ack', 200, false, 'Unauthorized upstream')],
    ['missing section', makeOutcome('ack', 200, false, 'Section not found')],
  ])('acks a non-retryable %s', async (_label, outcome) => {
    mockProcessSection.mockResolvedValue(outcome);

    const response = await POST(validRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: outcome.result.error,
      retryable: false,
    });
  });

  it.each([
    ['rate limit', makeOutcome('retry', 429, true, 'Slow down'), 429],
    ['API failure', makeOutcome('retry', 502, true, 'Bad gateway'), 502],
  ])('marks a %s as retryable', async (_label, outcome, status) => {
    mockProcessSection.mockResolvedValue(outcome);

    const response = await POST(validRequest());

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: outcome.result.error,
      class_nbr: '12345',
      retryable: true,
    });
  });

  it('returns 500 for unknown failures via outcome', async () => {
    mockProcessSection.mockResolvedValue(makeOutcome('retry', 500, true, 'Unexpected failure'));

    const response = await POST(validRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'Unexpected failure',
      class_nbr: '12345',
      retryable: true,
    });
  });

  it('returns 500 for unexpected thrown error (defensive)', async () => {
    mockProcessSection.mockRejectedValue(new Error('Unexpected failure'));

    const response = await POST(validRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'Unexpected failure',
      processing_time_ms: expect.any(Number),
    });
  });
});
