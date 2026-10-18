-- Every live Worker calls record_section_observation (0010); nothing calls this wrapper.
DROP FUNCTION IF EXISTS public.record_section_check(text, text, jsonb, timestamptz);
