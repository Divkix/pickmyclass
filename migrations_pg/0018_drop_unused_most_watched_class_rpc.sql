-- Onboarding no longer suggests a popular class, so no application path calls this RPC.
DROP FUNCTION public.get_most_watched_class(text);
