import { NextRequest } from 'next/server';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import type { Database } from '@/lib/db';
import * as schema from '@/lib/db/schema';

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

const {
  recorder,
  mockRequireUser,
  mockRevokeAllUserSessions,
  mockInvalidateAuthorizationState,
  mockCaptureServerEvent,
} = vi.hoisted(() => {
  const recorder: TransportRecorder = { statements: [], outcomes: [] };
  return {
    recorder,
    mockRequireUser: vi.fn(),
    mockRevokeAllUserSessions: vi.fn(),
    mockInvalidateAuthorizationState: vi.fn(),
    mockCaptureServerEvent: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@/lib/auth/require-user', () => {
  class UnauthorizedError extends Error {
    constructor(message = 'Unauthorized') {
      super(message);
      this.name = 'UnauthorizedError';
    }
  }
  return { requireUser: mockRequireUser, UnauthorizedError };
});

vi.mock('@/lib/auth/clerk-session', () => ({
  revokeAllUserSessions: mockRevokeAllUserSessions,
}));

vi.mock('@/lib/auth/authorization-state', () => ({
  invalidateAuthorizationState: mockInvalidateAuthorizationState,
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

import { DELETE } from '@/app/api/user/delete/route';
import { GET } from '@/app/api/user/export/route';
import { UnauthorizedError } from '@/lib/auth/require-user';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const SESSION_USER = { userId: 'user-123', clerkUserId: 'clerk-456', sessionId: null };

const MIRROR_ROW = {
  id: 'user-123',
  clerk_user_id: 'clerk-456',
  email: 'student@example.com',
  email_confirmed_at: '2026-05-02 08:00:00+00',
  created_at: '2026-05-01 00:00:00+00',
  last_sign_in_at: null,
} satisfies DriverRow;

const ACTIVE_PROFILE_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  user_id: 'user-123',
  is_admin: false,
  is_disabled: false,
  disabled_at: null,
  notifications_enabled: true,
  unsubscribed_at: null,
  email_bounced: false,
  email_bounced_at: null,
  spam_complained: false,
  spam_complained_at: null,
  age_verified_at: '2026-05-01 00:00:00+00',
  agreed_to_terms_at: '2026-05-01 00:00:00+00',
  onboarding_completed_at: '2026-05-10 00:00:00+00',
  onboarding_skipped_at: null,
  created_at: '2026-05-01 00:00:00+00',
  updated_at: '2026-05-01 00:00:00+00',
} satisfies DriverRow;

const WATCH_ROW = {
  id: '22222222-2222-4222-8222-222222222222',
  user_id: 'user-123',
  class_nbr: '12345',
  term: '2264',
  subject: 'CSE',
  catalog_nbr: '240',
  created_at: '2026-05-10 12:00:00+00',
  class_state: {
    title: 'Intro to Programming',
    instructor_name: 'Christine Lee',
    seats_available: 3,
    seats_capacity: 100,
    location: 'BYAO 210',
    meeting_times: 'MWF 9:00-9:50am',
    last_checked_at: '2026-05-11T09:30:00+00:00',
  },
} satisfies DriverRow;

const NOTIFICATION_ROW = {
  id: '33333333-3333-4333-8333-333333333333',
  class_watch_id: '22222222-2222-4222-8222-222222222222',
  notification_type: 'seat_available',
  sent_at: '2026-05-11 09:30:00+00',
  expires_at: '2026-05-12 09:30:00+00',
  is_active: true,
  class_watch: { term: '2264', subject: 'CSE', catalog_nbr: '240', class_nbr: '12345' },
} satisfies DriverRow;

function scriptExportRows(overrides: {
  mirror?: DriverRow | null;
  profile?: DriverRow | null;
  watches?: DriverRow[];
  notifications?: DriverRow[];
}) {
  const {
    mirror = MIRROR_ROW,
    profile = ACTIVE_PROFILE_ROW,
    watches = [WATCH_ROW],
    notifications = [NOTIFICATION_ROW],
  } = overrides;
  recorder.outcomes.push(mirror === null ? [] : [mirror]);
  recorder.outcomes.push(profile === null ? [] : [profile]);
  recorder.outcomes.push(watches);
  recorder.outcomes.push(notifications);
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, JsonValue>>;
}

function exportRows(value: JsonValue): Array<Record<string, JsonValue>> {
  return value as Array<Record<string, JsonValue>>;
}

function exportObject(value: JsonValue): Record<string, JsonValue> {
  return value as Record<string, JsonValue>;
}

describe('user data rights APIs', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    recorder.statements.length = 0;
    recorder.outcomes.length = 0;
    mockRequireUser.mockResolvedValue({ user: SESSION_USER });
    mockRevokeAllUserSessions.mockResolvedValue(undefined);
    mockCaptureServerEvent.mockResolvedValue(undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  describe('GET /api/user/export', () => {
    it('rejects data exports for unauthenticated users without touching the database', async () => {
      mockRequireUser.mockRejectedValueOnce(new UnauthorizedError());

      const response = await GET(new NextRequest('https://pickmyclass.app/api/user/export'));
      const data = await json(response);

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Unauthorized');
      expect(recorder.statements).toHaveLength(0);
    });

    it('exports account, profile, watch, and notification data as an attachment', async () => {
      scriptExportRows({});

      const response = await GET(new NextRequest('https://pickmyclass.app/api/user/export'));
      const data = await json(response);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('content-disposition')).toMatch(
        /pickmyclass-data-\d{4}-\d{2}-\d{2}\.json/
      );
      expect(data.export_info).toMatchObject({ export_format: 'JSON', service: 'PickMyClass' });
      expect(data.user_account).toEqual({
        email: 'student@example.com',
        created_at: '2026-05-01T00:00:00.000Z',
        last_sign_in_at: null,
        email_confirmed_at: '2026-05-02T08:00:00.000Z',
      });
      expect(data.profile).toEqual({
        age_verified_at: '2026-05-01T00:00:00.000Z',
        agreed_to_terms_at: '2026-05-01T00:00:00.000Z',
        account_status: 'active',
        disabled_at: null,
      });
      expect(data.summary).toEqual({
        total_watches: 1,
        total_notifications: 1,
        active_watches: 1,
      });
    });

    it('preserves ISO-8601 UTC timestamps and nested jsonb shapes in exported rows', async () => {
      scriptExportRows({});

      const response = await GET(new NextRequest('https://pickmyclass.app/api/user/export'));
      const data = await json(response);

      const watches = exportRows(data.class_watches);
      expect(watches).toHaveLength(1);
      expect(watches[0].created_at).toBe('2026-05-10T12:00:00.000Z');
      expect(watches[0].subject).toBe('CSE');
      expect(watches[0].class_state).toEqual(WATCH_ROW.class_state);

      const history = exportRows(data.notification_history);
      expect(history).toHaveLength(1);
      expect(history[0].sent_at).toBe('2026-05-11T09:30:00.000Z');
      expect(history[0].expires_at).toBe('2026-05-12T09:30:00.000Z');
      expect(history[0].notification_type).toBe('seat_available');
      expect(history[0].class_watch).toEqual(NOTIFICATION_ROW.class_watch);
    });

    it('reports disabled accounts with zeroed active watches', async () => {
      scriptExportRows({
        profile: {
          ...ACTIVE_PROFILE_ROW,
          is_disabled: true,
          disabled_at: '2026-06-01 10:00:00+00',
        },
      });

      const response = await GET(new NextRequest('https://pickmyclass.app/api/user/export'));
      const data = await json(response);

      expect(response.status).toBe(200);
      expect(data.profile).toMatchObject({
        account_status: 'disabled',
        disabled_at: '2026-06-01T10:00:00.000Z',
      });
      expect(data.summary).toMatchObject({ total_watches: 1, active_watches: 0 });
    });

    it('omits unset profile fields while keeping the account-status key present', async () => {
      scriptExportRows({ profile: null });

      const response = await GET(new NextRequest('https://pickmyclass.app/api/user/export'));
      const data = await json(response);

      expect(response.status).toBe(200);
      const profile = exportObject(data.profile);
      expect(profile.account_status).toBe('active');
      expect('age_verified_at' in profile).toBe(false);
      expect('disabled_at' in profile).toBe(false);
    });

    it('returns a 500 response when export generation throws', async () => {
      recorder.outcomes.push(
        [MIRROR_ROW],
        [ACTIVE_PROFILE_ROW],
        new Error('database rejected query')
      );

      const response = await GET(new NextRequest('https://pickmyclass.app/api/user/export'));
      const data = await json(response);

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to export data');
    });
  });

  describe('DELETE /api/user/delete', () => {
    it('rejects account deletion for unauthenticated users', async () => {
      mockRequireUser.mockRejectedValueOnce(new UnauthorizedError());

      const response = await DELETE(
        new Request('https://pickmyclass.app/api/user/delete', { method: 'DELETE' })
      );
      const data = await json(response);

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
      expect(recorder.statements).toHaveLength(0);
    });

    it('soft-deletes authenticated accounts, invalidates cached auth state, and emits the analytics event', async () => {
      const response = await DELETE(
        new Request('https://pickmyclass.app/api/user/delete', { method: 'DELETE' })
      );
      const data = await json(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.disabled_at).toEqual(expect.any(String));
      expect(data.permanent_deletion_date).toEqual(expect.any(String));

      expect(recorder.statements).toHaveLength(1);
      const statement = recorder.statements[0];
      expect(statement.sql).toContain('"user_profiles"');
      expect(statement.params).toEqual(expect.arrayContaining(['user-123']));
      expect(statement.params).toContain(false);

      expect(mockInvalidateAuthorizationState).toHaveBeenCalledWith('user-123');
      expect(mockCaptureServerEvent).toHaveBeenCalledWith('user-123', 'account_deleted', {});
      expect(mockRevokeAllUserSessions).toHaveBeenCalledWith('clerk-456');
    });

    it('fails account deletion when the soft delete update fails', async () => {
      recorder.outcomes.push(new Error('update failed'));

      const response = await DELETE(
        new Request('https://pickmyclass.app/api/user/delete', { method: 'DELETE' })
      );
      const data = await json(response);

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to delete account');
      expect(mockInvalidateAuthorizationState).not.toHaveBeenCalled();
      expect(mockCaptureServerEvent).not.toHaveBeenCalled();
      expect(mockRevokeAllUserSessions).not.toHaveBeenCalled();
    });

    it('still completes account deletion when session revocation fails', async () => {
      mockRevokeAllUserSessions.mockRejectedValueOnce(new Error('signout failed'));

      const response = await DELETE(
        new Request('https://pickmyclass.app/api/user/delete', { method: 'DELETE' })
      );

      expect(response.status).toBe(200);
      const data = await json(response);
      expect(data.success).toBe(true);
      expect(mockCaptureServerEvent).toHaveBeenCalledTimes(1);
    });
  });
});
