import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  generateUnsubscribeToken,
  generateUnsubscribeUrl,
  verifyUnsubscribeToken,
} from '@/lib/email/unsubscribe-token';

describe('Unsubscribe Token utilities', () => {
  const testUserId = 'user-123-abc';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
    process.env.UNSUBSCRIBE_SIGNING_SECRET = 'test-signing-secret-for-unsubscribe';
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.UNSUBSCRIBE_SIGNING_SECRET;
  });

  describe('generateUnsubscribeToken', () => {
    it('should generate a non-empty token', () => {
      const token = generateUnsubscribeToken(testUserId);
      expect(token).toBeDefined();
      expect(token.length).toBeGreaterThan(0);
    });

    it('should generate different tokens for different users', () => {
      const token1 = generateUnsubscribeToken('user-1');
      const token2 = generateUnsubscribeToken('user-2');
      expect(token1).not.toBe(token2);
    });

    it('should include HMAC signature', () => {
      const token = generateUnsubscribeToken(testUserId);
      const decoded = Buffer.from(token, 'base64url').toString('utf-8');
      const parts = decoded.split(':');

      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe(testUserId);
      expect(parts[2]).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('verifyUnsubscribeToken', () => {
    it('should verify a valid token and return userId', () => {
      const token = generateUnsubscribeToken(testUserId);
      const result = verifyUnsubscribeToken(token);
      expect(result).toBe(testUserId);
    });

    it('should return null for expired token', () => {
      const token = generateUnsubscribeToken(testUserId, 1);

      vi.advanceTimersByTime(2 * 24 * 60 * 60 * 1000);

      const result = verifyUnsubscribeToken(token);
      expect(result).toBeNull();
    });

    it('should return null for tampered userId', () => {
      const token = generateUnsubscribeToken(testUserId);
      const decoded = Buffer.from(token, 'base64url').toString('utf-8');
      const parts = decoded.split(':');

      parts[0] = 'tampered-user-id';
      const tamperedToken = Buffer.from(parts.join(':')).toString('base64url');

      const result = verifyUnsubscribeToken(tamperedToken);
      expect(result).toBeNull();
    });

    it('should return null for invalid token format (missing parts)', () => {
      const invalidToken = Buffer.from('invalid:token').toString('base64url');
      const result = verifyUnsubscribeToken(invalidToken);
      expect(result).toBeNull();
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
  });
});
