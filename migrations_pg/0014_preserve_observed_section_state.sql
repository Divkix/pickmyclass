-- Keep the existing signature for the Worker serving during migration/deploy.
CREATE OR REPLACE FUNCTION public.record_section_observation(
  p_class_nbr text, p_term text, p_details jsonb, p_observed_at timestamptz,
  OUT applied boolean, OUT intent_created boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old public.class_states%ROWTYPE;
  v_exists boolean;
  v_seats integer := COALESCE((p_details->>'non_reserved_seats')::integer, (p_details->>'seats_available')::integer, 0);
  v_old_seats integer;
  v_seat_available boolean;
  v_instructor_assigned boolean;
BEGIN
  applied := FALSE;
  intent_created := FALSE;
  PERFORM pg_advisory_xact_lock(hashtext(p_class_nbr || '|' || p_term));

  -- A prior intent must finish before another observation can replace it.
  IF EXISTS (SELECT 1 FROM public.pending_section_notifications WHERE class_nbr = p_class_nbr AND term = p_term) THEN
    RETURN;
  END IF;

  SELECT * INTO v_old FROM public.class_states WHERE class_nbr = p_class_nbr AND term = p_term;
  -- NotFound placeholders omit title; successful ASU observations always supply
  -- one (the ASU mapper falls back to 'Unknown' when the upstream title is absent).
  v_exists := FOUND AND v_old.title IS NOT NULL;
  v_old_seats := COALESCE(v_old.non_reserved_seats, v_old.seats_available, 0);

  IF NOT public.upsert_class_state_locked(
    p_class_nbr, p_term, p_details->>'subject', p_details->>'catalog_nbr', p_details->>'title',
    p_details->>'instructor_name', (p_details->>'seats_available')::integer,
    (p_details->>'seats_capacity')::integer, (p_details->>'non_reserved_seats')::integer,
    p_details->>'location', p_details->>'meeting_times', p_observed_at
  ) THEN RETURN; END IF;
  applied := TRUE;

  -- Missing dates mean unknown, not a revocation of the known alert cutoff.
  -- Skips the extra row version when the dates are unchanged (the common case).
  UPDATE public.class_states SET start_date = COALESCE((p_details->>'start_date')::date, start_date),
    end_date = COALESCE((p_details->>'end_date')::date, end_date), session_code = p_details->>'session_code'
  WHERE class_nbr = p_class_nbr AND term = p_term
    AND (start_date, end_date, session_code) IS DISTINCT FROM
      (COALESCE((p_details->>'start_date')::date, start_date),
       COALESCE((p_details->>'end_date')::date, end_date), p_details->>'session_code');

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
    intent_created := TRUE;
  END IF;
END;
$$;
