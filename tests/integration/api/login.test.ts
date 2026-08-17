import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { POST } from '@/app/api/auth/login/route';
import type { ValidationIssueDetail } from '@/lib/api/validation';

// Response type for login API
interface LoginResponse {
  success?: boolean;
  error?: string;
  details?:
    | ValidationIssueDetail[]
    | {
        isLocked?: boolean;
        remainingMinutes?: number;
        remainingAttempts?: number;
      };
}

const { mockAttempt } = vi.hoisted(() => ({ mockAttempt: vi.fn() }));

vi.mock('@/lib/auth/login-attempt-policy', () => ({
  loginAttemptPolicy: { attempt: mockAttempt },
}));

// Mock the Supabase server client
const mockSignInWithPassword = vi.fn();
const mockSignOut = vi.fn();

// Default mock for user_profiles query (non-disabled user).
// readAuthorizationState uses .maybeSingle(); older call sites used .single() —
// expose both so the chain works regardless.
const mockSingle = vi.fn().mockResolvedValue({
  data: { is_disabled: false },
  error: null,
});
const mockEq = vi.fn().mockReturnValue({ single: mockSingle, maybeSingle: mockSingle });
const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        signInWithPassword: mockSignInWithPassword,
        signOut: mockSignOut,
      },
      from: mockFrom,
    })
  ),
}));

