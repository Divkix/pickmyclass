import { NextRequest } from 'next/server';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import type { Database } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { GET, POST } from '@/app/api/unsubscribe/route';

type ScriptedParam = string | number | boolean | null;

interface CapturedStatement {
  sql: string;
  params: ScriptedParam[];
}

type DriverValue =
  | string
  | number
  | boolean
  | null
  | DriverValue[]
  | { [column: string]: DriverValue };

type DriverRow = { [column: string]: DriverValue };

type ScriptedOutcome = DriverRow[] | Error;

interface TransportRecorder {
  statements: CapturedStatement[];
  outcomes: ScriptedOutcome[];
}

type ScriptedQuery = Promise<DriverRow[]> & { values(): Promise<DriverValue[][]> };

function pendingRows(rows: DriverRow[]): ScriptedQuery {
  const query = Promise.resolve(rows);
  return Object.assign(query, {
    values: () => Promise.resolve(rows.map((row) => Object.values(row))),
  });
}

function rejectedRows(outcome: Error): ScriptedQuery {
  const rejection = Promise.reject<never>(outcome);
  return Object.assign(rejection, { values: () => rejection });
}

const { recorder, mockVerifyUnsubscribeToken, mockCaptureServerEvent } = vi.hoisted(() => {
  const recorder: TransportRecorder = { statements: [], outcomes: [] };
  return {
    recorder,
    mockVerifyUnsubscribeToken: vi.fn(),
    mockCaptureServerEvent: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@/lib/email/unsubscribe-token', () => ({
  verifyUnsubscribeToken: mockVerifyUnsubscribeToken,
}));

vi.mock('@/lib/analytics/server', () => ({
  captureServerEvent: mockCaptureServerEvent,
}));

vi.mock('@/lib/db', () => ({
  getDbFromEnv: () => scriptedDatabase(),
}));

function scriptedDatabase(): Database {
  const client = {
    options: { parsers: {}, serializers: {} },
    unsafe(query: string, params: ScriptedParam[]): ScriptedQuery {
      recorder.statements.push({ sql: query, params });
      const outcome = recorder.outcomes.shift();
      return outcome instanceof Error ? rejectedRows(outcome) : pendingRows(outcome ?? []);
    },
  };

  return drizzle(client as Database['$client'], { schema });
}

function request(url: string, method = 'GET'): NextRequest {
  return new NextRequest(url, { method });
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

async function json(response: Response) {
  return response.json() as Promise<Record<string, JsonValue>>;
}

describe('/api/unsubscribe', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    recorder.statements.length = 0;
    recorder.outcomes.length = 0;
    mockVerifyUnsubscribeToken.mockReturnValue('user-123');
  });

  afterEach(() => {
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('rejects missing GET tokens with an HTML error page', async () => {
    const response = await GET(request('https://pickmyclass.app/api/unsubscribe'));
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(body).toContain('Invalid Unsubscribe Link');
    expect(mockVerifyUnsubscribeToken).not.toHaveBeenCalled();
    expect(recorder.statements).toHaveLength(0);
  });

  it('rejects invalid GET tokens before touching the database', async () => {
    mockVerifyUnsubscribeToken.mockReturnValue(null);

    const response = await GET(request('https://pickmyclass.app/api/unsubscribe?token=bad'));
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toContain('Invalid or Expired Token');
    expect(recorder.statements).toHaveLength(0);
  });

  it('renders a confirmation form for valid GET requests without mutating state', async () => {
    const response = await GET(request('https://pickmyclass.app/api/unsubscribe?token=good'));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('Confirm Unsubscribe');
    expect(recorder.statements).toHaveLength(0);
  });

  it('validates one-click POST requests', async () => {
    const response = await POST(request('https://pickmyclass.app/api/unsubscribe', 'POST'));
    const data = await json(response);

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid input');
    expect(mockVerifyUnsubscribeToken).not.toHaveBeenCalled();
    expect(recorder.statements).toHaveLength(0);
  });

  it('rejects invalid one-click POST tokens', async () => {
    mockVerifyUnsubscribeToken.mockReturnValue(null);

    const response = await POST(
      request('https://pickmyclass.app/api/unsubscribe?token=bad', 'POST')
    );
    const data = await json(response);

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid or expired token');
    expect(recorder.statements).toHaveLength(0);
  });

  it('unsubscribes valid one-click POST requests via a single profile update', async () => {
    const response = await POST(
      request('https://pickmyclass.app/api/unsubscribe?token=good', 'POST')
    );
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);

    expect(recorder.statements).toHaveLength(1);
    const statement = recorder.statements[0];
    expect(statement.sql).toContain('"user_profiles"');
    expect(statement.params).toEqual(expect.arrayContaining(['user-123']));
    expect(statement.params).toContain(false);

    expect(mockCaptureServerEvent).toHaveBeenCalledWith('user-123', 'user_unsubscribed', {});
  });

  it('suppresses the analytics event when one-click POST persistence fails', async () => {
    recorder.outcomes.push(new Error('database down'));

    const response = await POST(
      request('https://pickmyclass.app/api/unsubscribe?token=good', 'POST')
    );
    const data = await json(response);

    expect(response.status).toBe(500);
    expect(data).toEqual({ success: false, error: 'Internal server error' });
    expect(mockCaptureServerEvent).not.toHaveBeenCalled();
  });
});
