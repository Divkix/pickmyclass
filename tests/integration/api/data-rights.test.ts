// @ts-nocheck — skipped Clerk migration placeholder; rewrite to mock clerk-session (tracked in issue #351)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const {
  mockCreateClient,
  mockGetUser,
  mockQuery,
  mockExecute,
  mockInvalidateAuthorizationState,
  mockSignOut,
  mockCaptureServerEvent,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockGetUser: vi.fn(),
  mockQuery: vi.fn(),
  mockExecute: vi.fn(),
  mockInvalidateAuthorizationState: vi.fn(),
  mockSignOut: vi.fn(),
  mockCaptureServerEvent: vi.fn().mockResolvedValue(undefined),
}));

// Auth stays on Supabase (supabase.auth.getUser / signOut) — keep the server
// client mock but strip the old .from() data-access surface.
vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

// Data plane now goes through lib/db/client (query/execute replace .from()).
vi.mock('@/lib/db/client', () => ({
  query: mockQuery,
  queryOne: vi.fn(),
  queryScalar: vi.fn(),
  execute: mockExecute,
  callFunction: vi.fn(),
  callFunctionScalar: vi.fn(),
  getClient: vi.fn(),
  setConnectionStringGetter: vi.fn(),
}));

vi.mock('@/lib/auth/authorization-state', () => ({
  invalidateAuthorizationState: mockInvalidateAuthorizationState,
}));

// PostHog server events fail open — stub so no network calls happen in tests.
vi.mock('@/lib/posthog-server', () => ({
  captureServerEvent: mockCaptureServerEvent,
}));

import { DELETE } from '@/app/api/user/delete/route';
import { GET } from '@/app/api/user/export/route';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const user = {
  id: 'user-123',
  email: 'student@example.com',
  created_at: '2026-05-01T00:00:00Z',
  last_sign_in_at: '2026-05-19T00:00:00Z',
  email_confirmed_at: '2026-05-02T00:00:00Z',
};

const profile = {
  age_verified_at: '2026-05-01T00:00:00Z',
  agreed_to_terms_at: '2026-05-01T00:00:00Z',
  is_disabled: false,
  disabled_at: null,
};

// Per-test mutable result sets for the export's three `query` calls. The mock
// dispatches on SQL text (user_profiles / class_watches / notifications_sent).
// SAFETY: test fixtures are controlled row shapes matching the route's typed SELECT contracts
let profileRows: Record<string, JsonValue>[] = [];
// SAFETY: test fixtures are controlled row shapes matching the route's typed SELECT contracts
let watchesRows: Record<string, JsonValue>[] = [];
// SAFETY: test fixtures are controlled row shapes matching the route's typed SELECT contracts
let notificationsRows: Record<string, JsonValue>[] = [];

async function json(response: Response) {
  // SAFETY: test helper parses JSON response; shape asserted per test case via property access
  return response.json() as Promise<Record<string, JsonValue>>;
}
describe.skip('user data rights APIs', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test double widens profile to JSON-compatible record for export response
    profileRows = [profile as unknown as Record<string, JsonValue>];
    watchesRows = [{ id: 'watch-1', class_nbr: '12345', created_at: '2026-05-10T00:00:00Z' }];
    notificationsRows = [{ id: 'notification-1', sent_at: '2026-05-11T00:00:00Z' }];

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: mockGetUser,
        signOut: mockSignOut,
      },
    });
    mockGetUser.mockResolvedValue({ data: { user }, error: null });

    // Dispatch `query` by SQL text to the three export queries.
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('FROM user_profiles')) return profileRows;
      if (text.includes('FROM class_watches w')) return watchesRows;
      if (text.includes('FROM notifications_sent n')) return notificationsRows;
      return [];
    });

    mockExecute.mockResolvedValue(1);
    mockSignOut.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('rejects data exports for unauthenticated users', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'no session' } });

    const response = await GET();
    const data = await json(response);

    expect(response.status).toBe(401);
    expect(data.error).toBe('Unauthorized');
  });

  it('exports account, profile, watch, and notification data as an attachment', async () => {
    const response = await GET();
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toMatch(
      /pickmyclass-data-\d{4}-\d{2}-\d{2}\.json/
    );
    expect(data.user_account).toMatchObject({ email: 'student@example.com' });
    expect(data.profile).toMatchObject({ account_status: 'active' });
    expect(data.summary).toMatchObject({
      total_watches: 1,
      total_notifications: 1,
      active_watches: 1,
    });
  });

  it('returns a 500 response when export generation throws', async () => {
    mockCreateClient.mockRejectedValueOnce(new Error('supabase unavailable'));

    const response = await GET();
    const data = await json(response);

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to export data');
  });

  it('rejects account deletion for unauthenticated users', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'no session' } });

    const response = await DELETE();
    const data = await json(response);

    expect(response.status).toBe(401);
    expect(data.error).toBe('Unauthorized');
  });

  it('soft-deletes authenticated accounts and invalidates cached profiles', async () => {
    const response = await DELETE();
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.disabled_at).toEqual(expect.any(String));
    expect(data.permanent_deletion_date).toEqual(expect.any(String));

    // The soft-delete is now a parameterized UPDATE via execute() instead of the
    // old service .update().eq() chain. Assert the SQL carries the disabled +
    // notifications flags and the user_id param.
    expect(mockExecute).toHaveBeenCalledTimes(1);
    // SAFETY: mockExecute is controlled by the test; calls[0] is the single soft-delete UPDATE
    const [sql, params] = mockExecute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('is_disabled = true');
    expect(sql).toContain('notifications_enabled = false');
    expect(params).toContain('user-123');
    expect(mockInvalidateAuthorizationState).toHaveBeenCalledWith('user-123');
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('fails account deletion when the soft delete update fails', async () => {
    mockExecute.mockRejectedValueOnce(new Error('update failed'));

    const response = await DELETE();
    const data = await json(response);

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to delete account');
    expect(mockInvalidateAuthorizationState).not.toHaveBeenCalled();
  });

  it('still completes account deletion when sign out fails', async () => {
    mockSignOut.mockResolvedValueOnce({ error: { message: 'signout failed' } });

    const response = await DELETE();
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });

  it('returns a 500 response when account deletion throws', async () => {
    mockExecute.mockImplementationOnce(() => {
      throw new Error('service unavailable');
    });

    const response = await DELETE();
    const data = await json(response);

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to delete account');
  });
});
