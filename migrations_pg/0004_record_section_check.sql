-- Commit observation, dedup resets and durable notification intent together.
-- The existing SectionRef advisory lock also serializes concurrent observations.
CREATE FUNCTION public.record_section_check(
  p_class_nbr text, p_term text, p_details jsonb, p_observed_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old public.class_states%ROWTYPE;
  v_exists boolean;
  v_seats integer := COALESCE((p_details->>'non_reserved_seats')::integer, (p_details->>'seats_available')::integer, 0);
  v_old_seats integer;
  v_seat_available boolean;
  v_instructor_assigned boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_class_nbr || '|' || p_term));

  -- A prior intent must finish before another observation can replace it.
  IF EXISTS (SELECT 1 FROM public.pending_section_notifications WHERE class_nbr = p_class_nbr AND term = p_term) THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_old FROM public.class_states WHERE class_nbr = p_class_nbr AND term = p_term;
  v_exists := FOUND;
  v_old_seats := COALESCE(v_old.non_reserved_seats, v_old.seats_available, 0);

  IF NOT public.upsert_class_state_locked(
    p_class_nbr, p_term, p_details->>'subject', p_details->>'catalog_nbr', p_details->>'title',
    p_details->>'instructor_name', (p_details->>'seats_available')::integer,
    (p_details->>'seats_capacity')::integer, (p_details->>'non_reserved_seats')::integer,
    p_details->>'location', p_details->>'meeting_times', p_observed_at
  ) THEN RETURN FALSE; END IF;

  IF v_exists AND v_old_seats > 0 AND v_seats = 0 THEN
    PERFORM public.reset_section_notifications(p_class_nbr, p_term, 'seat_available');
  END IF;
  IF v_exists AND COALESCE(v_old.instructor_name, 'Staff') <> 'Staff' AND p_details->>'instructor_name' = 'Staff' THEN
    PERFORM public.reset_section_notifications(p_class_nbr, p_term, 'instructor_assigned');
  END IF;

  v_seat_available := v_exists AND v_old_seats = 0 AND v_seats > 0;
  v_instructor_assigned := v_exists AND COALESCE(v_old.instructor_name, 'Staff') = 'Staff'
    AND COALESCE(p_details->>'instructor_name', 'Staff') <> 'Staff';

  IF v_seat_available OR v_instructor_assigned THEN
    INSERT INTO public.pending_section_notifications (class_nbr, term, class_info, changes)
    VALUES (p_class_nbr, p_term,
      p_details || jsonb_build_object('class_nbr', p_class_nbr, 'term', p_term),
      jsonb_build_object('seatBecameAvailable', v_seat_available, 'seatsFilled', false,
        'instructorAssigned', v_instructor_assigned, 'newOpenSeats', v_seats));
  END IF;
  RETURN TRUE;
END;
$$;
