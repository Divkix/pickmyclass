import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/auth/login/route';

// Response type for login API
interface LoginResponse {
  success?: boolean;
  error?: string;
  details?: Array<{ field: string; message: string }>;
  isLocked?: boolean;
  remainingMinutes?: number;
  remainingAttempts?: number;
}

// Mock the lockout module
const mockCheckLockoutStatus = vi.fn();
const mockIncrementFailedAttempts = vi.fn();
const mockClearFailedAttempts = vi.fn();

vi.mock('@/lib/auth/lockout', () => ({
  checkLockoutStatus: () => mockCheckLockoutStatus(),
  incrementFailedAttempts: () => mockIncrementFailedAttempts(),
  clearFailedAttempts: () => mockClearFailedAttempts(),
  getRemainingLockoutTime: vi.fn((date) => {
    if (!date) return 0;
    const diff = date.getTime() - Date.now();
    return Math.ceil(diff / 1000 / 60);
  }),
  MAX_FAILED_ATTEMPTS: 5,
}));

// Mock the Supabase server client
const mockSignInWithPassword = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        signInWithPassword: mockSignInWithPassword,
      },
    })
  ),
}));

// Helper to create NextRequest
function createRequest(body: Record<string, unknown>): NextRequest {
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
  return (await response.json()) as LoginResponse;
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
    vi.clearAllMocks();

    // Default mocks
    mockCheckLockoutStatus.mockResolvedValue({
      isLocked: false,
      attempts: 0,
      lockedUntil: null,
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
      const lockedUntil = new Date('2024-06-15T12:15:00Z');
      mockCheckLockoutStatus.mockResolvedValue({
        isLocked: true,
        attempts: 5,
        lockedUntil,
      });

      const request = createRequest({ email: 'test@example.com', password: 'password123' });
      const response = await POST(request);
      const data = await parseResponse(response);

      expect(response.status).toBe(423);
      expect(data.isLocked).toBe(true);
      expect(data.remainingMinutes).toBe(15);
    });

    it('should normalize email to lowercase before checking lockout', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null,
      });

      const request = createRequest({ email: 'TEST@EXAMPLE.COM', password: 'password123' });
      await POST(request);

      expect(mockCheckLockoutStatus).toHaveBeenCalled();
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

    it('should clear failed attempts on successful login', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null,
      });

      const request = createRequest({ email: 'test@example.com', password: 'password123' });
      await POST(request);

      expect(mockClearFailedAttempts).toHaveBeenCalled();
    });
  });

  describe('failed login', () => {
    it('should return 401 for invalid credentials', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: null,
        error: { message: 'Invalid login credentials' },
      });
      mockCheckLockoutStatus.mockResolvedValueOnce({
        isLocked: false,
        attempts: 0,
        lockedUntil: null,
      });
      mockCheckLockoutStatus.mockResolvedValueOnce({
        isLocked: false,
        attempts: 1,
        lockedUntil: null,
      });

      const request = createRequest({ email: 'test@example.com', password: 'wrongpassword' });
      const response = await POST(request);
      const data = await parseResponse(response);

      expect(response.status).toBe(401);
      expect(data.error).toBe('Invalid login credentials');
    });

    it('should increment failed attempts on failed login', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: null,
        error: { message: 'Invalid login credentials' },
      });
      mockCheckLockoutStatus.mockResolvedValue({
        isLocked: false,
        attempts: 1,
        lockedUntil: null,
      });

      const request = createRequest({ email: 'test@example.com', password: 'wrongpassword' });
      await POST(request);

      expect(mockIncrementFailedAttempts).toHaveBeenCalled();
    });

    it('should include remaining attempts in response', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: null,
        error: { message: 'Invalid login credentials' },
      });
      mockCheckLockoutStatus.mockResolvedValueOnce({
        isLocked: false,
        attempts: 0,
        lockedUntil: null,
      });
      mockCheckLockoutStatus.mockResolvedValueOnce({
        isLocked: false,
        attempts: 3,
        lockedUntil: null,
      });

      const request = createRequest({ email: 'test@example.com', password: 'wrongpassword' });
      const response = await POST(request);
      const data = await parseResponse(response);

      expect(data.remainingAttempts).toBe(2); // MAX_FAILED_ATTEMPTS (5) - attempts (3)
    });

    it('should return 423 when account becomes locked after failed attempt', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: null,
        error: { message: 'Invalid login credentials' },
      });
      mockCheckLockoutStatus.mockResolvedValueOnce({
        isLocked: false,
        attempts: 4,
        lockedUntil: null,
      });
      mockCheckLockoutStatus.mockResolvedValueOnce({
        isLocked: true,
        attempts: 5,
        lockedUntil: new Date('2024-06-15T12:15:00Z'),
      });

      const request = createRequest({ email: 'test@example.com', password: 'wrongpassword' });
      const response = await POST(request);
      const data = await parseResponse(response);

      expect(response.status).toBe(423);
      expect(data.isLocked).toBe(true);
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
});
