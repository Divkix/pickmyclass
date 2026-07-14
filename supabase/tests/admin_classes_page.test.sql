BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(8);

INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) VALUES
  (
    '30000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'class-page-one@example.test',
    '',
    '{}'::JSONB,
    '{}'::JSONB,
    NOW(),
    NOW()
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'class-page-two@example.test',
    '',
    '{}'::JSONB,
    '{}'::JSONB,
    NOW(),
    NOW()
  );

INSERT INTO public.class_states (
  id,
  term,
  subject,
  catalog_nbr,
  class_nbr,
  title,
  instructor_name,
  seats_available,
  seats_capacity
) VALUES
  ('31000000-0000-0000-0000-000000000001', '2261', 'CSE', '240', '12345', 'Term one', 'Staff', 0, 30),
  ('31000000-0000-0000-0000-000000000002', '2264', 'CSE', '240', '12345', 'Term two', 'Ada Lovelace', 8, 30),
  ('31000000-0000-0000-0000-000000000003', '2261', 'MAT', '265', '54321', 'Unwatched', 'Staff', 15, 30);

INSERT INTO public.class_watches (
  id,
  user_id,
  term,
  subject,
  catalog_nbr,
  class_nbr
) VALUES
  ('32000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '2261', 'CSE', '240', '12345'),
  ('32000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', '2264', 'CSE', '240', '12345'),
  ('32000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000002', '2264', 'CSE', '240', '12345');

INSERT INTO public.notifications_sent (class_watch_id, notification_type)
VALUES
  ('32000000-0000-0000-0000-000000000001', 'seat_available'),
  ('32000000-0000-0000-0000-000000000002', 'instructor_assigned');

SELECT is(
  (SELECT watcher_count FROM public.get_classes_page(p_search => '12345') WHERE term = '2261'),
  1::BIGINT,
  'watcher counts are scoped to the full section reference for the first term'
);
SELECT is(
  (SELECT watcher_count FROM public.get_classes_page(p_search => '12345') WHERE term = '2264'),
  2::BIGINT,
  'watcher counts are scoped to the full section reference for the second term'
);
SELECT is(
  (SELECT seat_emails FROM public.get_classes_page(p_search => '12345') WHERE term = '2261'),
  1::BIGINT,
  'seat-notification counts stay in their originating term'
);
SELECT is(
  (SELECT instructor_emails FROM public.get_classes_page(p_search => '12345') WHERE term = '2264'),
  1::BIGINT,
  'instructor-notification counts stay in their originating term'
);
SELECT is(
  (SELECT total_count FROM public.get_classes_page(p_search => '12345') LIMIT 1),
  2::BIGINT,
  'the search total includes both matching term-specific sections'
);
SELECT is(
  (
    SELECT term
    FROM public.get_classes_page(p_sort => 'not-a-column', p_dir => 'not-a-direction')
    LIMIT 1
  ),
  '2264',
  'invalid sort input falls back to watcher count descending'
);
SELECT is(
  (
    SELECT class_nbr
    FROM public.get_classes_page(p_subject => 'MAT', p_seat_status => 'available', p_watcher_count => 'none')
    LIMIT 1
  ),
  '54321',
  'subject, seat-status, and watcher-count filters compose correctly'
);
SELECT results_eq(
  $$
    SELECT total_count
    FROM public.get_classes_page(p_page => 2, p_page_size => 1, p_sort => 'class_nbr', p_dir => 'asc')
  $$,
  $$ VALUES (3::BIGINT) $$,
  'pagination returns one row while preserving the full filtered total'
);

SELECT * FROM finish();

ROLLBACK;
