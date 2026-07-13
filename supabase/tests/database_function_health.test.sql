BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(6);

INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) VALUES (
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'database-functions@example.test',
  '',
  NOW(),
  '{}'::JSONB,
  '{}'::JSONB,
  NOW(),
  NOW()
);

SELECT set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  TRUE
);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  'SELECT * FROM public.skip_onboarding()',
  'skip_onboarding executes without output-column ambiguity'
);
RESET ROLE;

SELECT ok(
  (
    SELECT onboarding_skipped_at IS NOT NULL
    FROM public.user_profiles
    WHERE user_id = '10000000-0000-0000-0000-000000000001'
  ),
  'skip_onboarding persists the skipped timestamp'
);

INSERT INTO public.class_watches (
  id,
  user_id,
  term,
  subject,
  catalog_nbr,
  class_nbr
) VALUES (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '2261',
  'CSE',
  '240',
  '12345'
);

SELECT is(
  public.try_record_notifications_batch(
    ARRAY['20000000-0000-0000-0000-000000000001'::UUID],
    'seat_available'
  ),
  ARRAY['20000000-0000-0000-0000-000000000001'::UUID],
  'the first batch call claims the watch'
);
SELECT is(
  public.try_record_notifications_batch(
    ARRAY['20000000-0000-0000-0000-000000000001'::UUID],
    'seat_available'
  ),
  ARRAY[]::UUID[],
  'an active claim suppresses a duplicate'
);

UPDATE public.notifications_sent
SET is_active = FALSE
WHERE class_watch_id = '20000000-0000-0000-0000-000000000001'
  AND notification_type = 'seat_available';

SELECT is(
  public.try_record_notifications_batch(
    ARRAY['20000000-0000-0000-0000-000000000001'::UUID],
    'seat_available'
  ),
  ARRAY['20000000-0000-0000-0000-000000000001'::UUID],
  'an inactive claim can be claimed again even before its expires_at timestamp'
);
SELECT is(
  (
    SELECT COUNT(*)::INTEGER
    FROM public.notifications_sent
    WHERE class_watch_id = '20000000-0000-0000-0000-000000000001'
      AND notification_type = 'seat_available'
      AND is_active = TRUE
  ),
  1,
  'exactly one active claim remains'
);

SELECT * FROM finish();

ROLLBACK;
