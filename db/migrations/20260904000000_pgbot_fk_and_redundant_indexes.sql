-- pgbot findings (2026-09-04).
-- 1. notifications_sent.class_watch_id FK has no supporting index: the only
--    composite (unique_notification_active) is partial (WHERE is_active) so it
--    cannot back the FK, and cascade probes from class_watches seq-scan.
-- 2-3. Two single-col indexes are strict left-prefixes of wider uniques.
-- Plain (non-concurrent) DDL: tables are KBs, locks are milliseconds, and this
-- keeps the file safe under every apply path (psql -f, one-shot runner).
CREATE INDEX IF NOT EXISTS idx_notifications_sent_class_watch_id
  ON public.notifications_sent (class_watch_id);
DROP INDEX IF EXISTS public.idx_class_states_class_nbr;
DROP INDEX IF EXISTS public.idx_class_watches_user_id;
