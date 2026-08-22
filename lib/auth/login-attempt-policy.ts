import { callFunction, execute, queryOne } from '@/lib/db/client';
import type { IncrementFailedAttemptsRpcRow } from '@/lib/db/types';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 15;

interface LoginAttemptRecord {
  attempts: number;
  lockedUntil: Date | null;
}

/** Internal persistence seam. Production uses Supabase; tests use memory. */
interface LoginAttemptStore {
  read(email: string): Promise<LoginAttemptRecord | null>;
  increment(email: string): Promise<void>;
  clear(email: string): Promise<void>;
}

type AuthenticationResult =
  | { kind: 'authenticated' }
  | { kind: 'disabled' }
  | { kind: 'rejected'; message?: string };

type LoginAttemptDecision =
  | { kind: 'authenticated' }
  | { kind: 'disabled' }
  | {
      kind: 'locked';
      reason: 'preexisting' | 'newly_locked';
      remainingMinutes: number;
    }
  | { kind: 'rejected'; message: string; remainingAttempts: number };

interface PublicLockoutStatus {
  isLocked: boolean;
  remainingMinutes: number;
}

interface LoginAttemptPolicy {
  attempt(
    email: string,
    authenticate: (normalizedEmail: string) => Promise<AuthenticationResult>
  ): Promise<LoginAttemptDecision>;
  getPublicStatus(email: string): Promise<PublicLockoutStatus>;
}

interface CurrentStatus extends LoginAttemptRecord {
  isLocked: boolean;
  remainingMinutes: number;
}

function remainingMinutes(lockedUntil: Date | null, now: Date): number {
  if (!lockedUntil) return 0;
  return Math.max(0, Math.ceil((lockedUntil.getTime() - now.getTime()) / 60_000));
}

export function createLoginAttemptPolicy(
  store: LoginAttemptStore,
  now: () => Date = () => new Date()
): LoginAttemptPolicy {
  async function currentStatus(email: string): Promise<CurrentStatus> {
    const record = await store.read(email);
    if (!record) {
      return { attempts: 0, isLocked: false, lockedUntil: null, remainingMinutes: 0 };
    }

    const currentTime = now();
    if (record.lockedUntil && record.lockedUntil <= currentTime) {
      await store.clear(email);
      return { attempts: 0, isLocked: false, lockedUntil: null, remainingMinutes: 0 };
    }

    const minutes = remainingMinutes(record.lockedUntil, currentTime);
    return {
      ...record,
      isLocked: minutes > 0,
      remainingMinutes: minutes,
    };
  }

  return {
    async getPublicStatus(email) {
      const status = await currentStatus(email.toLowerCase());
      return {
        isLocked: status.isLocked,
        remainingMinutes: status.isLocked ? status.remainingMinutes : 0,
      };
    },

    async attempt(email, authenticate) {
      const normalizedEmail = email.toLowerCase();
      const status = await currentStatus(normalizedEmail);
      if (status.isLocked) {
        return {
          kind: 'locked',
          reason: 'preexisting',
          remainingMinutes: status.remainingMinutes,
        };
      }

      const authentication = await authenticate(normalizedEmail);
      if (authentication.kind === 'authenticated') {
        await store.clear(normalizedEmail);
        return authentication;
      }
      if (authentication.kind === 'disabled') {
        return authentication;
      }

      await store.increment(normalizedEmail);
      const updatedStatus = await currentStatus(normalizedEmail);
      if (updatedStatus.isLocked) {
        return {
          kind: 'locked',
          reason: 'newly_locked',
          remainingMinutes: updatedStatus.remainingMinutes,
        };
      }

      return {
        kind: 'rejected',
        message: authentication.message || 'Invalid email or password',
        remainingAttempts: Math.max(0, MAX_FAILED_ATTEMPTS - updatedStatus.attempts),
      };
    },
  };
}

const supabaseLoginAttemptStore: LoginAttemptStore = {
  async read(email) {
    try {
      const data = await queryOne<{ attempts: number | null; locked_until: string | null }>(
        'SELECT attempts, locked_until FROM failed_login_attempts WHERE email = $1',
        [email]
      );
      if (!data) return null;
      return {
        attempts: data.attempts ?? 0,
        lockedUntil: data.locked_until ? new Date(data.locked_until) : null,
      };
    } catch {
      throw new Error('Failed to read login attempts');
    }
  },

  async increment(email) {
    try {
      await callFunction<IncrementFailedAttemptsRpcRow>('increment_failed_attempts', [
        email,
        MAX_FAILED_ATTEMPTS,
        LOCKOUT_DURATION_MINUTES,
      ]);
    } catch {
      throw new Error('Failed to record login attempt');
    }
  },

  async clear(email) {
    try {
      await execute('DELETE FROM failed_login_attempts WHERE email = $1', [email]);
    } catch {
      // Best-effort clear — a stale lock record will expire naturally
    }
  },
};

export const loginAttemptPolicy = createLoginAttemptPolicy(supabaseLoginAttemptStore);
