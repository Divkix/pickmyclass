/**
 * Unit tests for the Postgres error-shape helpers in `@/lib/db/pg-errors`.
 *
 * These helpers replace the scattered `(error as { code?: string })` casts and
 * message heuristics that used to live in `lib/db/queries.ts` /
 * `admin-queries.ts` / route catch blocks. The suite pins the public contract:
 *
 * - SQLSTATE constants match PostgreSQL's documented values.
 * - `getPgError` narrows only genuine Postgres-shaped errors ({ code, message })
 *   and returns null for everything else a `catch` can produce.
 * - Driver fields beyond code/message are stripped, so narrowed values are safe
 *   to log or compare without leaking driver internals.
 * - `isUniqueViolation` falls back to the classic "duplicate key value"
 *   message for intermediaries that drop the SQLSTATE `code`.
 * - `isRaisedException` / `isUndefinedFunction` match their exact SQLSTATEs
 *   (P0001 RAISE EXCEPTION from SECURITY DEFINER RPCs; 42883 undefined
 *   function) and reject unrelated errors.
 */
import { describe, expect, it } from 'vite-plus/test';
import {
  PG_RAISE_EXCEPTION,
  PG_UNDEFINED_FUNCTION,
  PG_UNIQUE_VIOLATION,
  getPgError,
  isRaisedException,
  isUndefinedFunction,
  isUniqueViolation,
} from '@/lib/db/pg-errors';

describe('SQLSTATE constants', () => {
  it('expose the documented PostgreSQL codes', () => {
    expect(PG_UNIQUE_VIOLATION).toBe('23505');
    expect(PG_RAISE_EXCEPTION).toBe('P0001');
    expect(PG_UNDEFINED_FUNCTION).toBe('42883');
  });
});

describe('getPgError', () => {
  it('narrows a code-only Postgres error', () => {
    expect(getPgError({ code: '23505' })).toStrictEqual({ code: '23505' });
  });

  it('narrows code plus message', () => {
    expect(getPgError({ code: 'P0001', message: 'Section not found' })).toStrictEqual({
      code: 'P0001',
      message: 'Section not found',
    });
  });

  it('strips extra postgres-js driver fields', () => {
    const error = {
      severity: 'ERROR',
      code: '23505',
      detail: 'Key (clerk_user_id)=(user_2abc) already exists.',
      hint: undefined,
      constraint: 'users_clerk_user_id_key',
      message: 'duplicate key value violates unique constraint "users_clerk_user_id_key"',
    };
    // SAFETY: hint is deliberately present-but-undefined to mirror wire noise.
    expect(getPgError(error)).toStrictEqual({
      code: '23505',
      message: 'duplicate key value violates unique constraint "users_clerk_user_id_key"',
    });
  });

  it('returns null for non-Postgres caught values', () => {
    expect(getPgError(null)).toBeNull();
    expect(getPgError(undefined)).toBeNull();
    expect(getPgError('boom')).toBeNull();
    expect(getPgError(42)).toBeNull();
    expect(getPgError(['23505'])).toBeNull();
    expect(getPgError({})).toBeNull();
    expect(getPgError(new Error('plain failure'))).toBeNull();
  });

  it('rejects malformed shapes instead of guessing', () => {
    // Non-string code (numeric SQLSTATE) is not a Postgres error shape.
    expect(getPgError({ code: 23_505 })).toBeNull();
    // Message alone is not enough: getPgError requires the SQLSTATE.
    expect(getPgError({ message: 'duplicate key value violates unique constraint' })).toBeNull();
    // Non-string message poisons the whole shape.
    expect(getPgError({ code: '23505', message: 42 })).toBeNull();
  });
});

describe('isUniqueViolation', () => {
  it('matches SQLSTATE 23505 with and without a message', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(
      isUniqueViolation({
        code: '23505',
        message: 'duplicate key value violates unique constraint "class_watches_pkey"',
      })
    ).toBe(true);
  });

  it('falls back to the duplicate-key message when SQLSTATE was dropped', () => {
    // Intermediary stripped `code` but kept the server message.
    expect(
      isUniqueViolation({
        message: 'duplicate key value violates unique constraint "unique_notification_active"',
      })
    ).toBe(true);
    // Plain Error instance (no code property at all).
    expect(
      isUniqueViolation(new Error('duplicate key value violates unique constraint "users_pkey"'))
    ).toBe(true);
  });

  it('applies the fallback even when a different code survived', () => {
    expect(
      isUniqueViolation({
        code: 'XX999',
        message: 'could not execute statement: duplicate key value violates unique constraint',
      })
    ).toBe(true);
  });

  it('rejects other SQLSTATEs and unrelated errors', () => {
    expect(isUniqueViolation({ code: 'P0001', message: 'Section not found' })).toBe(false);
    expect(
      isUniqueViolation({ code: '42883', message: 'function missing_fn() does not exist' })
    ).toBe(false);
    expect(isUniqueViolation(new TypeError('cannot read properties of undefined'))).toBe(false);
    expect(isUniqueViolation({ message: 'connection refused' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation('duplicate key value as a bare string')).toBe(false);
    expect(isUniqueViolation({})).toBe(false);
  });
});

describe('isRaisedException', () => {
  it('matches SQLSTATE P0001 from RPC invariant raises', () => {
    expect(isRaisedException({ code: 'P0001', message: 'Section not found' })).toBe(true);
    expect(isRaisedException({ code: PG_RAISE_EXCEPTION })).toBe(true);
  });

  it('rejects other codes, messages, and non-errors', () => {
    expect(isRaisedException({ code: '23505', message: 'duplicate key value' })).toBe(false);
    expect(isRaisedException({ code: '42883' })).toBe(false);
    expect(isRaisedException({ message: 'Section not found' })).toBe(false);
    expect(isRaisedException(new Error('Section not found'))).toBe(false);
    expect(isRaisedException(null)).toBe(false);
    expect(isRaisedException('P0001')).toBe(false);
  });
});

describe('isUndefinedFunction', () => {
  it('matches SQLSTATE 42883 for missing RPCs', () => {
    expect(
      isUndefinedFunction({
        code: '42883',
        message: 'function get_recent_activity(integer) does not exist',
      })
    ).toBe(true);
    expect(isUndefinedFunction({ code: PG_UNDEFINED_FUNCTION })).toBe(true);
  });

  it('rejects other codes, messages, and non-errors', () => {
    expect(isUndefinedFunction({ code: 'P0001', message: 'raise exception' })).toBe(false);
    expect(isUndefinedFunction({ code: '23505' })).toBe(false);
    expect(isUndefinedFunction({ message: 'does not exist' })).toBe(false);
    expect(isUndefinedFunction(new Error('function does not exist'))).toBe(false);
    expect(isUndefinedFunction(undefined)).toBe(false);
    expect(isUndefinedFunction(42)).toBe(false);
    expect(isUndefinedFunction([])).toBe(false);
  });
});
