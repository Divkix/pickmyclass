import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  clearAuthorizationStateCache,
  invalidateAuthorizationState,
  readAuthorizationState,
} from "@/lib/auth/authorization-state";
import { createScriptedPostgres } from "@/tests/mocks/scripted-postgres";

const consentAt = "2026-10-01T00:00:00.000Z";

const enabledProfile = {
  is_admin: true,
  is_disabled: false,
  age_verified_at: consentAt,
  agreed_to_terms_at: consentAt,
};

const enabledState = { has_consent: true, is_admin: true, is_disabled: false };

describe("readAuthorizationState", () => {
  beforeEach(() => {
    clearAuthorizationStateCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T00:00:00.000Z"));
  });

  afterEach(() => {
    clearAuthorizationStateCache();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reuses a cached profile for 30 seconds, then reads its changed permissions", async () => {
    const pg = createScriptedPostgres();
    pg.next([enabledProfile]);

    expect(await readAuthorizationState(pg.db, "user_1", { cache: true })).toEqual(enabledState);
    vi.advanceTimersByTime(29_999);
    expect(await readAuthorizationState(pg.db, "user_1", { cache: true })).toEqual(enabledState);
    expect(pg.statements).toHaveLength(1);

    vi.advanceTimersByTime(2);
    pg.next([{ ...enabledProfile, is_admin: false, is_disabled: true }]);

    expect(await readAuthorizationState(pg.db, "user_1", { cache: true })).toEqual({
      has_consent: true,
      is_admin: false,
      is_disabled: true,
    });
    expect(pg.statements).toHaveLength(2);
    expect(pg.statements[1].params).toContain("user_1");
  });

  it("invalidates only the selected user's cached authorization", async () => {
    const pg = createScriptedPostgres();
    pg.next([enabledProfile]);
    pg.next([enabledProfile]);
    await readAuthorizationState(pg.db, "user_1", { cache: true });
    await readAuthorizationState(pg.db, "user_2", { cache: true });

    expect(invalidateAuthorizationState("user_1")).toBe(true);
    expect(invalidateAuthorizationState("user_1")).toBe(false);
    pg.next([{ ...enabledProfile, is_admin: false }]);

    expect(await readAuthorizationState(pg.db, "user_1", { cache: true })).toEqual({
      ...enabledState,
      is_admin: false,
    });
    expect(await readAuthorizationState(pg.db, "user_2", { cache: true })).toEqual(enabledState);
    expect(pg.statements).toHaveLength(3);
  });

  it("bypasses the cache when a fresh authorization decision is required", async () => {
    const pg = createScriptedPostgres();
    pg.next([enabledProfile]);
    await readAuthorizationState(pg.db, "user_1", { cache: true });
    pg.next([{ ...enabledProfile, is_admin: false }]);

    expect(await readAuthorizationState(pg.db, "user_1", { cache: false })).toEqual({
      ...enabledState,
      is_admin: false,
    });
    expect(pg.statements).toHaveLength(2);
  });

  it.each([
    [consentAt, consentAt, true],
    [null, consentAt, false],
    [consentAt, null, false],
    [null, null, false],
  ])("requires both consent timestamps (%s, %s)", async (age, terms, hasConsent) => {
    const pg = createScriptedPostgres();
    pg.next([{ ...enabledProfile, age_verified_at: age, agreed_to_terms_at: terms }]);

    expect(await readAuthorizationState(pg.db, "user_1", { cache: false })).toEqual({
      ...enabledState,
      has_consent: hasConsent,
    });
  });

  it("does not cache a missing profile while its mirror is being repaired", async () => {
    const pg = createScriptedPostgres();
    pg.next();
    pg.next([enabledProfile]);

    expect(await readAuthorizationState(pg.db, "user_1", { cache: true })).toBeNull();
    expect(await readAuthorizationState(pg.db, "user_1", { cache: true })).toEqual(enabledState);
    expect(pg.statements).toHaveLength(2);
  });

  it("returns unknown rather than disabled on a database failure and retries the next read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const pg = createScriptedPostgres();
    pg.failNext(new Error("connection reset"));
    pg.next([enabledProfile]);

    expect(await readAuthorizationState(pg.db, "user_1", { cache: true })).toBeNull();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "Auth",
        msg: "Error reading authorization state",
      }),
    );
    expect(await readAuthorizationState(pg.db, "user_1", { cache: true })).toEqual(enabledState);
    expect(pg.statements).toHaveLength(2);
  });
});
