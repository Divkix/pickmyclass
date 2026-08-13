import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { POST } from '@/app/api/auth/register/route';
import type { ValidationIssueDetail } from '@/lib/api/validation';
import { _resetCache } from '@/lib/auth/disposable-email';

// Response type for register API
interface RegisterResponse {
  success?: boolean;
  error?: string;
  details?: ValidationIssueDetail[] | { duplicate?: boolean };
}

// Mock cloudflare:workers for env import
// vi.hoisted ensures mockKVGet is initialized before the hoisted vi.mock factory runs
const mockKVGet = vi.hoisted(() => vi.fn());
vi.mock('cloudflare:workers', () => ({
  env: {
    NEXT_PUBLIC_SITE_URL: 'https://pickmyclass.app',
    PICKMYCLASS_DISPOSABLE_DOMAINS: {
      get: mockKVGet,
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      getWithMetadata: vi.fn(),
    },
  },
}));

// Mock the Supabase server client
const mockSignUp = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        signUp: mockSignUp,
      },
    })
  ),
}));

// Helper to create NextRequest. Consent flags default to true (required by the
// schema) but can be overridden/omitted by spreading a partial body.
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function createRequest(body: Record<string, JsonValue>): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ ageVerified: true, agreedToTerms: true, ...body }),
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

// Helper to parse response
async function parseResponse(response: Response): Promise<RegisterResponse> {
  return (await response.json()) as RegisterResponse;
}

describe('POST /api/auth/register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetCache();

    // Default: signUp succeeds
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'user-1', identities: [{ id: 'identity-1' }] } },
      error: null,
    });

    // Default: KV returns null (no cached domains)
    mockKVGet.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetCache();
  });

  describe('input validation', () => {
    it('should return 400 for missing email', async () => {
      const request = createRequest({ password: 'StrongP@ss1' });
      const response = await POST(request);
      const data = await parseResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid input');
      expect(data.details).toContainEqual(expect.objectContaining({ field: 'email' }));
    });

    it('should return 400 for missing password', async () => {
      const request = createRequest({ email: 'test@example.com' });
      const response = await POST(request);
      const data = await parseResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid input');
      expect(data.details).toContainEqual(expect.objectContaining({ field: 'password' }));
    });

    it('should return 400 for invalid email format', async () => {
      const request = createRequest({ email: 'not-email', password: 'StrongP@ss1' });
      const response = await POST(request);
      const data = await parseResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid input');
    });

    it('should return 400 for password too short', async () => {
      const request = createRequest({ email: 'test@example.com', password: 'short' });
      const response = await POST(request);
      const data = await parseResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid input');
      expect(data.details).toContainEqual(
        expect.objectContaining({
          field: 'password',
          message: 'Password must be at least 8 characters',
        })
      );
    });
  });

  describe('disposable email validation', () => {
    it('should return 422 for disposable email domain', async () => {
      mockKVGet.mockResolvedValue(JSON.stringify(['mailinator.com', 'tempmail.com']));

      const request = createRequest({ email: 'test@mailinator.com', password: 'StrongP@ss1' });
      const response = await POST(request);
      const data = await parseResponse(response);

      expect(response.status).toBe(422);
      expect(data.error).toContain('not accepted');
      expect(mockSignUp).not.toHaveBeenCalled();
    });

    it('should skip KV check for trusted domains', async () => {
      const request = createRequest({ email: 'test@gmail.com', password: 'StrongP@ss1' });
      const response = await POST(request);
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockKVGet).not.toHaveBeenCalled();
    });

    it('should allow clean non-trusted domain', async () => {
      mockKVGet.mockResolvedValue(JSON.stringify(['mailinator.com']));

      const request = createRequest({ email: 'test@company.com', password: 'StrongP@ss1' });
      const response = await POST(request);
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should fail open when KV is unavailable', async () => {
      mockKVGet.mockRejectedValueOnce(new Error('KV unavailable'));

      const request = createRequest({ email: 'test@unknown-domain.com', password: 'StrongP@ss1' });
      const response = await POST(request);
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe('signup behavior', () => {
    it('passes the Cloudflare auth callback URL to Supabase signup emails', async () => {
      const request = createRequest({ email: 'TEST@EXAMPLE.COM', password: 'StrongP@ss1' });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockSignUp).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'StrongP@ss1',
        options: {
          emailRedirectTo: 'https://pickmyclass.app/auth/callback?next=/dashboard',
          data: {
            age_verified: true,
            agreed_to_terms: true,
          },
        },
      });
    });

    it('should indicate duplicate for already registered email', async () => {
      mockSignUp.mockResolvedValue({
        data: { user: { identities: [] } },
        error: null,
      });

      const request = createRequest({ email: 'test@example.com', password: 'StrongP@ss1' });
      const response = await POST(request);
      const data = await parseResponse(response);

      expect(response.status).toBe(409);
      expect(data.success).toBe(false);
      const details = data.details as { duplicate?: boolean };
      expect(details.duplicate).toBe(true);
      expect(data.error).toContain('already registered');
    });

    it('should return 400 when Supabase returns an error', async () => {
      mockSignUp.mockResolvedValue({
        data: { user: null },
        error: { message: 'Signup disabled' },
      });

      const request = createRequest({ email: 'test@example.com', password: 'StrongP@ss1' });
      const response = await POST(request);
      const data = await parseResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Signup disabled');
    });
  });

  describe('error handling', () => {
    it('should return 500 for unexpected errors', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: 'invalid json',
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await parseResponse(response);

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to create account');
    });
  });
});
