# Onboarding flow for first-time users

New users frequently sign up for PickMyClass but do not understand how to extract a class ID from the ASU catalog and create a watch. The core value of the app is receiving an email notification when a watched section opens or gets an instructor, so the first-run experience must teach the class-ID-to-watch workflow as quickly as possible.

## Context

- The app has no class search. Users must find the 5-digit `class_nbr` on `catalog.apps.asu.edu` and paste it into the dashboard.
- The dashboard is only reachable after email verification, so onboarding can assume the user has a verified email address.
- The existing `class_watches` table already tracks which sections are popular. We can reuse that as a social-proof shortcut.
- `MAX_WATCHES_PER_USER` (default 10) is enforced atomically by the `create_class_watch_with_limit` RPC, so onboarding should reuse that same path.

## Decision

Add a **first-time onboarding flow** that is shown once, after email verification, on the first dashboard visit.

### Trigger and lifecycle

- The flow is shown only when `user_profiles.onboarding_completed_at` and `onboarding_skipped_at` are both `NULL`.
- Existing users are treated as complete by default (both columns already `NULL` but they will never see the modal because we backfill `onboarding_completed_at` for existing accounts, or equivalently only show the flow to users whose account was created after this feature is enabled).
- Creating the **first watch anywhere** in the app sets `onboarding_completed_at` and hides the onboarding UI.

### Presentation

- A **centered full-screen modal** is rendered over the dashboard. The user cannot interact with the dashboard until they complete the flow or explicitly skip it.
- Escape, backdrop click, and an explicit **"Skip for now"** button all set `onboarding_skipped_at` and close the modal.
- After skipping, a compact **"Finish setup"** card appears on the dashboard until the user adds their first watch.

### Steps

The modal is a 3-step linear checklist:

1. **Find a class ID** — Shows a **popular class example** in the current selectable term, consisting of the class number and a **"Track this class"** button. A secondary link opens `catalog.apps.asu.edu` in a new tab so the user can also find their own class. The example is sourced from a new `get_most_watched_class` RPC that returns the most-watched `(class_nbr, term)` for the current selectable term, then validated against the ASU API when the modal loads. If the source fails or returns nothing valid, the example is hidden and the step falls back to a text-only guide with the ASU catalog link.
2. **Add the watch** — A simplified form with only `class_nbr` and `term`. Clicking **"Track this class"** from step 1 copies the example class number into the form. The form uses the same `create_class_watch_with_limit` RPC as the dashboard, so all validation and limits are identical. Onboarding is marked complete only when the watch is created successfully.
3. **You're all set** — A confirmation step explaining that the user will receive an email when a seat opens or an instructor is assigned. The modal closes on the user's next click.

### Analytics

Track the following PostHog events:

- `onboarding_started` — when the modal first renders.
- `onboarding_completed` — when a watch is created and the flow ends.
- `onboarding_skipped` — when the user dismisses via Escape, backdrop, or the skip button.

## Consequences

- Two new columns are required on `user_profiles`: `onboarding_completed_at timestamptz` and `onboarding_skipped_at timestamptz`.
- A new Supabase RPC, `get_most_watched_class`, is required for the popular-class example. It must be a `SECURITY DEFINER` function restricted to `service_role`.
- The modal introduces a runtime dependency on the ASU API when it loads the example class. A loading state and a clean fallback are mandatory.
- The dashboard must read the onboarding state and decide whether to render the modal, the finish-setup card, or nothing.
- The popular-class example is keyed on `(class_nbr, term)` (SectionRef), not `class_nbr` alone, to avoid presenting a class from the wrong term.
- Skipping is final but the dashboard card remains until the first watch is created, so the user always has a path back into the funnel.
