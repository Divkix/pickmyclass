import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

// Create mock chain with proper structure including RPC
const createMockChain = () => {
  const mockData = { current: null as unknown };
  const mockError = { current: null as { message: string; code: string } | null };
  const mockRpcResult = {
    current: { data: null, error: null } as { data: unknown; error: unknown },
  };

  const chain = {
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn(),
    delete: vi.fn(),
    rpc: vi.fn(),
  };

  chain.from.mockReturnValue({
    select: chain.select,
    delete: chain.delete,
  });

  chain.select.mockReturnValue({
    eq: chain.eq,
  });

  chain.eq.mockReturnValue({
    single: chain.single,
  });

  chain.delete.mockReturnValue({
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  });

  chain.single.mockImplementation(() =>
    Promise.resolve({ data: mockData.current, error: mockError.current })
  );

  chain.rpc.mockImplementation(() => Promise.resolve(mockRpcResult.current));

  return {
    ...chain,
    setMockData: (data: unknown) => {
      mockData.current = data;
    },
    setMockError: (error: { message: string; code: string } | null) => {
      mockError.current = error;
    },
    setMockRpcResult: (result: { data: unknown; error: unknown }) => {
      mockRpcResult.current = result;
    },
    reset: () => {
      mockData.current = null;
      mockError.current = null;
      mockRpcResult.current = { data: null, error: null };
      vi.clearAllMocks();
    },
  };
};

const mockChain = createMockChain();

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: vi.fn(() => ({
    from: mockChain.from,
    rpc: mockChain.rpc,
  })),
}));

// Import after mocking
const {
  MAX_FAILED_ATTEMPTS,
  checkLockoutStatus,
  clearFailedAttempts,
  getRemainingLockoutTime,
  incrementFailedAttempts,
} = await import('@/lib/auth/lockout');

