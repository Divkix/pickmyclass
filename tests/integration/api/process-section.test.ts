import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/queue/process-section/route';

function createRequest(body: string, authHeader?: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/queue/process-section', {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
  });
}

describe('POST /api/queue/process-section', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.CRON_SECRET = 'test-cron-secret';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns 401 for unauthorized requests', async () => {
    const response = await POST(
      createRequest(JSON.stringify({ class_nbr: '12345', term: '2261' }))
    );
    const data = (await response.json()) as { success: boolean; error: string };

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Unauthorized');
  });

  it('returns non-retryable response for malformed JSON payloads', async () => {
    const response = await POST(createRequest('{"class_nbr":"12345"', 'Bearer test-cron-secret'));
    const data = (await response.json()) as {
      success: boolean;
      error: string;
      retryable: boolean;
    };

    expect(response.status).toBe(200);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Invalid message payload');
    expect(data.retryable).toBe(false);
  });

  it('returns non-retryable response for invalid message shape', async () => {
    const response = await POST(
      createRequest(JSON.stringify({ class_nbr: '123', term: 'bad' }), 'Bearer test-cron-secret')
    );
    const data = (await response.json()) as {
      success: boolean;
      error: string;
      retryable: boolean;
      details: Array<{ field: string; message: string }>;
    };

    expect(response.status).toBe(200);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Invalid message payload');
    expect(data.retryable).toBe(false);
    expect(data.details).toBeDefined();
    expect(data.details.length).toBeGreaterThan(0);
  });
});
