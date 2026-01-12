import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateUnsubscribeToken,
  generateUnsubscribeUrl,
  verifyUnsubscribeToken,
} from '@/lib/email/unsubscribe-token';

describe('Unsubscribe Token utilities', () => {
  const testUserId = 'user-123-abc';

  // Mock Date.now for consistent testing
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('generateUnsubscribeToken', () => {
    it('should generate a non-empty token', () => {
      const token = generateUnsubscribeToken(testUserId);
      expect(token).toBeDefined();
      expect(token.length).toBeGreaterThan(0);
    });

    it('should generate a base64url-encoded token', () => {
      const token = generateUnsubscribeToken(testUserId);
      // Base64url uses only A-Za-z0-9_-
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should generate different tokens for different users', () => {
      const token1 = generateUnsubscribeToken('user-1');
      const token2 = generateUnsubscribeToken('user-2');
      expect(token1).not.toBe(token2);
    });

    it('should generate different tokens for different expiration times', () => {
      const token1 = generateUnsubscribeToken(testUserId, 30);
      const token2 = generateUnsubscribeToken(testUserId, 60);
      expect(token1).not.toBe(token2);
    });

    it('should default to 90 days expiration', () => {
      const token = generateUnsubscribeToken(testUserId);
      const decoded = Buffer.from(token, 'base64url').toString('utf-8');
      const parts = decoded.split(':');
      const expiresAt = parseInt(parts[1], 10);

      // Current time + 90 days in milliseconds
      const expectedExpiry = Date.now() + 90 * 24 * 60 * 60 * 1000;
      expect(expiresAt).toBe(expectedExpiry);
    });

    it('should allow custom expiration days', () => {
      const customDays = 30;
      const token = generateUnsubscribeToken(testUserId, customDays);
      const decoded = Buffer.from(token, 'base64url').toString('utf-8');
      const parts = decoded.split(':');
      const expiresAt = parseInt(parts[1], 10);

      const expectedExpiry = Date.now() + customDays * 24 * 60 * 60 * 1000;
      expect(expiresAt).toBe(expectedExpiry);
    });

    it('should include HMAC signature', () => {
      const token = generateUnsubscribeToken(testUserId);
      const decoded = Buffer.from(token, 'base64url').toString('utf-8');
      const parts = decoded.split(':');

      // Token format: userId:expiresAt:signature
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe(testUserId);
      expect(parts[2]).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex digest is 64 chars
    });
  });

  describe('verifyUnsubscribeToken', () => {
    it('should verify a valid token and return userId', () => {
      const token = generateUnsubscribeToken(testUserId);
      const result = verifyUnsubscribeToken(token);
      expect(result).toBe(testUserId);
    });

    it('should return null for expired token', () => {
      const token = generateUnsubscribeToken(testUserId, 1); // 1 day

      // Advance time by 2 days
      vi.advanceTimersByTime(2 * 24 * 60 * 60 * 1000);

      const result = verifyUnsubscribeToken(token);
      expect(result).toBeNull();
    });

    it('should return null for tampered userId', () => {
      const token = generateUnsubscribeToken(testUserId);
      const decoded = Buffer.from(token, 'base64url').toString('utf-8');
      const parts = decoded.split(':');

      // Tamper with userId
      parts[0] = 'tampered-user-id';
      const tamperedToken = Buffer.from(parts.join(':')).toString('base64url');

      const result = verifyUnsubscribeToken(tamperedToken);
      expect(result).toBeNull();
    });

    it('should return null for tampered expiration', () => {
      const token = generateUnsubscribeToken(testUserId);
      const decoded = Buffer.from(token, 'base64url').toString('utf-8');
      const parts = decoded.split(':');

      // Tamper with expiration (extend it)
      parts[1] = String(Date.now() + 365 * 24 * 60 * 60 * 1000);
      const tamperedToken = Buffer.from(parts.join(':')).toString('base64url');

      const result = verifyUnsubscribeToken(tamperedToken);
      expect(result).toBeNull();
    });

    it('should return null for tampered signature', () => {
      const token = generateUnsubscribeToken(testUserId);
      const decoded = Buffer.from(token, 'base64url').toString('utf-8');
      const parts = decoded.split(':');

      // Tamper with signature
      parts[2] = 'a'.repeat(64);
      const tamperedToken = Buffer.from(parts.join(':')).toString('base64url');

      const result = verifyUnsubscribeToken(tamperedToken);
      expect(result).toBeNull();
    });

    it('should return null for invalid token format (missing parts)', () => {
      const invalidToken = Buffer.from('invalid:token').toString('base64url');
      const result = verifyUnsubscribeToken(invalidToken);
      expect(result).toBeNull();
    });

    it('should return null for invalid base64 encoding', () => {
      const result = verifyUnsubscribeToken('not-valid-base64!!!');
      expect(result).toBeNull();
    });

    it('should return null for empty token', () => {
      const result = verifyUnsubscribeToken('');
      expect(result).toBeNull();
    });

    it('should handle special characters in userId', () => {
      const specialUserId = 'user@123_test-id.v1';
      const token = generateUnsubscribeToken(specialUserId);
      const result = verifyUnsubscribeToken(token);
      expect(result).toBe(specialUserId);
    });

    it('should handle UUID format userId', () => {
      const uuidUserId = '550e8400-e29b-41d4-a716-446655440000';
      const token = generateUnsubscribeToken(uuidUserId);
      const result = verifyUnsubscribeToken(token);
      expect(result).toBe(uuidUserId);
    });
  });

  describe('generateUnsubscribeUrl', () => {
    it('should generate URL with token', () => {
      const url = generateUnsubscribeUrl(testUserId);
      expect(url).toContain('/api/unsubscribe?token=');
    });

    it('should use provided base URL', () => {
      const customBaseUrl = 'https://custom.domain.com';
      const url = generateUnsubscribeUrl(testUserId, customBaseUrl);
      expect(url.startsWith(customBaseUrl)).toBe(true);
    });

    it('should use environment variable when no base URL provided', () => {
      const url = generateUnsubscribeUrl(testUserId);
      expect(url.startsWith('https://test.example.com')).toBe(true);
    });

    it('should generate valid URL', () => {
      const url = generateUnsubscribeUrl(testUserId);
      expect(() => new URL(url)).not.toThrow();
    });

    it('should include token query parameter', () => {
      const url = generateUnsubscribeUrl(testUserId);
      const parsedUrl = new URL(url);
      expect(parsedUrl.searchParams.has('token')).toBe(true);
      expect(parsedUrl.searchParams.get('token')?.length).toBeGreaterThan(0);
    });

    it('should generate verifiable token in URL', () => {
      const url = generateUnsubscribeUrl(testUserId);
      const parsedUrl = new URL(url);
      const token = parsedUrl.searchParams.get('token');
      const result = verifyUnsubscribeToken(token!);
      expect(result).toBe(testUserId);
    });
  });

  describe('round-trip token lifecycle', () => {
    it('should work end-to-end: generate URL -> extract token -> verify', () => {
      const userId = 'test-user-lifecycle';
      const url = generateUnsubscribeUrl(userId);
      const parsedUrl = new URL(url);
      const token = parsedUrl.searchParams.get('token');
      const verifiedUserId = verifyUnsubscribeToken(token!);
      expect(verifiedUserId).toBe(userId);
    });

    it('should work with token just before expiration', () => {
      const token = generateUnsubscribeToken(testUserId, 1);

      // Advance time to just before expiration (23 hours 59 minutes)
      vi.advanceTimersByTime(23 * 60 * 60 * 1000 + 59 * 60 * 1000);

      const result = verifyUnsubscribeToken(token);
      expect(result).toBe(testUserId);
    });

    it('should fail with token just after expiration', () => {
      const token = generateUnsubscribeToken(testUserId, 1);

      // Advance time to just after expiration (24 hours + 1 second)
      vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1000);

      const result = verifyUnsubscribeToken(token);
      expect(result).toBeNull();
    });
  });
});