// Helper to create NextRequest
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function createRequest(body: Record<string, JsonValue>): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
// Helper to parse response
async function parseResponse(response: Response): Promise<LoginResponse> {
  // SAFETY: test helper parses mocked fetch Response JSON; shape is LoginResponse per route contract and test fixtures
  return (await response.json()) as LoginResponse;
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
    vi.clearAllMocks();

    mockAttempt.mockImplementation(async (email, authenticate) => {
      const result = await authenticate(email.toLowerCase());

      return result.kind === 'rejected'
        ? {
            kind: 'rejected',
            message: result.message ?? 'Invalid email or password',
            remainingAttempts: 4,
          }
        : result;
    });

    // Reset profile query mock to return non-disabled user by default
    mockSingle.mockResolvedValue({
      data: { is_disabled: false },
      error: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('input validation', () => {
    it('should return 400 for missing email', async () => {
      const request = createRequest({ password: 'password123' });
      const response = await POST(request);
      const data = await parseResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid input');
      expect(data.details).toContainEqual(
        expect.objectContaining({
          field: 'email',
        })
      );
    });

    it('should return 400 for missing password', async () => {
      const request = createRequest({ email: 'test@example.com' });
      const response = await POST(request);
      const data = await parseResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid input');
      expect(data.details).toContainEqual(
        expect.objectContaining({
          field: 'password',
        })
      );
    });

    it('should return 400 for invalid email format', async () => {
      const request = createRequest({ email: 'not-an-email', password: 'password123' });
      const response = await POST(request);
      const data = await parseResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid input');
    });

    it('should return 400 for empty email', async () => {
      const request = createRequest({ email: '', password: 'password123' });
      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    it('should return 400 for empty password', async () => {
      const request = createRequest({ email: 'test@example.com', password: '' });
      const response = await POST(request);

      expect(response.status).toBe(400);
    });
  });

  describe('account lockout', () => {
    it('should return 423 when account is locked', async () => {
      mockAttempt.mockResolvedValue({
        kind: 'locked',
        reason: 'preexisting',
        remainingMinutes: 15,
      });

      const request = createRequest({ email: 'test@example.com', password: 'password123' });
      const response = await POST(request);
      const data = await parseResponse(response);

      expect(response.status).toBe(423);
      expect(data.success).toBe(false);
      // SAFETY: test narrows LoginResponse details to lockout shape; mocked locked attempt guarantees this variant
      const details = data.details as { isLocked?: boolean; remainingMinutes?: number };
      expect(details.isLocked).toBe(true);
      expect(details.remainingMinutes).toBe(15);
      expect(mockSignInWithPassword).not.toHaveBeenCalled();
    });

    it('should normalize email to lowercase before authentication', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null,
      });

      const request = createRequest({ email: 'TEST@EXAMPLE.COM', password: 'password123' });
      await POST(request);

      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      });
    });
  });

  describe('successful login', () => {
    it('should return success for valid credentials', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null,
      });

      const request = createRequest({ email: 'test@example.com', password: 'password123' });
      const response = await POST(request);
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe('failed login', () => {
    it('should return 401 for invalid credentials', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: null,
        error: { message: 'Invalid login credentials' },
      });

      const request = createRequest({ email: 'test@example.com', password: 'wrongpassword' });
      const response = await POST(request);
      const data = await parseResponse(response);

      expect(response.status).toBe(401);
      expect(data.error).toBe('Invalid login credentials');
    });

    it('should include remaining attempts in response', async () => {
      mockAttempt.mockResolvedValue({
        kind: 'rejected',
        message: 'Invalid login credentials',
        remainingAttempts: 2,
      });

      const request = createRequest({ email: 'test@example.com', password: 'wrongpassword' });
      const response = await POST(request);
      const data = await parseResponse(response);

      // SAFETY: test narrows LoginResponse details to remainingAttempts shape; mocked rejected attempt guarantees this variant
      const details = data.details as { remainingAttempts?: number };
      expect(details.remainingAttempts).toBe(2);
    });

    it('should return 423 when account becomes locked after failed attempt', async () => {
      mockAttempt.mockResolvedValue({
        kind: 'locked',
        reason: 'newly_locked',
        remainingMinutes: 15,
      });

      const request = createRequest({ email: 'test@example.com', password: 'wrongpassword' });
      const response = await POST(request);
      const data = await parseResponse(response);

      expect(response.status).toBe(423);
      expect(data.success).toBe(false);
      // SAFETY: test narrows LoginResponse details to lockout shape; response status 423 guarantees this variant in fixture
      const details = data.details as { isLocked?: boolean };
      expect(details.isLocked).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should return 500 for unexpected errors', async () => {
      // Make request.json() throw an error by providing invalid JSON
      const request = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        body: 'invalid json',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const response = await POST(request);
      const data = await parseResponse(response);

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to sign in');
    });
  });

  describe('disabled account', () => {
    it('should return 403 when user is disabled', async () => {
      // Mock signInWithPassword to succeed (user has valid credentials)
      mockSignInWithPassword.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      // Mock the from/maybeSingle chain for checking user profile
      const mockSingle = vi.fn().mockResolvedValue({
        data: { is_disabled: true },
        error: null,
      });
      const mockEq = vi.fn().mockReturnValue({ single: mockSingle, maybeSingle: mockSingle });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

      // Mock the signOut function
      const mockSignOut = vi.fn().mockResolvedValue({ error: null });

      // Override the createClient mock for this test to include from() and signOut()
      const { createClient } = await import('@/lib/supabase/server');
      // SAFETY: test mock provides only partial Supabase client shape required by route; cast via never is safe in test harness
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          signInWithPassword: mockSignInWithPassword,
          signOut: mockSignOut,
        },
        from: mockFrom,
      } as never);

      const request = createRequest({ email: 'disabled@example.com', password: 'validpassword' });
      const response = await POST(request);
      const data = await parseResponse(response);

      expect(response.status).toBe(403);
      expect(data.error).toBe('Account has been disabled');
      expect(mockFrom).toHaveBeenCalledWith('user_profiles');
      expect(mockSignOut).toHaveBeenCalled();
    });

    it('should allow login for non-disabled users', async () => {
      // Mock signInWithPassword to succeed
      mockSignInWithPassword.mockResolvedValue({
        data: { user: { id: 'user-456' } },
        error: null,
      });

      // Mock the from/maybeSingle chain to return non-disabled user
      const mockSingle = vi.fn().mockResolvedValue({
        data: { is_disabled: false },
        error: null,
      });
      const mockEq = vi.fn().mockReturnValue({ single: mockSingle, maybeSingle: mockSingle });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });
      const { createClient } = await import('@/lib/supabase/server');
      // SAFETY: test mock provides only partial Supabase client shape required by route; cast via never is safe in test harness
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          signInWithPassword: mockSignInWithPassword,
        },
        from: mockFrom,
      } as never);

      const request = createRequest({ email: 'active@example.com', password: 'validpassword' });
      const response = await POST(request);
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockFrom).toHaveBeenCalledWith('user_profiles');
    });
  });
});
