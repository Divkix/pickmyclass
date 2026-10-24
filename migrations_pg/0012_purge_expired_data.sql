-- Enforces the retention windows the privacy policy (section 6) promises, which
-- nothing ran until now: disabled accounts after 30 days, notification records
-- after 1 year, and class state for sections nobody watches after 6 months.
-- Deleting the `users` row cascades to user_profiles, class_watches and (through
-- the watches) notifications_sent. MaintenanceWorkflow calls this daily.
CREATE FUNCTION public.purge_expired_data(
  OUT accounts_purged integer, OUT notifications_purged integer, OUT class_states_purged integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.users
  WHERE id IN (
    SELECT user_id FROM public.user_profiles
    WHERE is_disabled AND disabled_at IS NOT NULL AND disabled_at < now() - interval '30 days'
  );
  GET DIAGNOSTICS accounts_purged = ROW_COUNT;

  DELETE FROM public.notifications_sent WHERE sent_at < now() - interval '1 year';
  GET DIAGNOSTICS notifications_purged = ROW_COUNT;

  -- Pending notification intents reference class_states and cascade with it.
  DELETE FROM public.class_states cs
  WHERE cs.last_checked_at < now() - interval '6 months'
    AND NOT EXISTS (
      SELECT 1 FROM public.class_watches cw WHERE cw.class_nbr = cs.class_nbr AND cw.term = cs.term
    );
  GET DIAGNOSTICS class_states_purged = ROW_COUNT;
END;
$$;
