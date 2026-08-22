import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

vi.mock('@/lib/db/client', () => ({
  queryOne: vi.fn(),
  query: vi.fn(),
  queryScalar: vi.fn(),
  execute: vi.fn(),
  callFunction: vi.fn(),
  callFunctionScalar: vi.fn(),
  getClient: vi.fn(),
  getPool: vi.fn(),
  _resetPool: vi.fn(),
}));

import { queryOne } from '@/lib/db/client';
import {
  type AuthorizationState,
  clearAuthorizationStateCache,
  invalidateAuthorizationState,
  readAuthorizationState,
} from '@/lib/auth/authorization-state';

interface ProfileAuthorizationRow {
  is_admin: boolean;
  is_disabled: boolean;
  age_verified_at: string | null;
  agreed_to_terms_at: string | null;
}

function mockProfileRow(row: ProfileAuthorizationRow | null) {
  // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
  (queryOne as ReturnType<typeof vi.fn>).mockResolvedValue(row);
}

function mockQueryError(error: Error) {
  // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
  (queryOne as ReturnType<typeof vi.fn>).mockRejectedValue(error);
}

const consentTimestamp = '2026-07-12T00:00:00.000Z';
const adminProfile: ProfileAuthorizationRow = {
  is_admin: true,
  is_disabled: false,
  age_verified_at: consentTimestamp,
  agreed_to_terms_at: consentTimestamp,
};
const regularProfile: ProfileAuthorizationRow = {
  is_admin: false,
  is_disabled: false,
  age_verified_at: consentTimestamp,
  agreed_to_terms_at: consentTimestamp,
};
const adminState: AuthorizationState = {
  is_admin: true,
  is_disabled: false,
  has_consent: true,
};

describe('readAuthorizationState', () => {
  beforeEach(() => {
    clearAuthorizationStateCache();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    clearAuthorizationStateCache();
    vi.restoreAllMocks();
  });

  it('returns authorization and consent state from the profile row', async () => {
    mockProfileRow(adminProfile);

    const state = await readAuthorizationState('user-1', { cache: false });

    expect(state).toEqual(adminState);
  });

  it('queries user_profiles filtered by user_id', async () => {
    mockProfileRow(regularProfile);

    await readAuthorizationState('user-1', { cache: false });

    expect(queryOne).toHaveBeenCalledWith(
      expect.stringContaining('FROM user_profiles WHERE user_id = $1'),
      ['user-1']
    );
  });

  it('requires both age verification and terms agreement for consent', async () => {
    mockProfileRow({ ...regularProfile, agreed_to_terms_at: null });

    const state = await readAuthorizationState('user-1', { cache: false });

    expect(state?.has_consent).toBe(false);
  });

  it('returns null when the profile row is missing', async () => {
    mockProfileRow(null);

    const state = await readAuthorizationState('user-1', { cache: false });

    expect(state).toBeNull();
  });

  it('returns fail-closed state and logs when the query throws', async () => {
    mockQueryError(new Error('db down'));

    const state = await readAuthorizationState('user-1', { cache: false });

    expect(state).toEqual({ is_admin: false, is_disabled: true, has_consent: false });
    expect(console.error).toHaveBeenCalled();
  });

  describe('cached read', () => {
    it('serves a cached hit without re-querying', async () => {
      mockProfileRow(adminProfile);

      await readAuthorizationState('user-1', { cache: true });
      const second = await readAuthorizationState('user-1', { cache: true });

      expect(second).toEqual(adminState);
      expect(queryOne).toHaveBeenCalledTimes(1);
    });

    it('does not cache a null (missing profile) result', async () => {
      mockProfileRow(null);

      await readAuthorizationState('user-1', { cache: true });
      await readAuthorizationState('user-1', { cache: true });

      expect(queryOne).toHaveBeenCalledTimes(2);
    });
  });

  describe('fresh read', () => {
    it('always queries even after a value was cached', async () => {
      mockProfileRow(adminProfile);

      await readAuthorizationState('user-1', { cache: true });
      await readAuthorizationState('user-1', { cache: false });

      expect(queryOne).toHaveBeenCalledTimes(2);
    });

    it('does not populate the cache, so a later cached read still queries', async () => {
      mockProfileRow(adminProfile);

      await readAuthorizationState('user-1', { cache: false });
      await readAuthorizationState('user-1', { cache: true });

      expect(queryOne).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalidateAuthorizationState', () => {
    it('forces the next cached read to re-query', async () => {
      mockProfileRow(adminProfile);

      await readAuthorizationState('user-1', { cache: true });
      const removed = invalidateAuthorizationState('user-1');
      await readAuthorizationState('user-1', { cache: true });

      expect(removed).toBe(true);
      expect(queryOne).toHaveBeenCalledTimes(2);
    });

    it('returns false when nothing was cached for that user', () => {
      expect(invalidateAuthorizationState('never-cached')).toBe(false);
    });
  });
});
