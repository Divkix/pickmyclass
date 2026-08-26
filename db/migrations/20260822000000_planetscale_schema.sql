-- =============================================================================
-- Consolidated PlanetScale schema for PickMyClass
-- =============================================================================
-- This is a single from-scratch migration that creates the complete target
-- schema for the PlanetScale backend. It replaces ~50 incremental Supabase
-- migrations with one declarative file.
--
-- Key differences from the Supabase schema:
--   * `users` table mirrors Clerk-managed identities (synced via webhooks) in
--     place of `auth.users`. `users.id` is TEXT (Clerk user id). Migrated rows
--     are keyed by the old Supabase UUID via Clerk's externalId.
--   * `class_watches.user_id` and `user_profiles.user_id` are TEXT FKs to
--     `users(id)`, not UUIDs.
--   * All RPCs join `users` instead of `auth.users`.
--   * All RPCs that used `auth.uid()` now take an explicit `p_user_id TEXT`
--     parameter (Clerk session provides it).
--   * No Row-Level Security policies. PlanetScale has no anon/authenticated/
--     service_role roles. Functions remain SECURITY DEFINER for least-
--     privilege within the application layer.
--   * The `on_auth_user_created` / `handle_new_user()` trigger and the
--     `prevent_user_profile_escalation()` trigger are dropped — Clerk owns
--     user creation and there are no untrusted DB roles.
--   * `try_record_notification` (single-row variant) is dropped; only the
--     batch variant `try_record_notifications_batch` is used.
--   * The `is_watcher_eligible` predicate is the 4-argument form (no
--     engagement_disabled_at — that subsystem was removed in 20260712000005).
--
-- Load-bearing invariants preserved from the Supabase schema:
--   * `class_states` UNIQUE(class_nbr, term) — a section number repeats across
--     terms.
--   * `notifications_sent` partial unique index on (class_watch_id,
--     notification_type) WHERE is_active = TRUE — the dedup backbone.
--   * Watcher eligibility is centralized in `private.is_watcher_eligible` and
--     called by every enumeration/recipient/popularity query.
--   * `notification_type` is always exactly 'seat_available' or
--     'instructor_assigned' (CHECK + re-validated in every RPC).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- private schema: shared eligibility predicate
-- -----------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS private;

-- Centralized watcher eligibility. Shared by get_sections_to_check,
-- get_watchers_for_sections, get_class_watchers, and get_most_watched_class so
-- the policy cannot drift across call sites.
CREATE OR REPLACE FUNCTION private.is_watcher_eligible(
  p_notifications_enabled BOOLEAN,
  p_email_bounced BOOLEAN,
  p_spam_complained BOOLEAN,
  p_is_disabled BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    COALESCE(p_notifications_enabled, TRUE)
    AND NOT COALESCE(p_email_bounced, FALSE)
    AND NOT COALESCE(p_spam_complained, FALSE)
    AND NOT COALESCE(p_is_disabled, FALSE);
$$;

COMMENT ON FUNCTION private.is_watcher_eligible(BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN)
IS 'Authoritative watcher eligibility policy shared by all pipeline, admin, and popularity queries. A watcher is eligible when notifications are enabled (default true), the email has not bounced, no spam complaint is recorded, and the account is not disabled.';

-- -----------------------------------------------------------------------------
-- Table: users
-- -----------------------------------------------------------------------------
-- Mirror of Clerk-managed identities, synced by Clerk webhooks. Replaces
-- Supabase auth.users. The id is the Clerk user id (TEXT). Migrated rows are
-- keyed by the old Supabase UUID via Clerk's externalId.

CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY,
  clerk_user_id       TEXT,
  email               TEXT NOT NULL,
  email_confirmed_at  TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sign_in_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_clerk_user_id ON users (clerk_user_id);

COMMENT ON TABLE users IS 'Mirror of Clerk-managed user identities, synced via Clerk webhooks. Replaces Supabase auth.users.';
COMMENT ON COLUMN users.id IS 'Stable app user id. Migrated rows keyed by old Supabase UUID via Clerk externalId; post-cutover users keyed by Clerk user id.';
COMMENT ON COLUMN users.clerk_user_id IS 'Clerk user id (sub claim). Populated by webhook sync; lets user.deleted (which carries only the Clerk id) resolve migrated rows.';
COMMENT ON COLUMN users.email_confirmed_at IS 'When the user confirmed their email address. NULL means unconfirmed.';
COMMENT ON COLUMN users.last_sign_in_at IS 'Timestamp of the most recent sign-in. NULL if never signed in.';

-- -----------------------------------------------------------------------------
-- Table: class_states
-- -----------------------------------------------------------------------------
-- Cached ASU catalog state per Class Section (SectionRef = class_nbr + term).
-- Upserted by the seat-check pipeline on every check.

CREATE TABLE IF NOT EXISTS class_states (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_nbr                  TEXT NOT NULL,
  term                       TEXT NOT NULL,
  subject                    TEXT NOT NULL,
  catalog_nbr                TEXT NOT NULL,
  title                      TEXT,
  instructor_name            TEXT,
  seats_available            INTEGER NOT NULL DEFAULT 0,
  seats_capacity             INTEGER NOT NULL DEFAULT 0,
  non_reserved_seats         INTEGER,
  location                   TEXT,
  meeting_times              TEXT,
  last_checked_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_changed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consecutive_not_found_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (class_nbr, term)
);

COMMENT ON TABLE class_states IS 'Cached ASU catalog state per Class Section, keyed by the SectionRef (class_nbr, term). A section number repeats across terms, so the unique constraint is on both columns.';
COMMENT ON COLUMN class_states.class_nbr IS 'ASU class number (e.g. 12345). Not unique alone — paired with term for identity.';
COMMENT ON COLUMN class_states.term IS 'ASU term code (e.g. 2026Fall). Paired with class_nbr for identity.';
COMMENT ON COLUMN class_states.non_reserved_seats IS 'Seats available excluding waitlist reservations. Computed as max(0, enrlCap - enrlTot - waitTot). NULL when no waitlist data; detectChanges falls back to seats_available.';
COMMENT ON COLUMN class_states.consecutive_not_found_count IS 'Consecutive NotFoundError count for the SectionRef. Increments on ASU 404, resets to 0 on success. Triggers auto-delete at >= 3.';

CREATE INDEX IF NOT EXISTS idx_class_states_class_nbr ON class_states (class_nbr);
CREATE INDEX IF NOT EXISTS idx_class_states_subject   ON class_states (subject);

-- -----------------------------------------------------------------------------
-- Table: class_watches
-- -----------------------------------------------------------------------------
-- A user watching a Class Section for seat/instructor notifications.

CREATE TABLE IF NOT EXISTS class_watches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_nbr   TEXT NOT NULL,
  term        TEXT NOT NULL,
  subject     TEXT NOT NULL,
  catalog_nbr TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, class_nbr, term)
);

