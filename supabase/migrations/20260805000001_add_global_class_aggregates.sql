-- Add page-independent global aggregates to the admin classes page RPC.
--
-- The previous definition (20260712000006) computed the "Total Watchers" and
-- "Full Classes" admin stat cards client-side from the current page's rows
-- only, so the cards changed when paginating or filtering. This version keeps
-- the exact same per-row shape and adds two global aggregates computed with
-- window functions over the full filtered result set — the same pattern
-- total_count uses — so the cards are independent of the LIMIT/OFFSET page
-- window. total_watchers is the sum of watcher counts across all matching
-- sections; full_classes is the count of matching sections with
-- seats_available = 0.

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
IS 'Paginated admin class listing with SectionRef-scoped counts, static, whitelisted sorting, and page-independent global aggregates (total_watchers, full_classes).';

REVOKE EXECUTE ON FUNCTION public.get_classes_page(INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_classes_page(INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
