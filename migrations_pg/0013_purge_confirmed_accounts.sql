-- Purges an expired account only once its Clerk identity is confirmed gone.
-- 0012 deleted every disabled account past 30 days, but MaintenanceWorkflow
-- deletes Clerk identities in bounded batches (Workflows Free allows 50
-- subrequests per instance), and an account purged outside the batch lost the
-- only row that maps it to its Clerk id while Clerk kept its email, name and
-- credentials. `p_deleted_clerk_ids` holds the ids Clerk confirmed deleted (or
-- already gone); accounts that never had a Clerk identity (legacy ids without
-- a clerk_user_id) have nothing to wait for. The windows are unchanged.
-- The zero-argument version is dropped rather than kept for old Workers: a
-- call from one fails the step, which is safer than purging unconfirmed rows.
DROP FUNCTION public.purge_expired_data();
--> statement-breakpoint
CREATE FUNCTION public.purge_expired_data(
  p_deleted_clerk_ids text[],
  OUT accounts_purged integer, OUT notifications_purged integer, OUT class_states_purged integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.users u
  USING public.user_profiles p
  WHERE p.user_id = u.id
    AND p.is_disabled AND p.disabled_at IS NOT NULL AND p.disabled_at < now() - interval '30 days'
    AND (
      coalesce(u.clerk_user_id, u.id) = ANY (p_deleted_clerk_ids)
      OR (u.clerk_user_id IS NULL AND NOT starts_with(u.id, 'user_'))
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
