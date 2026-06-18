-- Backfill missing user_profiles rows.
--
-- Accounts created before the on_auth_user_created trigger existed (or for
-- which it failed) have no user_profiles row. Queries using .single() then
-- return HTTP 406, and authorization lookups treat the user as profile-less.
-- Create a default row for every auth user that lacks one.

INSERT INTO public.user_profiles (user_id)
SELECT u.id
FROM auth.users u
LEFT JOIN public.user_profiles up ON up.user_id = u.id
WHERE up.user_id IS NULL
ON CONFLICT (user_id) DO NOTHING;
