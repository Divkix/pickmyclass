import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { ProcessingResult } from '@/lib/queue/process-section';

const mockProcessSection = vi.hoisted(() => vi.fn());

vi.mock('cloudflare:workers', () => ({
  env: { CRON_SECRET: 'test-cron-secret' },
}));

vi.mock('@/lib/queue/process-section', () => ({
  processSection: mockProcessSection,
}));

import { POST } from '@/app/api/queue/process-section/route';
import { ApiError, AuthError, NotFoundError, RateLimitError } from '@/lib/asu/api';

const successResult: ProcessingResult = {
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
};

function createRequest(body: string, authorized = true): NextRequest {
  return new NextRequest('http://localhost/api/queue/process-section', {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      ...(authorized ? { Authorization: 'Bearer test-cron-secret' } : {}),
    },
  });
}

function validRequest(): NextRequest {
  return createRequest(JSON.stringify({ class_nbr: '12345', term: '2261' }));
}

describe('POST /api/queue/process-section', () => {
  beforeEach(() => {
    mockProcessSection.mockReset();
  });

  it('rejects unauthorized requests', async () => {
    const response = await POST(
      createRequest(JSON.stringify({ class_nbr: '12345', term: '2261' }), false)
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ success: false, error: 'Unauthorized' });
    expect(mockProcessSection).not.toHaveBeenCalled();
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
  });

  it('maps a successful processing result to the HTTP response', async () => {
    mockProcessSection.mockResolvedValue(successResult);

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
      { class_nbr: '12345', term: '2261' },
      expect.objectContaining({ CRON_SECRET: 'test-cron-secret' })
    );
  });

  it('returns 500 for a failed processing result', async () => {
    mockProcessSection.mockResolvedValue({
      ...successResult,
      success: false,
      error: 'Database unavailable',
    });

    const response = await POST(validRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Database unavailable',
      class_nbr: '12345',
    });
  });

  it.each([
    ['authentication failure', new AuthError('Unauthorized upstream')],
    ['missing section', new NotFoundError('Section not found')],
  ])('acks a non-retryable %s', async (_label, error) => {
    mockProcessSection.mockRejectedValue(error);

    const response = await POST(validRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: error.message,
      retryable: false,
    });
  });

  it.each([
    ['rate limit', new RateLimitError('Slow down'), 429],
    ['API failure', new ApiError('Bad gateway', 502), 502],
  ])('marks a %s as retryable', async (_label, error, status) => {
    mockProcessSection.mockRejectedValue(error);

    const response = await POST(validRequest());

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: error.message,
      retryable: true,
    });
  });

  it('returns 500 for unknown failures', async () => {
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
