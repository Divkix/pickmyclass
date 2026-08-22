-- Make incrementConsecutiveNotFound atomic via RPC
-- Prevents lost increments under concurrent workers (read-modify-write race)
-- Used by lib/db/queries.ts incrementConsecutiveNotFound

create or replace function public.increment_consecutive_not_found(p_class_nbr text, p_term text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count int;
begin
  update public.class_states
    set consecutive_not_found_count = coalesce(consecutive_not_found_count, 0) + 1
    where class_nbr = p_class_nbr and term = p_term
    returning consecutive_not_found_count into new_count;

  if not found then
    raise exception 'Section not found';
  end if;

  return new_count;
end;
$$;

comment on function public.increment_consecutive_not_found(text, text) is
  'Atomically increments consecutive_not_found_count for a SectionRef; returns new count, raises if section not found';

revoke all on function public.increment_consecutive_not_found(text, text) from public;
revoke all on function public.increment_consecutive_not_found(text, text) from authenticated;
grant execute on function public.increment_consecutive_not_found(text, text) to service_role;
