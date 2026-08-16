import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  type AuthorizationState,
  clearAuthorizationStateCache,
  invalidateAuthorizationState,
  readAuthorizationState,
} from '@/lib/auth/authorization-state';

/**
 * Minimal fake of the Supabase query chain used by `readAuthorizationState`:
 * `.from(...).select(...).eq(...).maybeSingle()`. Records how many times a query
 * ran and returns whatever `result` is set to.
 */
interface ProfileAuthorizationRow {
  is_admin: boolean;
  is_disabled: boolean;
  age_verified_at: string | null;
  agreed_to_terms_at: string | null;
}

function createFakeClient(result: { data: ProfileAuthorizationRow | null }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test fake implements only narrow Supabase slice; needs unknown intermediate because types don't overlap
  const client = { from } as unknown as Parameters<typeof readAuthorizationState>[0];
  return { client, from, select, eq, maybeSingle };
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
  });

  afterEach(() => {
    clearAuthorizationStateCache();
  });

  it('returns authorization and consent state from the profile row', async () => {
    const { client } = createFakeClient({ data: adminProfile });

    const state = await readAuthorizationState(client, 'user-1', { cache: false });

    expect(state).toEqual(adminState);
  });

  it('selects only the authorization columns filtered by user_id', async () => {
    const { client, from, select, eq } = createFakeClient({ data: regularProfile });

    await readAuthorizationState(client, 'user-1', { cache: false });

    expect(from).toHaveBeenCalledWith('user_profiles');
    expect(select).toHaveBeenCalledWith(
      'is_admin, is_disabled, age_verified_at, agreed_to_terms_at'
    );
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1');
  });

  it('requires both age verification and terms agreement for consent', async () => {
    const { client } = createFakeClient({
      data: { ...regularProfile, agreed_to_terms_at: null },
    });

    const state = await readAuthorizationState(client, 'user-1', { cache: false });

    expect(state?.has_consent).toBe(false);
  });

  it('returns null when the profile row is missing', async () => {
    const { client } = createFakeClient({ data: null });

    const state = await readAuthorizationState(client, 'user-1', { cache: false });

    expect(state).toBeNull();
  });

  it('returns null and logs when the query throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const maybeSingle = vi.fn().mockRejectedValue(new Error('db down'));
    // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test fake implements only narrow Supabase slice; needs unknown intermediate because types don't overlap
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle }) }),
      }),
    } as unknown as Parameters<typeof readAuthorizationState>[0];

    const state = await readAuthorizationState(client, 'user-1', { cache: false });

    expect(state).toEqual({ is_admin: false, is_disabled: true, has_consent: false });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  describe('cached read', () => {
    it('serves a cached hit without re-querying', async () => {
      const { client, maybeSingle } = createFakeClient({ data: adminProfile });

      await readAuthorizationState(client, 'user-1', { cache: true });
      const second = await readAuthorizationState(client, 'user-1', { cache: true });

      expect(second).toEqual(adminState);
      expect(maybeSingle).toHaveBeenCalledTimes(1);
    });

    it('does not cache a null (missing profile) result', async () => {
      const { client, maybeSingle } = createFakeClient({ data: null });

      await readAuthorizationState(client, 'user-1', { cache: true });
      await readAuthorizationState(client, 'user-1', { cache: true });

      expect(maybeSingle).toHaveBeenCalledTimes(2);
    });
  });

  describe('fresh read', () => {
    it('always queries even after a value was cached', async () => {
      const { client, maybeSingle } = createFakeClient({ data: adminProfile });

      await readAuthorizationState(client, 'user-1', { cache: true });
      await readAuthorizationState(client, 'user-1', { cache: false });

      expect(maybeSingle).toHaveBeenCalledTimes(2);
    });

    it('does not populate the cache, so a later cached read still queries', async () => {
      const { client, maybeSingle } = createFakeClient({ data: adminProfile });

      await readAuthorizationState(client, 'user-1', { cache: false });
      await readAuthorizationState(client, 'user-1', { cache: true });

      expect(maybeSingle).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalidateAuthorizationState', () => {
    it('forces the next cached read to re-query', async () => {
      const { client, maybeSingle } = createFakeClient({ data: adminProfile });

      await readAuthorizationState(client, 'user-1', { cache: true });
      const removed = invalidateAuthorizationState('user-1');
      await readAuthorizationState(client, 'user-1', { cache: true });

      expect(removed).toBe(true);
      expect(maybeSingle).toHaveBeenCalledTimes(2);
    });

    it('returns false when nothing was cached for that user', () => {
      expect(invalidateAuthorizationState('never-cached')).toBe(false);
    });
  });
});
