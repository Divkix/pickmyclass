-- Add server-side paginated RPCs for admin users and classes dashboards.
-- These replace the full-table in-app joins previously done in admin-queries.ts.
-- Both functions are SECURITY DEFINER so they can read auth.users for email/verified status.

-- ─────────────────────────────────────────────────────────────────────────────
-- get_users_page
-- ─────────────────────────────────────────────────────────────────────────────
-- Returns one page of users joined with watch counts, notification counts,
-- and engagement stats.  All filter dimensions are applied in SQL.
--
-- Parameters:
--   p_page          1-based page number
--   p_page_size     rows per page (clamped to 1–200)
--   p_search        ILIKE filter on auth.users.email ('' = no filter)
--   p_role          'all' | 'admin' | 'user'
--   p_verified      'all' | 'verified' | 'unverified'
--   p_watch_count   'all' | 'none' | '1-5' | '6-10' | '10+'
--   p_sort          whitelisted sort column
--   p_dir           'asc' | 'desc'
--
-- Returns columns matching UserWithWatchCount plus total_count.
CREATE OR REPLACE FUNCTION public.get_users_page(
  p_page        INTEGER  DEFAULT 1,
  p_page_size   INTEGER  DEFAULT 25,
  p_search      TEXT     DEFAULT '',
  p_role        TEXT     DEFAULT 'all',
  p_verified    TEXT     DEFAULT 'all',
  p_watch_count TEXT     DEFAULT 'all',
  p_sort        TEXT     DEFAULT 'created_at',
  p_dir         TEXT     DEFAULT 'desc'
)
RETURNS TABLE (
  id                       UUID,
  email                    TEXT,
  created_at               TIMESTAMP WITH TIME ZONE,
  last_sign_in_at          TIMESTAMP WITH TIME ZONE,
  email_confirmed_at       TIMESTAMP WITH TIME ZONE,
  watch_count              BIGINT,
  is_admin                 BOOLEAN,
  seat_emails              BIGINT,
  instructor_emails        BIGINT,
  engagement_emails_sent   INTEGER,
  engagement_emails_opened INTEGER,
  engagement_rate          NUMERIC,
  engagement_status        TEXT,
  total_count              BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset    INTEGER;
  v_page_size INTEGER;
  v_sort_sql  TEXT;
  v_dir_sql   TEXT;
BEGIN
  -- Clamp page size
  v_page_size := GREATEST(1, LEAST(200, COALESCE(p_page_size, 25)));
  v_offset    := (GREATEST(1, COALESCE(p_page, 1)) - 1) * v_page_size;

  -- Whitelist sort direction (prevent SQL injection)
  v_dir_sql := CASE
    WHEN lower(p_dir) = 'asc' THEN 'ASC NULLS LAST'
    ELSE                            'DESC NULLS LAST'
  END;

  -- Whitelist sort column (prevent SQL injection via string interpolation)
  v_sort_sql := CASE lower(COALESCE(p_sort, 'created_at'))
    WHEN 'email'            THEN 'email'
    WHEN 'last_sign_in_at'  THEN 'last_sign_in_at'
    WHEN 'watch_count'      THEN 'watch_count'
    WHEN 'seat_emails'      THEN 'seat_emails'
    WHEN 'instructor_emails'THEN 'instructor_emails'
    WHEN 'engagement_rate'  THEN 'engagement_rate'
    ELSE                         'created_at'   -- default / 'created_at'
  END;

  RETURN QUERY EXECUTE format(
    $sql$
    WITH base AS (
      SELECT
        u.id,
        u.email::TEXT                                              AS email,
        u.created_at,
        u.last_sign_in_at,
        u.email_confirmed_at,
        COALESCE(wc.watch_count, 0)                               AS watch_count,
        COALESCE(up.is_admin, FALSE)                              AS is_admin,
        COALESCE(nc.seat_emails, 0)                               AS seat_emails,
        COALESCE(nc.instructor_emails, 0)                         AS instructor_emails,
        COALESCE(up.engagement_emails_sent, 0)                    AS engagement_emails_sent,
        COALESCE(up.engagement_emails_opened, 0)                  AS engagement_emails_opened,
        CASE
          WHEN up.engagement_emails_sent IS NULL OR up.engagement_emails_sent = 0 THEN NULL
          ELSE ROUND(
            (up.engagement_emails_opened::NUMERIC / up.engagement_emails_sent::NUMERIC) * 100,
            0
          )
        END                                                        AS engagement_rate,
        CASE
          WHEN up.id IS NULL THEN 'new'
          WHEN up.engagement_disabled_at IS NOT NULL THEN 'disabled'
          WHEN up.engagement_emails_sent > 0
               AND (up.engagement_emails_opened::NUMERIC / up.engagement_emails_sent::NUMERIC) < 0.2
               THEN 'low'
          WHEN up.engagement_emails_sent = 0 THEN 'new'
          ELSE 'healthy'
        END                                                        AS engagement_status
      FROM auth.users u
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS watch_count
        FROM public.class_watches
        GROUP BY user_id
      ) wc ON wc.user_id = u.id
      LEFT JOIN public.user_profiles up ON up.user_id = u.id
      LEFT JOIN (
        SELECT cw.user_id,
               SUM(CASE WHEN ns.notification_type = 'seat_available'     THEN 1 ELSE 0 END) AS seat_emails,
               SUM(CASE WHEN ns.notification_type = 'instructor_assigned' THEN 1 ELSE 0 END) AS instructor_emails
        FROM public.notifications_sent ns
        INNER JOIN public.class_watches cw ON cw.id = ns.class_watch_id
        GROUP BY cw.user_id
      ) nc ON nc.user_id = u.id
      WHERE
        -- search filter
        ($1 = '' OR u.email ILIKE '%%' || $1 || '%%')
        -- role filter
        AND (
          $2 = 'all'
          OR ($2 = 'admin' AND COALESCE(up.is_admin, FALSE) = TRUE)
          OR ($2 = 'user'  AND COALESCE(up.is_admin, FALSE) = FALSE)
        )
        -- verified filter
        AND (
          $3 = 'all'
          OR ($3 = 'verified'   AND u.email_confirmed_at IS NOT NULL)
          OR ($3 = 'unverified' AND u.email_confirmed_at IS NULL)
        )
        -- watch count range filter
        AND (
          $4 = 'all'
          OR ($4 = 'none' AND COALESCE(wc.watch_count, 0) = 0)
          OR ($4 = '1-5'  AND COALESCE(wc.watch_count, 0) BETWEEN 1 AND 5)
          OR ($4 = '6-10' AND COALESCE(wc.watch_count, 0) BETWEEN 6 AND 10)
          OR ($4 = '10+'  AND COALESCE(wc.watch_count, 0) > 10)
        )
    )
    SELECT
      base.*,
      COUNT(*) OVER () AS total_count
    FROM base
    ORDER BY %s %s
    LIMIT $5
    OFFSET $6
    $sql$,
    v_sort_sql,
    v_dir_sql
  )
  USING p_search, p_role, p_verified, p_watch_count, v_page_size, v_offset;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_users_page(INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_users_page(INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_users_page(INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_users_page(INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.get_users_page IS
  'Paginated, filtered, sorted admin user listing. Returns one page of users with '
  'watch counts, notification counts, and engagement stats. SECURITY DEFINER is required '
  'to read auth.users. Sort keys are whitelisted via CASE to prevent SQL injection.';

-- ─────────────────────────────────────────────────────────────────────────────
-- get_classes_page
-- ─────────────────────────────────────────────────────────────────────────────
-- Returns one page of class_states joined with watcher counts and notification
-- counts.  All filter dimensions are applied in SQL.
--
-- Parameters:
--   p_page          1-based page number
--   p_page_size     rows per page (clamped to 1–200)
--   p_search        ILIKE filter on class_nbr or title ('' = no filter)
--   p_subject       subject code or 'all'
--   p_seat_status   'all' | 'full' | 'limited' | 'available'
--   p_instructor    'all' | 'staff' | 'named'
--   p_watcher_count 'all' | 'none' | '1-5' | '6-10' | '10+'
--   p_sort          whitelisted sort column
--   p_dir           'asc' | 'desc'
--
-- Returns columns matching ClassWithWatchers plus total_count.
CREATE OR REPLACE FUNCTION public.get_classes_page(
  p_page          INTEGER  DEFAULT 1,
  p_page_size     INTEGER  DEFAULT 25,
  p_search        TEXT     DEFAULT '',
  p_subject       TEXT     DEFAULT 'all',
  p_seat_status   TEXT     DEFAULT 'all',
  p_instructor    TEXT     DEFAULT 'all',
  p_watcher_count TEXT     DEFAULT 'all',
  p_sort          TEXT     DEFAULT 'watcher_count',
  p_dir           TEXT     DEFAULT 'desc'
)
RETURNS TABLE (
  id               TEXT,
  class_nbr        TEXT,
  term             TEXT,
  subject          TEXT,
  catalog_nbr      TEXT,
  title            TEXT,
  instructor_name  TEXT,
  seats_available  INTEGER,
  seats_capacity   INTEGER,
  non_reserved_seats INTEGER,
  location         TEXT,
  meeting_times    TEXT,
  last_checked_at  TIMESTAMP WITH TIME ZONE,
  last_changed_at  TIMESTAMP WITH TIME ZONE,
  watcher_count    BIGINT,
  seat_emails      BIGINT,
  instructor_emails BIGINT,
  total_count      BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset    INTEGER;
  v_page_size INTEGER;
  v_sort_sql  TEXT;
  v_dir_sql   TEXT;
BEGIN
  -- Clamp page size
  v_page_size := GREATEST(1, LEAST(200, COALESCE(p_page_size, 25)));
  v_offset    := (GREATEST(1, COALESCE(p_page, 1)) - 1) * v_page_size;

  -- Whitelist sort direction
  v_dir_sql := CASE
    WHEN lower(p_dir) = 'asc' THEN 'ASC NULLS LAST'
    ELSE                            'DESC NULLS LAST'
  END;

  -- Whitelist sort column (prevent SQL injection)
  v_sort_sql := CASE lower(COALESCE(p_sort, 'watcher_count'))
    WHEN 'class_nbr'         THEN 'class_nbr::INTEGER'
    WHEN 'subject'           THEN 'subject'
    WHEN 'seats_available'   THEN 'seats_available'
    WHEN 'seat_emails'       THEN 'seat_emails'
    WHEN 'instructor_emails' THEN 'instructor_emails'
    WHEN 'last_checked_at'   THEN 'last_checked_at'
    ELSE                          'watcher_count'  -- default / 'watcher_count'
  END;

  RETURN QUERY EXECUTE format(
    $sql$
    WITH base AS (
      SELECT
        cs.id::TEXT,
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
        COALESCE(wc.watcher_count, 0)       AS watcher_count,
        COALESCE(nc.seat_emails, 0)          AS seat_emails,
        COALESCE(nc.instructor_emails, 0)    AS instructor_emails
      FROM public.class_states cs
      LEFT JOIN (
        SELECT class_nbr, COUNT(*) AS watcher_count
        FROM public.class_watches
        GROUP BY class_nbr
      ) wc ON wc.class_nbr = cs.class_nbr
      LEFT JOIN (
        SELECT cw.class_nbr,
               SUM(CASE WHEN ns.notification_type = 'seat_available'     THEN 1 ELSE 0 END) AS seat_emails,
               SUM(CASE WHEN ns.notification_type = 'instructor_assigned' THEN 1 ELSE 0 END) AS instructor_emails
        FROM public.notifications_sent ns
        INNER JOIN public.class_watches cw ON cw.id = ns.class_watch_id
        GROUP BY cw.class_nbr
      ) nc ON nc.class_nbr = cs.class_nbr
      WHERE
        -- search filter: class_nbr contains OR title ILIKE
        ($1 = '' OR cs.class_nbr ILIKE '%%' || $1 || '%%' OR cs.title ILIKE '%%' || $1 || '%%')
        -- subject filter
        AND ($2 = 'all' OR cs.subject = $2)
        -- seat status filter
        AND (
          $3 = 'all'
          OR ($3 = 'full'      AND cs.seats_available = 0)
          OR ($3 = 'limited'   AND cs.seats_available > 0
                               AND cs.seats_capacity > 0
                               AND (cs.seats_available::NUMERIC / cs.seats_capacity::NUMERIC) < 0.2)
          OR ($3 = 'available' AND cs.seats_capacity > 0
                               AND (cs.seats_available::NUMERIC / cs.seats_capacity::NUMERIC) >= 0.2)
        )
        -- instructor filter
        AND (
          $4 = 'all'
          OR ($4 = 'staff' AND (cs.instructor_name IS NULL OR cs.instructor_name = 'Staff'))
          OR ($4 = 'named' AND cs.instructor_name IS NOT NULL AND cs.instructor_name <> 'Staff')
        )
        -- watcher count range filter
        AND (
          $5 = 'all'
          OR ($5 = 'none' AND COALESCE(wc.watcher_count, 0) = 0)
          OR ($5 = '1-5'  AND COALESCE(wc.watcher_count, 0) BETWEEN 1 AND 5)
          OR ($5 = '6-10' AND COALESCE(wc.watcher_count, 0) BETWEEN 6 AND 10)
          OR ($5 = '10+'  AND COALESCE(wc.watcher_count, 0) > 10)
        )
    )
    SELECT
      base.*,
      COUNT(*) OVER () AS total_count
    FROM base
    ORDER BY %s %s
    LIMIT $6
    OFFSET $7
    $sql$,
    v_sort_sql,
    v_dir_sql
  )
  USING p_search, p_subject, p_seat_status, p_instructor, p_watcher_count, v_page_size, v_offset;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_classes_page(INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_classes_page(INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_classes_page(INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_classes_page(INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.get_classes_page IS
  'Paginated, filtered, sorted admin class listing. Returns one page of class_states with '
  'watcher counts and notification counts. Sort keys are whitelisted via CASE to prevent '
  'SQL injection.';

-- ─────────────────────────────────────────────────────────────────────────────
-- get_distinct_subjects
-- ─────────────────────────────────────────────────────────────────────────────
-- Returns the sorted list of distinct subject codes from class_states.
-- Used to populate the subject filter drop-down on the classes admin page.
CREATE OR REPLACE FUNCTION public.get_distinct_subjects()
RETURNS TABLE (subject TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT cs.subject FROM public.class_states cs ORDER BY cs.subject;
$$;

REVOKE EXECUTE ON FUNCTION public.get_distinct_subjects() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_distinct_subjects() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_distinct_subjects() FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_distinct_subjects() TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- count_distinct_classes_watched
-- ─────────────────────────────────────────────────────────────────────────────
-- Returns the count of distinct class_nbr values in class_watches.
-- Replaces the full select('class_nbr') + Set.size pattern.
CREATE OR REPLACE FUNCTION public.count_distinct_classes_watched()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(DISTINCT class_nbr) FROM public.class_watches;
$$;

REVOKE EXECUTE ON FUNCTION public.count_distinct_classes_watched() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.count_distinct_classes_watched() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.count_distinct_classes_watched() FROM anon;
GRANT  EXECUTE ON FUNCTION public.count_distinct_classes_watched() TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- count_all_users
-- ─────────────────────────────────────────────────────────────────────────────
-- Returns the total number of registered users via user_profiles (1:1 with auth.users,
-- enforced by the on_auth_user_created trigger in migration 20251024120000).
-- Replaces the 50-page auth.admin.listUsers walk.
CREATE OR REPLACE FUNCTION public.count_all_users()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*) FROM public.user_profiles;
$$;

REVOKE EXECUTE ON FUNCTION public.count_all_users() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.count_all_users() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.count_all_users() FROM anon;
GRANT  EXECUTE ON FUNCTION public.count_all_users() TO service_role;