describe('Lockout utilities', () => {
  const testEmail = 'test@example.com';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
    mockChain.reset();
    // Re-setup mock chain after reset
    mockChain.from.mockReturnValue({
      select: mockChain.select,
      delete: mockChain.delete,
    });
    mockChain.select.mockReturnValue({
      eq: mockChain.eq,
    });
    mockChain.eq.mockReturnValue({
      single: mockChain.single,
    });
    mockChain.delete.mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('MAX_FAILED_ATTEMPTS constant', () => {
    it('should be defined as 5', () => {
      expect(MAX_FAILED_ATTEMPTS).toBe(5);
    });
  });

  describe('getRemainingLockoutTime', () => {
    it('should return 0 for null input', () => {
      expect(getRemainingLockoutTime(null)).toBe(0);
    });

    it('should return 0 for past date', () => {
      const pastDate = new Date('2024-06-14T12:00:00Z');
      expect(getRemainingLockoutTime(pastDate)).toBeLessThanOrEqual(0);
    });

    it('should return positive minutes for future date', () => {
      const futureDate = new Date('2024-06-15T12:15:00Z'); // 15 minutes from now
      expect(getRemainingLockoutTime(futureDate)).toBe(15);
    });

    it('should round up partial minutes', () => {
      const futureDate = new Date('2024-06-15T12:10:30Z'); // 10.5 minutes from now
      expect(getRemainingLockoutTime(futureDate)).toBe(11);
    });

    it('should handle exactly 1 minute remaining', () => {
      const futureDate = new Date('2024-06-15T12:01:00Z');
      expect(getRemainingLockoutTime(futureDate)).toBe(1);
    });

    it('should handle large time differences', () => {
      const futureDate = new Date('2024-06-16T12:00:00Z'); // 24 hours from now
      expect(getRemainingLockoutTime(futureDate)).toBe(1440);
    });
  });

  describe('checkLockoutStatus', () => {
    it('should return unlocked status when no record exists', async () => {
      mockChain.setMockError({ message: 'Not found', code: 'PGRST116' });
      mockChain.setMockData(null);

      const result = await checkLockoutStatus(testEmail);

      expect(result).toEqual({
        isLocked: false,
        attempts: 0,
        lockedUntil: null,
      });
    });

    it('should return unlocked status with attempts when not locked', async () => {
      mockChain.setMockData({
        email: testEmail,
        attempts: 2,
        locked_until: null,
      });
      mockChain.setMockError(null);

      const result = await checkLockoutStatus(testEmail);

      expect(result).toEqual({
        isLocked: false,
        attempts: 2,
        lockedUntil: null,
      });
    });

    it('should return locked status when lockout is active', async () => {
      const lockedUntil = new Date('2024-06-15T12:15:00Z'); // 15 minutes from now

      mockChain.setMockData({
        email: testEmail,
        attempts: 5,
        locked_until: lockedUntil.toISOString(),
      });
      mockChain.setMockError(null);

      const result = await checkLockoutStatus(testEmail);

      expect(result.isLocked).toBe(true);
      expect(result.attempts).toBe(5);
      expect(result.lockedUntil).toEqual(lockedUntil);
    });

    it('should clear expired lockout and return unlocked', async () => {
      const expiredLockout = new Date('2024-06-15T11:45:00Z'); // 15 minutes ago

      mockChain.setMockData({
        email: testEmail,
        attempts: 5,
        locked_until: expiredLockout.toISOString(),
      });
      mockChain.setMockError(null);

      const result = await checkLockoutStatus(testEmail);

      expect(result.isLocked).toBe(false);
      expect(result.attempts).toBe(0);
    });
  });

  describe('incrementFailedAttempts', () => {
    it('should call RPC with normalized email and max attempts', async () => {
      mockChain.setMockRpcResult({ data: { attempts: 1, locked: false }, error: null });

      await incrementFailedAttempts(testEmail);

      expect(mockChain.rpc).toHaveBeenCalledWith('increment_failed_attempts', {
        p_email: testEmail.toLowerCase(),
        p_max_attempts: 5,
        p_lockout_minutes: 15,
      });
    });

    it('should normalize email to lowercase', async () => {
      mockChain.setMockRpcResult({ data: { attempts: 1, locked: false }, error: null });

      await incrementFailedAttempts('TEST@EXAMPLE.COM');

      expect(mockChain.rpc).toHaveBeenCalledWith('increment_failed_attempts', {
        p_email: 'test@example.com',
        p_max_attempts: 5,
        p_lockout_minutes: 15,
      });
    });

    it('should throw error when RPC fails', async () => {
      mockChain.setMockRpcResult({ data: null, error: { message: 'Database error' } });

      await expect(incrementFailedAttempts(testEmail)).rejects.toThrow(
        'Failed to record login attempt'
      );
    });

    it('should handle lockout response from RPC', async () => {
      mockChain.setMockRpcResult({ data: { attempts: 5, locked: true }, error: null });

      await incrementFailedAttempts(testEmail);

      expect(mockChain.rpc).toHaveBeenCalledWith('increment_failed_attempts', {
        p_email: testEmail.toLowerCase(),
        p_max_attempts: 5,
        p_lockout_minutes: 15,
      });
    });
  });

  describe('clearFailedAttempts', () => {
    it('should delete the failed login record', async () => {
      await clearFailedAttempts(testEmail);

      expect(mockChain.from).toHaveBeenCalledWith('failed_login_attempts');
      expect(mockChain.delete).toHaveBeenCalled();
    });

    it('should normalize email to lowercase', async () => {
      const mockDeleteEq = vi.fn().mockResolvedValue({ data: null, error: null });
      mockChain.delete.mockReturnValue({
        eq: mockDeleteEq,
      });

      await clearFailedAttempts('TEST@EXAMPLE.COM');

      expect(mockDeleteEq).toHaveBeenCalledWith('email', 'test@example.com');
    });
  });
});
