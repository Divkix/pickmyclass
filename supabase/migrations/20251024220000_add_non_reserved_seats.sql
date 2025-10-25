-- Add non_reserved_seats column to class_states table
-- This tracks truly available (non-reserved) seats from ASU's reservation system
-- NULL indicates the value couldn't be determined (scraper failure or no data)

ALTER TABLE public.class_states
  ADD COLUMN non_reserved_seats INTEGER DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.class_states.non_reserved_seats IS
  'Number of non-reserved seats available (not restricted by major/honors/etc). NULL if unknown or unavailable.';

-- Add index for querying by non-reserved availability
CREATE INDEX IF NOT EXISTS idx_class_states_non_reserved
  ON public.class_states(non_reserved_seats)
  WHERE non_reserved_seats IS NOT NULL;
