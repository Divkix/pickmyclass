import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const { mockCallFunction, mockExecute, mockQueryOne } = vi.hoisted(() => ({
  mockCallFunction: vi.fn(),
  mockExecute: vi.fn(),
  mockQueryOne: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  queryOne: mockQueryOne,
  query: vi.fn(),
  queryScalar: vi.fn(),
  execute: mockExecute,
  callFunction: mockCallFunction,
  callFunctionScalar: vi.fn(),
  getClient: vi.fn(),
}));

import { createLoginAttemptPolicy, loginAttemptPolicy } from '@/lib/auth/login-attempt-policy';

interface StoredAttempt {
  attempts: number;
  lockedUntil: Date | null;
}

class InMemoryLoginAttemptStore {
  readonly events: string[] = [];
  readonly records = new Map<string, StoredAttempt>();

  constructor(private readonly now: () => Date) {}

  async read(email: string) {
    this.events.push(`read:${email}`);
    return this.records.get(email) ?? null;
  }

  async increment(email: string) {
    this.events.push(`increment:${email}`);
    const current = this.records.get(email) ?? { attempts: 0, lockedUntil: null };
    const attempts = current.attempts + 1;
    this.records.set(email, {
      attempts,
      lockedUntil: attempts >= 5 ? new Date(this.now().getTime() + 15 * 60 * 1000) : null,
    });
  }

  async clear(email: string) {
    this.events.push(`clear:${email}`);
    this.records.delete(email);
  }
}

describe('loginAttemptPolicy', () => {
  const now = new Date('2026-07-12T12:00:00.000Z');
  let store: InMemoryLoginAttemptStore;
  // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows createLoginAttemptPolicy return type
  let policy: ReturnType<typeof createLoginAttemptPolicy>;

  beforeEach(() => {
    store = new InMemoryLoginAttemptStore(() => now);
    policy = createLoginAttemptPolicy(store, () => now);
  });

  it('exposes only lock state and remaining time through the public status operation', async () => {
    store.records.set('student@example.com', { attempts: 3, lockedUntil: null });

    await expect(policy.getPublicStatus('STUDENT@EXAMPLE.COM')).resolves.toEqual({
      isLocked: false,
      remainingMinutes: 0,
    });
  });

  it('rejects a pre-existing lock without invoking the credential adapter', async () => {
    store.records.set('student@example.com', {
      attempts: 5,
      lockedUntil: new Date('2026-07-12T12:10:00.000Z'),
    });
    const authenticate = vi.fn();

    await expect(policy.attempt('student@example.com', authenticate)).resolves.toEqual({
      kind: 'locked',
      reason: 'preexisting',
      remainingMinutes: 10,
    });
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('clears an expired lock before authenticating', async () => {
    store.records.set('student@example.com', {
      attempts: 5,
      lockedUntil: new Date('2026-07-12T11:59:00.000Z'),
    });
    const authenticate = vi.fn().mockResolvedValue({ kind: 'authenticated' });

    await expect(policy.attempt('student@example.com', authenticate)).resolves.toEqual({
      kind: 'authenticated',
    });
    expect(store.events).toEqual([
      'read:student@example.com',
      'clear:student@example.com',
      'clear:student@example.com',
    ]);
  });

  it('normalizes email and clears attempts after successful authentication', async () => {
    store.records.set('student@example.com', { attempts: 2, lockedUntil: null });
    const authenticate = vi.fn().mockResolvedValue({ kind: 'authenticated' });

    await expect(policy.attempt('STUDENT@EXAMPLE.COM', authenticate)).resolves.toEqual({
      kind: 'authenticated',
    });
    expect(authenticate).toHaveBeenCalledWith('student@example.com');
    expect(store.records.has('student@example.com')).toBe(false);
  });

  it('increments, rechecks, and calculates remaining attempts after rejection', async () => {
    store.records.set('student@example.com', { attempts: 2, lockedUntil: null });

    await expect(
      policy.attempt('student@example.com', async () => ({
        kind: 'rejected',
        message: 'Invalid login credentials',
      }))
    ).resolves.toEqual({
      kind: 'rejected',
      message: 'Invalid login credentials',
      remainingAttempts: 2,
    });
    expect(store.events).toEqual([
      'read:student@example.com',
      'increment:student@example.com',
      'read:student@example.com',
    ]);
  });

  it('returns a newly-locked decision on the fifth rejection', async () => {
    store.records.set('student@example.com', { attempts: 4, lockedUntil: null });

    await expect(
      policy.attempt('student@example.com', async () => ({ kind: 'rejected' }))
    ).resolves.toEqual({
      kind: 'locked',
      reason: 'newly_locked',
      remainingMinutes: 15,
    });
  });

  it('does not mutate attempt state when authentication reports a disabled account', async () => {
    store.records.set('student@example.com', { attempts: 2, lockedUntil: null });

    await expect(
      policy.attempt('student@example.com', async () => ({ kind: 'disabled' }))
    ).resolves.toEqual({ kind: 'disabled' });
    expect(store.records.get('student@example.com')?.attempts).toBe(2);
  });
});

describe('Supabase login-attempt adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no prior failed-attempt record, successful writes.
    mockQueryOne.mockResolvedValue(null);
    mockCallFunction.mockResolvedValue([]);
    mockExecute.mockResolvedValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the atomic RPC with normalized email and the fixed policy limits', async () => {
    await loginAttemptPolicy.attempt('STUDENT@EXAMPLE.COM', async () => ({
      kind: 'rejected',
    }));

    expect(mockCallFunction).toHaveBeenCalledWith('increment_failed_attempts', [
      'student@example.com',
      5,
      15,
    ]);
  });

  it('does not treat persistence failures as an unlocked account', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('database unavailable'));
    const authenticate = vi.fn();

    await expect(loginAttemptPolicy.attempt('student@example.com', authenticate)).rejects.toThrow(
      'Failed to read login attempts'
    );
    expect(authenticate).not.toHaveBeenCalled();
  });
});
