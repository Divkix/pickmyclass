-- Add consecutive NotFound counter for auto-cleanup (3 strikes -> delete)
-- SectionRef-scoped (class_nbr, term) — matches class_states PK
-- Used by processSection to track consecutive NotFoundError occurrences
-- 5xx/timeout does NOT increment, success resets to 0

alter table public.class_states
  add column if not exists consecutive_not_found_count integer not null default 0;

comment on column public.class_states.consecutive_not_found_count is
  'Consecutive NotFoundError count for SectionRef; increments on NotFound, resets to 0 on success, triggers auto-delete at >=3';

-- Backfill existing rows (DEFAULT 0 handles it, explicit for clarity)
update public.class_states
  set consecutive_not_found_count = 0
  where consecutive_not_found_count is null;
