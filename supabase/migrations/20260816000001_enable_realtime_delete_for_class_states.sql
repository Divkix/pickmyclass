-- Enable Realtime DELETE payloads for class_states
-- Supabase Realtime only delivers payload.old for DELETE when the table has
-- REPLICA IDENTITY FULL; without it payload.old is empty and clients cannot
-- evict the deleted row from local state.
alter table public.class_states replica identity full;

comment on table public.class_states is
  'Watched class state per SectionRef (class_nbr, term); REPLICA IDENTITY FULL enables Realtime DELETE payloads with old row';
