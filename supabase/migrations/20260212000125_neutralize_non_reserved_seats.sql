-- Phase 0c: Neutralize non_reserved_seats transition
--
-- The ASU API does not return non_reserved_seats. Setting all existing values
-- to NULL prevents false "seat available" notifications on the first cron run
-- after migration. Without this, sections where the scraper stored
-- non_reserved_seats = 0 and seats_available > 0 would trigger false emails
-- because getOpenSeats(null, 5) returns 5 while getOpenSeats(0, 5) returns 0.

UPDATE public.class_states SET non_reserved_seats = NULL;
