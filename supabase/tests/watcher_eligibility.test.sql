BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(11);

SELECT ok(
  private.is_watcher_eligible(NULL, NULL, NULL, NULL, NULL),
  'a missing profile keeps the existing eligible-by-default behavior'
);
SELECT ok(
  private.is_watcher_eligible(TRUE, FALSE, FALSE, FALSE, NULL),
  'an active profile is eligible'
);
SELECT isnt(
  private.is_watcher_eligible(FALSE, FALSE, FALSE, FALSE, NULL),
  TRUE,
  'disabled notifications make a watcher ineligible'
);
SELECT isnt(
  private.is_watcher_eligible(TRUE, TRUE, FALSE, FALSE, NULL),
  TRUE,
  'a bounced email makes a watcher ineligible'
);
SELECT isnt(
  private.is_watcher_eligible(TRUE, FALSE, TRUE, FALSE, NULL),
  TRUE,
  'a spam complaint makes a watcher ineligible'
);
SELECT isnt(
  private.is_watcher_eligible(TRUE, FALSE, FALSE, TRUE, NULL),
  TRUE,
  'a disabled account makes a watcher ineligible'
);
SELECT isnt(
  private.is_watcher_eligible(TRUE, FALSE, FALSE, FALSE, NOW()),
  TRUE,
  'engagement disablement makes a watcher ineligible'
);

SELECT ok(
  pg_get_functiondef('public.get_sections_to_check(text)'::regprocedure)
    LIKE '%private.is_watcher_eligible%',
  'section enumeration consumes the shared eligibility policy'
);
SELECT ok(
  pg_get_functiondef('public.get_watchers_for_sections(text[],text)'::regprocedure)
    LIKE '%private.is_watcher_eligible%',
  'notification recipient selection consumes the shared eligibility policy'
);
SELECT ok(
  pg_get_functiondef('public.get_class_watchers(text,text)'::regprocedure)
    LIKE '%private.is_watcher_eligible%',
  'watcher counts consume the shared eligibility policy'
);
SELECT ok(
  pg_get_functiondef('public.get_most_watched_class(text)'::regprocedure)
    LIKE '%private.is_watcher_eligible%',
  'popularity queries consume the shared eligibility policy'
);

SELECT * FROM finish();

ROLLBACK;
