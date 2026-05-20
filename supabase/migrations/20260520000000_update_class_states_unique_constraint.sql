ALTER TABLE public.class_states DROP CONSTRAINT IF EXISTS class_states_class_nbr_key;
ALTER TABLE public.class_states ADD CONSTRAINT unique_class_nbr_term UNIQUE (class_nbr, term);

-- Update comments
COMMENT ON COLUMN public.class_states.class_nbr IS 'ASU section number (5 digits)';
COMMENT ON TABLE public.class_states IS 'Caches current state of monitored classes from ASU API (unique per class_nbr and term)';
