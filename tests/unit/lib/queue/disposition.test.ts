import { describe, expect, it } from 'vite-plus/test';
import { ApiError, AuthError, NotFoundError, RateLimitError } from '@/lib/asu/api';
import { classifyDisposition } from '@/lib/queue/disposition';
import type { ProcessingResult } from '@/lib/queue/process-section';

function makeResult(overrides: Partial<ProcessingResult> = {}): ProcessingResult {
  return {
    success: true,
    classNbr: '12345',
    changes: {
      seatBecameAvailable: false,
      seatsFilled: false,
      instructorAssigned: false,
      newOpenSeats: 0,
    },
    emailsSent: 0,
    processingTimeMs: 10,
    ...overrides,
  };
}

describe('classifyDisposition', () => {
  it('acks a successful ProcessingResult', () => {
    expect(classifyDisposition(makeResult({ success: true }))).toBe('ack');
  });

  it('retries a failed ProcessingResult (DB upsert error)', () => {
    expect(
      classifyDisposition(makeResult({ success: false, error: 'unique constraint violation' }))
    ).toBe('retry');
  });

  it('acks a thrown AuthError (non-retryable: bad token)', () => {
    expect(classifyDisposition(new AuthError('401 Unauthorized from ASU'))).toBe('ack');
  });

  it('acks a thrown NotFoundError (non-retryable: section gone)', () => {
    expect(classifyDisposition(new NotFoundError('Section 99999 not found'))).toBe('ack');
  });

  it('retries a thrown RateLimitError (transient upstream)', () => {
    expect(classifyDisposition(new RateLimitError('Rate limit exceeded'))).toBe('retry');
  });

  it('retries a thrown ApiError (upstream failure)', () => {
    expect(classifyDisposition(new ApiError('ASU API 502 Bad Gateway', 502))).toBe('retry');
  });

  it('retries an unknown thrown Error (defensive)', () => {
    expect(classifyDisposition(new Error('Unexpected internal error'))).toBe('retry');
  });

  it('retries an unknown thrown non-Error value (defensive)', () => {
    expect(classifyDisposition('boom')).toBe('retry');
    expect(classifyDisposition(undefined)).toBe('retry');
    expect(classifyDisposition(null)).toBe('retry');
  });
});
