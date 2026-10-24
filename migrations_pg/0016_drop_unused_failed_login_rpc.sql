-- Clerk owns authentication; no deployed application path calls this legacy RPC.
-- Remove it before the following generated migration drops its raw-email table.
DROP FUNCTION public.increment_failed_attempts(text, integer, integer);