COMMENT ON TABLE class_watches IS 'User subscriptions to Class Sections. A user can watch a section once per term.';
COMMENT ON COLUMN class_watches.user_id IS 'FK to users(id). Clerk user id.';
COMMENT ON COLUMN class_watches.class_nbr IS 'ASU class number being watched. Paired with term.';
COMMENT ON COLUMN class_watches.term IS 'ASU term code being watched. Paired with class_nbr.';

CREATE INDEX IF NOT EXISTS idx_class_watches_user_id    ON class_watches (user_id);
CREATE INDEX IF NOT EXISTS idx_class_watches_class_nbr   ON class_watches (class_nbr);
CREATE INDEX IF NOT EXISTS idx_class_watches_created_at  ON class_watches (created_at DESC);

-- -----------------------------------------------------------------------------
-- Table: notifications_sent
-- -----------------------------------------------------------------------------
-- Dedup records for sent notifications. The partial unique index
-- unique_notification_active is the load-bearing dedup backbone: only rows
-- with is_active = TRUE occupy a dedup slot. The daily expire_stale_notifications
-- sweep flips expired active rows to inactive, freeing slots for re-notification.

CREATE TABLE IF NOT EXISTS notifications_sent (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_watch_id    UUID NOT NULL REFERENCES class_watches(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL CHECK (notification_type IN ('seat_available', 'instructor_assigned')),
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE notifications_sent IS 'Notification dedup log. A row claims a dedup slot only while is_active = TRUE. Failed sends are rolled back via delete_notification_records so users are not suppressed for the 24h window.';
COMMENT ON COLUMN notifications_sent.class_watch_id IS 'FK to class_watches(id). Cascades on watch deletion.';
COMMENT ON COLUMN notifications_sent.notification_type IS 'Always exactly seat_available or instructor_assigned.';
COMMENT ON COLUMN notifications_sent.expires_at IS 'When this dedup slot expires. expire_stale_notifications flips is_active to FALSE past this time.';
COMMENT ON COLUMN notifications_sent.is_active IS 'TRUE means the dedup slot is occupied. The partial unique index only covers active rows.';

-- Load-bearing dedup backbone: one active notification per (watch, type).
CREATE UNIQUE INDEX IF NOT EXISTS unique_notification_active
  ON notifications_sent (class_watch_id, notification_type)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_notifications_sent_sent_at
  ON notifications_sent (sent_at DESC);

-- -----------------------------------------------------------------------------
-- Table: user_profiles
-- -----------------------------------------------------------------------------
-- 1:1 with users. Holds admin/disabled flags, notification preferences, email
-- engagement state, consent timestamps, and onboarding state. In PlanetScale,
-- the escalation-prevention trigger is gone (no untrusted roles); the app
-- layer enforces column protection.

CREATE TABLE IF NOT EXISTS user_profiles (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_admin                BOOLEAN NOT NULL DEFAULT FALSE,
  is_disabled             BOOLEAN NOT NULL DEFAULT FALSE,
  disabled_at             TIMESTAMPTZ,
  notifications_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  unsubscribed_at         TIMESTAMPTZ,
  email_bounced           BOOLEAN NOT NULL DEFAULT FALSE,
  email_bounced_at        TIMESTAMPTZ,
  spam_complained         BOOLEAN NOT NULL DEFAULT FALSE,
  spam_complained_at      TIMESTAMPTZ,
  age_verified_at         TIMESTAMPTZ,
  agreed_to_terms_at      TIMESTAMPTZ,
  onboarding_completed_at TIMESTAMPTZ,
  onboarding_skipped_at   TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

COMMENT ON TABLE user_profiles IS '1:1 with users. Admin/disabled flags, notification preferences, email engagement, consent, and onboarding state. No escalation-prevention trigger in PlanetScale — app layer protects privileged columns.';
COMMENT ON COLUMN user_profiles.user_id IS 'FK to users(id). Unique — one profile per user.';
COMMENT ON COLUMN user_profiles.is_admin IS 'Admin flag. Enforced by app-layer checks and the verifyAdmin server gate, not by DB triggers.';
COMMENT ON COLUMN user_profiles.is_disabled IS 'CCPA soft-delete / admin disable. Disables notifications and blocks sign-in.';
COMMENT ON COLUMN user_profiles.notifications_enabled IS 'Master notification opt-in. Default TRUE. Used by is_watcher_eligible.';
COMMENT ON COLUMN user_profiles.unsubscribed_at IS 'When the user unsubscribed via email link. Non-NULL suppresses notifications.';
COMMENT ON COLUMN user_profiles.email_bounced IS 'TRUE when a sent email bounced. Bounced watchers are excluded by is_watcher_eligible.';
COMMENT ON COLUMN user_profiles.spam_complained IS 'TRUE when a spam complaint was recorded. Excluded by is_watcher_eligible.';
COMMENT ON COLUMN user_profiles.age_verified_at IS 'When the user confirmed they are 18+. Required for consent gate.';
COMMENT ON COLUMN user_profiles.agreed_to_terms_at IS 'When the user agreed to the Terms of Service. Required for consent gate.';
COMMENT ON COLUMN user_profiles.onboarding_completed_at IS 'When the user finished onboarding (e.g. created first watch). NULL means pending.';
COMMENT ON COLUMN user_profiles.onboarding_skipped_at IS 'When the user dismissed the onboarding modal. NULL means not skipped.';
COMMENT ON COLUMN user_profiles.updated_at IS 'Last modification timestamp. App layer should update on every change.';

-- -----------------------------------------------------------------------------
-- Table: failed_login_attempts
-- -----------------------------------------------------------------------------
-- Tracks failed login attempts per email for lockout enforcement. PK is email
-- (lowercased by the app before any auth/lockout op).

CREATE TABLE IF NOT EXISTS failed_login_attempts (
  email           TEXT PRIMARY KEY,
  attempts        INTEGER,
  last_attempt_at TIMESTAMPTZ,
  locked_until    TIMESTAMPTZ
);

COMMENT ON TABLE failed_login_attempts IS 'Per-email failed login attempt tracker for lockout enforcement. PK is the lowercased email.';
COMMENT ON COLUMN failed_login_attempts.locked_until IS 'When the lockout expires. NULL or past means not locked.';

-- =============================================================================
-- Public functions
-- =============================================================================
-- All functions are SECURITY DEFINER with SET search_path = public for
-- least-privilege within the application layer. PlanetScale has no
-- anon/authenticated/service_role roles, so there are no REVOKE/GRANT
-- statements. All functions that previously joined auth.users now join users,
-- and all functions that used auth.uid() now take an explicit p_user_id
-- TEXT parameter.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. get_class_watchers
-- -----------------------------------------------------------------------------
-- Returns notification-eligible watchers for exactly one SectionRef
-- (class_nbr + term) with their watch creation timestamp. Used by the admin
-- class-detail Watchers table and the DLQ alert count.

CREATE OR REPLACE FUNCTION public.get_class_watchers(p_class_nbr TEXT, p_term TEXT)
RETURNS TABLE (
  user_id    TEXT,
  email      TEXT,
  watch_id   UUID,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cw.user_id,
    u.email::TEXT,
    cw.id AS watch_id,
    cw.created_at
  FROM public.class_watches cw
  INNER JOIN public.users u ON u.id = cw.user_id
  LEFT JOIN public.user_profiles up ON up.user_id = cw.user_id
  WHERE cw.class_nbr = p_class_nbr
    AND cw.term = p_term
    AND private.is_watcher_eligible(
      up.notifications_enabled,
      up.email_bounced,
      up.spam_complained,
      up.is_disabled
    )
  ORDER BY cw.created_at;
$$;

COMMENT ON FUNCTION public.get_class_watchers(TEXT, TEXT)
IS 'Returns notification-eligible watchers for exactly one class-number and term pair (SectionRef-scoped), with watch creation timestamps. Uses the centralized is_watcher_eligible predicate.';

-- -----------------------------------------------------------------------------
-- 2. get_sections_to_check
-- -----------------------------------------------------------------------------
-- Returns distinct watched sections whose owners are eligible for
-- notifications, optionally partitioned by class-number parity (stagger group
-- for cron load distribution). Even = last digit even; odd = last digit odd.

CREATE OR REPLACE FUNCTION public.get_sections_to_check(stagger_type TEXT)
RETURNS TABLE (
  class_nbr TEXT,
  term      TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT
    cw.class_nbr,
    cw.term
  FROM public.class_watches cw
  LEFT JOIN public.user_profiles up ON up.user_id = cw.user_id
  WHERE private.is_watcher_eligible(
    up.notifications_enabled,
    up.email_bounced,
    up.spam_complained,
    up.is_disabled
  )
    AND CASE
      WHEN stagger_type = 'even' THEN
        (CAST(SUBSTRING(cw.class_nbr FROM LENGTH(cw.class_nbr) FOR 1) AS INTEGER) % 2) = 0
      WHEN stagger_type = 'odd' THEN
        (CAST(SUBSTRING(cw.class_nbr FROM LENGTH(cw.class_nbr) FOR 1) AS INTEGER) % 2) = 1
      ELSE TRUE
    END
  ORDER BY cw.class_nbr;
$$;

COMMENT ON FUNCTION public.get_sections_to_check(TEXT)
IS 'Returns distinct watched sections whose owners are eligible for notifications, optionally partitioned by class-number parity for staggered cron processing. Uses the centralized is_watcher_eligible predicate.';

-- -----------------------------------------------------------------------------
-- 3. get_watchers_for_sections
-- -----------------------------------------------------------------------------
-- Returns notification-eligible watchers for the requested section numbers in
-- exactly one term (SectionRef-scoped). Eliminates N+1 queries and prevents
-- cross-term recipient selection — a transition in one term cannot select
-- watchers for the same class number in a different term.

CREATE OR REPLACE FUNCTION public.get_watchers_for_sections(section_numbers TEXT[], p_term TEXT)
RETURNS TABLE (
  user_id   TEXT,
  email     TEXT,
  watch_id  UUID,
  class_nbr TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cw.user_id,
    u.email::TEXT,
    cw.id AS watch_id,
    cw.class_nbr
  FROM public.class_watches cw
  INNER JOIN public.users u ON u.id = cw.user_id
  LEFT JOIN public.user_profiles up ON up.user_id = cw.user_id
  WHERE cw.class_nbr = ANY(section_numbers)
    AND cw.term = p_term
    AND private.is_watcher_eligible(
      up.notifications_enabled,
      up.email_bounced,
      up.spam_complained,
      up.is_disabled
    )
  ORDER BY cw.class_nbr, cw.user_id;
$$;

COMMENT ON FUNCTION public.get_watchers_for_sections(TEXT[], TEXT)
IS 'Returns notification-eligible watchers for the requested section numbers in exactly one term (SectionRef-scoped: class_nbr + term). Eliminates N+1 queries and prevents cross-term recipient selection. Uses the centralized is_watcher_eligible predicate.';

-- -----------------------------------------------------------------------------
-- 4. get_most_watched_class
-- -----------------------------------------------------------------------------
-- Returns the single most-watched SectionRef for a given term, counting only
-- eligible watchers. Used by the onboarding popular-class example. Deterministic
-- tiebreaker: class_nbr ASC.

CREATE OR REPLACE FUNCTION public.get_most_watched_class(p_term TEXT)
RETURNS TABLE (
  class_nbr TEXT,
  term      TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cw.class_nbr,
    cw.term
  FROM public.class_watches cw
  LEFT JOIN public.user_profiles up ON up.user_id = cw.user_id
  WHERE cw.term = p_term
    AND private.is_watcher_eligible(
      up.notifications_enabled,
      up.email_bounced,
      up.spam_complained,
      up.is_disabled
    )
  GROUP BY cw.class_nbr, cw.term
  ORDER BY COUNT(*) DESC, cw.class_nbr ASC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_most_watched_class(TEXT)
IS 'Returns the single most-watched SectionRef for the given term, counting only eligible watchers with a deterministic class-number tiebreaker. Used by the onboarding popular-class example.';

-- -----------------------------------------------------------------------------
-- 5. count_all_users
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.count_all_users()
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*) FROM public.user_profiles;
$$;

COMMENT ON FUNCTION public.count_all_users()
IS 'Returns the total number of user profiles. Used by the admin dashboard stat cards.';

-- -----------------------------------------------------------------------------
-- 6. count_distinct_classes_watched
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.count_distinct_classes_watched()
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(DISTINCT class_nbr) FROM public.class_watches;
$$;

COMMENT ON FUNCTION public.count_distinct_classes_watched()
IS 'Returns the number of distinct class numbers with at least one watch. Used by the admin dashboard stat cards.';

-- -----------------------------------------------------------------------------
-- 7. get_distinct_subjects
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_distinct_subjects()
RETURNS TABLE (subject TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT subject FROM public.class_states ORDER BY subject;
$$;

COMMENT ON FUNCTION public.get_distinct_subjects()
IS 'Returns all distinct subject codes from class_states, ordered alphabetically. Used by the admin class filter dropdown.';

-- -----------------------------------------------------------------------------
-- 8. delete_notification_records
-- -----------------------------------------------------------------------------
-- Rolls back failed notification sends by deleting only ACTIVE dedup rows for
-- the given watch IDs and notification type. Restricting to is_active = TRUE
-- preserves historical (expired/inactive) rows so admin email counts do not
-- drift. The dedup claim always lives on a freshly inserted is_active = TRUE
-- row, so this still unsuppresses the failed batch.

CREATE OR REPLACE FUNCTION public.delete_notification_records(
  p_class_watch_ids    UUID[],
  p_notification_type  TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  IF p_notification_type NOT IN ('seat_available', 'instructor_assigned') THEN
    RAISE EXCEPTION 'Invalid notification_type: %', p_notification_type;
  END IF;

  DELETE FROM public.notifications_sent
  WHERE class_watch_id = ANY(p_class_watch_ids)
    AND notification_type = p_notification_type
    AND is_active = TRUE;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.delete_notification_records(UUID[], TEXT)
IS 'Deletes only active notification dedup rows for the given watch IDs and type. Used to roll back failed email sends so users are not suppressed for the 24h window. Preserves historical inactive rows.';

-- -----------------------------------------------------------------------------
-- 9. try_record_notifications_batch
-- -----------------------------------------------------------------------------
-- Atomically claims dedup slots for a batch of watch IDs. For each watch_id,
-- inserts a notification row only if no active, unexpired notification of the
-- same type exists. Returns only the newly-claimed watch IDs — that set is the
-- authorization to email. Emailing the full input array double-sends.
-- Handles unique_violation from the partial unique index for concurrency safety.

CREATE OR REPLACE FUNCTION public.try_record_notifications_batch(
  p_class_watch_ids    UUID[],
  p_notification_type  TEXT,
  p_expires_hours      INTEGER DEFAULT 24
)
RETURNS UUID[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recorded_ids UUID[] := '{}';
  v_watch_id UUID;
BEGIN
  IF p_notification_type NOT IN ('seat_available', 'instructor_assigned') THEN
    RAISE EXCEPTION 'Invalid notification_type: %', p_notification_type;
  END IF;

  IF p_expires_hours < 1 OR p_expires_hours > 168 THEN
    RAISE EXCEPTION 'Invalid p_expires_hours: %', p_expires_hours;
  END IF;

  FOREACH v_watch_id IN ARRAY p_class_watch_ids
  LOOP
    BEGIN
      PERFORM 1 FROM public.notifications_sent
      WHERE class_watch_id = v_watch_id
        AND notification_type = p_notification_type
        AND expires_at > NOW()
      LIMIT 1;

      IF NOT FOUND THEN
        INSERT INTO public.notifications_sent (
          class_watch_id, notification_type, sent_at, expires_at
        ) VALUES (
          v_watch_id, p_notification_type, NOW(),
          NOW() + (p_expires_hours || ' hours')::INTERVAL
        );
        v_recorded_ids := array_append(v_recorded_ids, v_watch_id);
      END IF;

    EXCEPTION
      WHEN unique_violation THEN
        NULL;
    END;
  END LOOP;

  RETURN v_recorded_ids;
END;
$$;

COMMENT ON FUNCTION public.try_record_notifications_batch(UUID[], TEXT, INTEGER)
IS 'Atomically claims dedup slots for a batch of watch IDs. Returns only the newly-claimed IDs — that set is the authorization to email. Handles unique_violation for concurrency safety. Emailing the full input array double-sends.';

-- -----------------------------------------------------------------------------
-- 10. expire_stale_notifications
-- -----------------------------------------------------------------------------
-- Flips expired active notification rows to is_active = FALSE, freeing dedup
-- slots for re-notification. Load-bearing: run on the daily cron. Without it,
-- re-notifications stop after the 24h window because slots are never freed.

CREATE OR REPLACE FUNCTION public.expire_stale_notifications()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.notifications_sent
  SET is_active = FALSE
  WHERE is_active = TRUE AND expires_at IS NOT NULL AND expires_at <= NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.expire_stale_notifications()
IS 'Flips expired active notification dedup rows to inactive, freeing slots for re-notification. Load-bearing — run on the daily cron. Without it, re-notifications stop after the 24h window.';

-- -----------------------------------------------------------------------------
-- 11. increment_consecutive_not_found
-- -----------------------------------------------------------------------------
-- Atomically increments consecutive_not_found_count for a SectionRef. Returns
-- the new count. Raises Section not found if no matching class_states row.
-- Prevents lost increments under concurrent workers (read-modify-write race).

CREATE OR REPLACE FUNCTION public.increment_consecutive_not_found(
  p_class_nbr TEXT,
  p_term      TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  UPDATE public.class_states
    SET consecutive_not_found_count = COALESCE(consecutive_not_found_count, 0) + 1
    WHERE class_nbr = p_class_nbr AND term = p_term
    RETURNING consecutive_not_found_count INTO v_new_count;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Section not found';
  END IF;

  RETURN v_new_count;
END;
$$;

COMMENT ON FUNCTION public.increment_consecutive_not_found(TEXT, TEXT)
IS 'Atomically increments consecutive_not_found_count for a SectionRef. Returns the new count. Raises Section not found if no matching class_states row. Prevents lost increments under concurrent workers.';

-- -----------------------------------------------------------------------------
-- 12. increment_failed_attempts
-- -----------------------------------------------------------------------------
-- Atomic upsert with increment for login lockout tracking. Locks the account
-- when attempts reach p_max_attempts for p_lockout_minutes. Returns the
-- current attempt count and whether the account is locked.

CREATE OR REPLACE FUNCTION public.increment_failed_attempts(
  p_email            TEXT,
  p_max_attempts     INTEGER DEFAULT 5,
  p_lockout_minutes  INTEGER DEFAULT 15
)
RETURNS TABLE (attempts INTEGER, locked BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts INTEGER;
  v_locked_until TIMESTAMPTZ;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- Atomic insert or increment.
  INSERT INTO failed_login_attempts (email, attempts, last_attempt_at, locked_until)
  VALUES (p_email, 1, v_now, NULL)
  ON CONFLICT (email) DO UPDATE SET
    attempts = failed_login_attempts.attempts + 1,
    last_attempt_at = v_now,
    -- Lock if attempts reach max.
    locked_until = CASE
      WHEN failed_login_attempts.attempts + 1 >= p_max_attempts
      THEN v_now + (p_lockout_minutes || ' minutes')::INTERVAL
      ELSE NULL
    END
  RETURNING failed_login_attempts.attempts, failed_login_attempts.locked_until
    INTO v_attempts, v_locked_until;

  RETURN QUERY SELECT v_attempts, (v_locked_until IS NOT NULL AND v_locked_until > v_now);
END;
$$;

COMMENT ON FUNCTION public.increment_failed_attempts(TEXT, INTEGER, INTEGER)
IS 'Atomic upsert that increments the failed login count for an email and locks the account when attempts reach p_max_attempts. Returns the current attempt count and locked status.';

-- -----------------------------------------------------------------------------
-- 13. create_class_watch_with_limit
-- -----------------------------------------------------------------------------
-- Atomically creates a class watch with per-user max watch enforcement.
-- Serializes watch creation per user via a transaction-scoped advisory lock to
-- prevent concurrent requests from bypassing the limit. Raises
-- MAX_WATCHES_EXCEEDED (P0001) if the user is at or over the limit.
-- p_user_id is TEXT (Clerk user id).

CREATE OR REPLACE FUNCTION public.create_class_watch_with_limit(
  p_user_id      TEXT,
  p_term         TEXT,
  p_subject      TEXT,
  p_catalog_nbr  TEXT,
  p_class_nbr    TEXT,
  p_max_watches  INTEGER
)
RETURNS public.class_watches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_count INTEGER;
  v_watch public.class_watches;
BEGIN
  IF p_max_watches < 1 THEN
    RAISE EXCEPTION 'Invalid watch limit: %', p_max_watches;
  END IF;

  -- Serialize watch creation per user to avoid race conditions.
  PERFORM pg_advisory_xact_lock(('x' || SUBSTRING(md5(p_user_id), 1, 16))::BIT(64)::BIGINT);

  SELECT COUNT(*)
  INTO v_current_count
  FROM public.class_watches
  WHERE user_id = p_user_id;

  IF v_current_count >= p_max_watches THEN
    RAISE EXCEPTION 'MAX_WATCHES_EXCEEDED'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.class_watches (
    user_id,
    term,
    subject,
    catalog_nbr,
    class_nbr
  )
  VALUES (
    p_user_id,
    p_term,
    p_subject,
    p_catalog_nbr,
    p_class_nbr
  )
  RETURNING * INTO v_watch;

  RETURN v_watch;
END;
$$;

COMMENT ON FUNCTION public.create_class_watch_with_limit(TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER)
IS 'Atomically inserts a class watch with per-user max watch enforcement via an advisory lock. Raises MAX_WATCHES_EXCEEDED (P0001) if over the limit. p_user_id is the Clerk user id (TEXT).';

-- -----------------------------------------------------------------------------
-- 14. accept_terms_and_verify_age
-- -----------------------------------------------------------------------------
-- Atomically records missing age-verification and terms-consent timestamps for
-- the given user. Preserves existing timestamps (COALESCE). Raises if the user
-- profile is not found. Takes an explicit p_user_id parameter (Clerk session
-- provides it) instead of using auth.uid().

CREATE OR REPLACE FUNCTION public.accept_terms_and_verify_age(p_user_id TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_consent_time TIMESTAMPTZ := NOW();
BEGIN
  UPDATE public.user_profiles
  SET age_verified_at    = COALESCE(age_verified_at, v_consent_time),
      agreed_to_terms_at = COALESCE(agreed_to_terms_at, v_consent_time)
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.accept_terms_and_verify_age(TEXT)
IS 'Atomically records missing age-verification and terms-consent timestamps for the given user, preserving existing timestamps. Raises if the profile is not found. Takes an explicit p_user_id (Clerk id) instead of auth.uid().';

-- -----------------------------------------------------------------------------
-- 15. skip_onboarding
-- -----------------------------------------------------------------------------
-- Marks onboarding as skipped for the given user. No-ops if already completed
-- or already skipped. Returns the resulting onboarding state. Takes an explicit
-- p_user_id parameter (Clerk session provides it) instead of using auth.uid().

CREATE OR REPLACE FUNCTION public.skip_onboarding(p_user_id TEXT)
RETURNS TABLE (
  onboarding_completed_at TIMESTAMPTZ,
  onboarding_skipped_at   TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.user_profiles up
    SET onboarding_skipped_at = NOW()
    WHERE up.user_id = p_user_id
      AND up.onboarding_completed_at IS NULL
      AND up.onboarding_skipped_at IS NULL;

  RETURN QUERY
    SELECT up.onboarding_completed_at, up.onboarding_skipped_at
    FROM public.user_profiles up
    WHERE up.user_id = p_user_id;
END;
$$;

COMMENT ON FUNCTION public.skip_onboarding(TEXT)
IS 'Marks onboarding as skipped for the given user. No-ops if already completed or skipped. Returns the resulting onboarding state. Takes an explicit p_user_id (Clerk id) instead of auth.uid().';

-- -----------------------------------------------------------------------------
-- 16. get_users_page
-- -----------------------------------------------------------------------------
-- Paginated admin user listing with authoritative notification status. Joins
-- users (not auth.users). Sort keys are selected through static CASE
-- expressions (whitelist — no dynamic SQL). Returns total_count on every row.
-- id is TEXT (Clerk user id).

CREATE OR REPLACE FUNCTION public.get_users_page(
  p_page        INTEGER DEFAULT 1,
  p_page_size   INTEGER DEFAULT 25,
  p_search      TEXT DEFAULT '',
  p_role        TEXT DEFAULT 'all',
  p_verified    TEXT DEFAULT 'all',
  p_watch_count TEXT DEFAULT 'all',
  p_sort        TEXT DEFAULT 'created_at',
  p_dir         TEXT DEFAULT 'desc'
)
RETURNS TABLE (
  id                  TEXT,
  email               TEXT,
  created_at          TIMESTAMPTZ,
  last_sign_in_at     TIMESTAMPTZ,
  email_confirmed_at  TIMESTAMPTZ,
  watch_count         BIGINT,
  is_admin            BOOLEAN,
  seat_emails         BIGINT,
  instructor_emails   BIGINT,
  notification_status TEXT,
  total_count         BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH params AS (
    SELECT
      GREATEST(1, LEAST(200, COALESCE(p_page_size, 25))) AS page_size,
      (GREATEST(1, COALESCE(p_page, 1)) - 1)
        * GREATEST(1, LEAST(200, COALESCE(p_page_size, 25))) AS page_offset,
      CASE lower(COALESCE(p_sort, 'created_at'))
        WHEN 'email' THEN 'email'
        WHEN 'last_sign_in_at' THEN 'last_sign_in_at'
        WHEN 'watch_count' THEN 'watch_count'
        WHEN 'seat_emails' THEN 'seat_emails'
        WHEN 'instructor_emails' THEN 'instructor_emails'
        ELSE 'created_at'
      END AS sort_key,
      lower(COALESCE(p_dir, 'desc')) = 'asc' AS sort_ascending
  ),
  base AS (
    SELECT
      u.id,
      u.email::TEXT AS email,
      u.created_at,
      u.last_sign_in_at,
      u.email_confirmed_at,
      COALESCE(wc.watch_count, 0) AS watch_count,
      COALESCE(up.is_admin, FALSE) AS is_admin,
      COALESCE(nc.seat_emails, 0) AS seat_emails,
      COALESCE(nc.instructor_emails, 0) AS instructor_emails,
      CASE
        WHEN COALESCE(up.is_disabled, FALSE) THEN 'disabled'
        WHEN COALESCE(up.spam_complained, FALSE) THEN 'spam'
        WHEN COALESCE(up.email_bounced, FALSE) THEN 'bounced'
        WHEN NOT COALESCE(up.notifications_enabled, TRUE)
          OR up.unsubscribed_at IS NOT NULL THEN 'unsubscribed'
        ELSE 'active'
      END AS notification_status
    FROM public.users u
    LEFT JOIN (
      SELECT user_id, COUNT(*) AS watch_count
      FROM public.class_watches
      GROUP BY user_id
    ) wc ON wc.user_id = u.id
    LEFT JOIN public.user_profiles up ON up.user_id = u.id
    LEFT JOIN (
      SELECT
        cw.user_id,
        COUNT(*) FILTER (WHERE ns.notification_type = 'seat_available') AS seat_emails,
        COUNT(*) FILTER (WHERE ns.notification_type = 'instructor_assigned') AS instructor_emails
      FROM public.notifications_sent ns
      INNER JOIN public.class_watches cw ON cw.id = ns.class_watch_id
      GROUP BY cw.user_id
    ) nc ON nc.user_id = u.id
    WHERE (p_search = '' OR u.email ILIKE '%' || p_search || '%')
      AND (
        p_role = 'all'
        OR (p_role = 'admin' AND COALESCE(up.is_admin, FALSE))
        OR (p_role = 'user' AND NOT COALESCE(up.is_admin, FALSE))
      )
      AND (
        p_verified = 'all'
        OR (p_verified = 'verified' AND u.email_confirmed_at IS NOT NULL)
        OR (p_verified = 'unverified' AND u.email_confirmed_at IS NULL)
      )
      AND (
        p_watch_count = 'all'
        OR (p_watch_count = 'none' AND COALESCE(wc.watch_count, 0) = 0)
        OR (p_watch_count = '1-5' AND COALESCE(wc.watch_count, 0) BETWEEN 1 AND 5)
        OR (p_watch_count = '6-10' AND COALESCE(wc.watch_count, 0) BETWEEN 6 AND 10)
        OR (p_watch_count = '10+' AND COALESCE(wc.watch_count, 0) > 10)
      )
  )
  SELECT
    base.*,
    COUNT(*) OVER () AS total_count
  FROM base
  CROSS JOIN params
  ORDER BY
    CASE WHEN params.sort_key = 'email' AND params.sort_ascending THEN base.email END ASC NULLS LAST,
    CASE WHEN params.sort_key = 'email' AND NOT params.sort_ascending THEN base.email END DESC NULLS LAST,
    CASE WHEN params.sort_key = 'last_sign_in_at' AND params.sort_ascending THEN base.last_sign_in_at END ASC NULLS LAST,
    CASE WHEN params.sort_key = 'last_sign_in_at' AND NOT params.sort_ascending THEN base.last_sign_in_at END DESC NULLS LAST,
    CASE WHEN params.sort_key = 'watch_count' AND params.sort_ascending THEN base.watch_count END ASC NULLS LAST,
    CASE WHEN params.sort_key = 'watch_count' AND NOT params.sort_ascending THEN base.watch_count END DESC NULLS LAST,
    CASE WHEN params.sort_key = 'seat_emails' AND params.sort_ascending THEN base.seat_emails END ASC NULLS LAST,
    CASE WHEN params.sort_key = 'seat_emails' AND NOT params.sort_ascending THEN base.seat_emails END DESC NULLS LAST,
    CASE WHEN params.sort_key = 'instructor_emails' AND params.sort_ascending THEN base.instructor_emails END ASC NULLS LAST,
    CASE WHEN params.sort_key = 'instructor_emails' AND NOT params.sort_ascending THEN base.instructor_emails END DESC NULLS LAST,
    CASE WHEN params.sort_key = 'created_at' AND params.sort_ascending THEN base.created_at END ASC NULLS LAST,
    CASE WHEN params.sort_key = 'created_at' AND NOT params.sort_ascending THEN base.created_at END DESC NULLS LAST,
    base.id
  LIMIT (SELECT page_size FROM params)
  OFFSET (SELECT page_offset FROM params);
$$;

COMMENT ON FUNCTION public.get_users_page(INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
IS 'Paginated admin user listing with authoritative notification status. Joins users (not auth.users). Sort keys are selected through static CASE expressions (whitelist). Returns total_count on every row. id is the Clerk user id (TEXT).';

-- -----------------------------------------------------------------------------
-- 17. get_classes_page
-- -----------------------------------------------------------------------------
-- Paginated admin class listing with SectionRef-scoped counts, static
-- whitelisted sorting, and page-independent global aggregates (total_watchers,
-- full_classes). Groups watcher and notification counts by (class_nbr, term) —
-- NOT class_nbr alone, because a section number repeats across terms.

CREATE OR REPLACE FUNCTION public.get_classes_page(
  p_page          INTEGER DEFAULT 1,
  p_page_size     INTEGER DEFAULT 25,
  p_search        TEXT DEFAULT '',
  p_subject       TEXT DEFAULT 'all',
  p_seat_status   TEXT DEFAULT 'all',
  p_instructor    TEXT DEFAULT 'all',
  p_watcher_count TEXT DEFAULT 'all',
  p_sort          TEXT DEFAULT 'watcher_count',
  p_dir           TEXT DEFAULT 'desc'
)
RETURNS TABLE (
  id                 TEXT,
  class_nbr          TEXT,
  term               TEXT,
  subject            TEXT,
  catalog_nbr        TEXT,
  title              TEXT,
  instructor_name    TEXT,
  seats_available    INTEGER,
  seats_capacity     INTEGER,
  non_reserved_seats INTEGER,
  location           TEXT,
  meeting_times      TEXT,
  last_checked_at    TIMESTAMPTZ,
  last_changed_at    TIMESTAMPTZ,
  watcher_count      BIGINT,
  seat_emails        BIGINT,
  instructor_emails  BIGINT,
  total_count        BIGINT,
  total_watchers     BIGINT,
  full_classes       BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH params AS (
    SELECT
      GREATEST(1, LEAST(200, COALESCE(p_page_size, 25))) AS page_size,
      (GREATEST(1, COALESCE(p_page, 1)) - 1)
        * GREATEST(1, LEAST(200, COALESCE(p_page_size, 25))) AS page_offset,
      CASE lower(COALESCE(p_sort, 'watcher_count'))
        WHEN 'class_nbr' THEN 'class_nbr'
        WHEN 'subject' THEN 'subject'
        WHEN 'seats_available' THEN 'seats_available'
        WHEN 'seat_emails' THEN 'seat_emails'
        WHEN 'instructor_emails' THEN 'instructor_emails'
        WHEN 'last_checked_at' THEN 'last_checked_at'
        ELSE 'watcher_count'
      END AS sort_key,
      lower(COALESCE(p_dir, 'desc')) = 'asc' AS sort_ascending
  ),
  base AS (
    SELECT
      cs.id::TEXT AS id,
      cs.class_nbr,
      cs.term,
      cs.subject,
      cs.catalog_nbr,
      cs.title,
      cs.instructor_name,
      cs.seats_available,
      cs.seats_capacity,
      cs.non_reserved_seats,
      cs.location,
      cs.meeting_times,
      cs.last_checked_at,
      cs.last_changed_at,
      COALESCE(wc.watcher_count, 0) AS watcher_count,
      COALESCE(nc.seat_emails, 0) AS seat_emails,
      COALESCE(nc.instructor_emails, 0) AS instructor_emails
    FROM public.class_states cs
    LEFT JOIN (
      SELECT class_nbr, term, COUNT(*) AS watcher_count
      FROM public.class_watches
      GROUP BY class_nbr, term
    ) wc ON wc.class_nbr = cs.class_nbr AND wc.term = cs.term
    LEFT JOIN (
      SELECT
        cw.class_nbr,
        cw.term,
        COUNT(*) FILTER (WHERE ns.notification_type = 'seat_available') AS seat_emails,
        COUNT(*) FILTER (WHERE ns.notification_type = 'instructor_assigned') AS instructor_emails
      FROM public.notifications_sent ns
      INNER JOIN public.class_watches cw ON cw.id = ns.class_watch_id
      GROUP BY cw.class_nbr, cw.term
    ) nc ON nc.class_nbr = cs.class_nbr AND nc.term = cs.term
    WHERE (
      COALESCE(p_search, '') = ''
      OR cs.class_nbr ILIKE '%' || p_search || '%'
      OR cs.title ILIKE '%' || p_search || '%'
    )
      AND (COALESCE(p_subject, 'all') = 'all' OR cs.subject = p_subject)
      AND (
        COALESCE(p_seat_status, 'all') = 'all'
        OR (p_seat_status = 'full' AND cs.seats_available = 0)
        OR (
          p_seat_status = 'limited'
          AND cs.seats_available > 0
          AND cs.seats_capacity > 0
          AND cs.seats_available::NUMERIC / cs.seats_capacity::NUMERIC < 0.2
        )
        OR (
          p_seat_status = 'available'
          AND cs.seats_capacity > 0
          AND cs.seats_available::NUMERIC / cs.seats_capacity::NUMERIC >= 0.2
        )
      )
      AND (
        COALESCE(p_instructor, 'all') = 'all'
        OR (
          p_instructor = 'staff'
          AND (cs.instructor_name IS NULL OR cs.instructor_name = 'Staff')
        )
        OR (
          p_instructor = 'named'
          AND cs.instructor_name IS NOT NULL
          AND cs.instructor_name <> 'Staff'
        )
      )
      AND (
        COALESCE(p_watcher_count, 'all') = 'all'
        OR (p_watcher_count = 'none' AND COALESCE(wc.watcher_count, 0) = 0)
        OR (p_watcher_count = '1-5' AND COALESCE(wc.watcher_count, 0) BETWEEN 1 AND 5)
        OR (p_watcher_count = '6-10' AND COALESCE(wc.watcher_count, 0) BETWEEN 6 AND 10)
        OR (p_watcher_count = '10+' AND COALESCE(wc.watcher_count, 0) > 10)
      )
  )
  SELECT
    base.*,
    COUNT(*) OVER () AS total_count,
    COALESCE(SUM(base.watcher_count) OVER (), 0)::BIGINT AS total_watchers,
    COUNT(*) FILTER (WHERE base.seats_available = 0) OVER () AS full_classes
  FROM base
  CROSS JOIN params
  ORDER BY
    CASE WHEN params.sort_key = 'class_nbr' AND params.sort_ascending THEN base.class_nbr END ASC NULLS LAST,
    CASE WHEN params.sort_key = 'class_nbr' AND NOT params.sort_ascending THEN base.class_nbr END DESC NULLS LAST,
    CASE WHEN params.sort_key = 'subject' AND params.sort_ascending THEN base.subject END ASC NULLS LAST,
    CASE WHEN params.sort_key = 'subject' AND NOT params.sort_ascending THEN base.subject END DESC NULLS LAST,
    CASE WHEN params.sort_key = 'seats_available' AND params.sort_ascending THEN base.seats_available END ASC NULLS LAST,
    CASE WHEN params.sort_key = 'seats_available' AND NOT params.sort_ascending THEN base.seats_available END DESC NULLS LAST,
    CASE WHEN params.sort_key = 'watcher_count' AND params.sort_ascending THEN base.watcher_count END ASC NULLS LAST,
    CASE WHEN params.sort_key = 'watcher_count' AND NOT params.sort_ascending THEN base.watcher_count END DESC NULLS LAST,
    CASE WHEN params.sort_key = 'seat_emails' AND params.sort_ascending THEN base.seat_emails END ASC NULLS LAST,
    CASE WHEN params.sort_key = 'seat_emails' AND NOT params.sort_ascending THEN base.seat_emails END DESC NULLS LAST,
    CASE WHEN params.sort_key = 'instructor_emails' AND params.sort_ascending THEN base.instructor_emails END ASC NULLS LAST,
    CASE WHEN params.sort_key = 'instructor_emails' AND NOT params.sort_ascending THEN base.instructor_emails END DESC NULLS LAST,
    CASE WHEN params.sort_key = 'last_checked_at' AND params.sort_ascending THEN base.last_checked_at END ASC NULLS LAST,
    CASE WHEN params.sort_key = 'last_checked_at' AND NOT params.sort_ascending THEN base.last_checked_at END DESC NULLS LAST,
    base.class_nbr,
    base.term,
    base.id
  LIMIT (SELECT page_size FROM params)
  OFFSET (SELECT page_offset FROM params);
$$;

COMMENT ON FUNCTION public.get_classes_page(INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
IS 'Paginated admin class listing with SectionRef-scoped counts (class_nbr + term, not class_nbr alone), static whitelisted sorting, and page-independent global aggregates (total_watchers, full_classes).';

-- -----------------------------------------------------------------------------
-- 18. get_recent_activity
-- -----------------------------------------------------------------------------
-- Unified recent activity feed combining user registrations (users), new class
-- watches (class_watches), and sent email notifications (notifications_sent).
-- Joins users (not auth.users). Used by the admin dashboard.

CREATE OR REPLACE FUNCTION public.get_recent_activity(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  activity_type     TEXT,
  activity_at       TIMESTAMPTZ,
  user_email        TEXT,
  class_nbr         TEXT,
  subject           TEXT,
  catalog_nbr       TEXT,
  notification_type TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  (
    SELECT
      'user_registration'::TEXT AS activity_type,
      u.created_at AS activity_at,
      u.email::TEXT AS user_email,
      NULL::TEXT AS class_nbr,
      NULL::TEXT AS subject,
      NULL::TEXT AS catalog_nbr,
      NULL::TEXT AS notification_type
    FROM public.users u
    ORDER BY u.created_at DESC
  )
  UNION ALL
  (
    SELECT
      'new_watch'::TEXT AS activity_type,
      cw.created_at AS activity_at,
      u.email::TEXT AS user_email,
      cw.class_nbr,
      cw.subject,
      cw.catalog_nbr,
      NULL::TEXT AS notification_type
    FROM public.class_watches cw
    INNER JOIN public.users u ON u.id = cw.user_id
    ORDER BY cw.created_at DESC
  )
  UNION ALL
  (
    SELECT
      'email_sent'::TEXT AS activity_type,
      ns.sent_at AS activity_at,
      u.email::TEXT AS user_email,
      cw.class_nbr,
      cw.subject,
      cw.catalog_nbr,
      ns.notification_type::TEXT
    FROM public.notifications_sent ns
    INNER JOIN public.class_watches cw ON cw.id = ns.class_watch_id
    INNER JOIN public.users u ON u.id = cw.user_id
    ORDER BY ns.sent_at DESC
  )
  ORDER BY activity_at DESC
  LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION public.get_recent_activity(INTEGER)
IS 'Returns a unified recent activity feed combining user registrations, new class watches, and sent email notifications. Joins users (not auth.users). Used by the admin dashboard.';

-- =============================================================================
-- End of consolidated PlanetScale schema
-- =============================================================================
