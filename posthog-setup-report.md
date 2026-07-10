# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into PickMyClass. It installed `posthog-js` (client-side) and `posthog-node` (server-side), initialized PostHog via `instrumentation-client.ts` with a reverse proxy, added user identification in `AuthContext`, and instrumented 10 events across 9 files covering the full user lifecycle: registration, login/logout, class watching, unsubscribes, account deletion, and data export.

| Event name | Description | File |
|---|---|---|
| `user_registered` | A new user account was created successfully via email/password registration. | `app/api/auth/register/route.ts` |
| `user_logged_in` | A user authenticated and their session was established client-side. | `lib/contexts/AuthContext.tsx` |
| `user_logged_out` | A user signed out of their account. | `lib/contexts/AuthContext.tsx` |
| `class_watch_added` | A user added a class section to their watchlist from the add-class page. | `app/dashboard/add/page.tsx` |
| `class_watch_removed` | A user removed a class section from their watchlist on the dashboard. | `app/dashboard/page.tsx` |
| `class_watch_created` | A class watch was successfully persisted to the database via the API. | `app/api/class-watches/route.ts` |
| `class_watch_deleted` | A class watch was successfully deleted from the database via the API. | `app/api/class-watches/route.ts` |
| `user_unsubscribed` | A user unsubscribed from all email notifications via an unsubscribe link. | `app/api/unsubscribe/route.ts` |
| `account_deleted` | A user's account was soft-deleted (CCPA compliance, 30-day retention). | `app/api/user/delete/route.ts` |
| `data_exported` | A user exported their personal data as a JSON file from the settings page. | `app/settings/page.tsx` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- [Analytics basics (wizard) — Dashboard](https://us.posthog.com/project/506803/dashboard/1830321)
- [Signup to first class watch funnel (wizard)](https://us.posthog.com/project/506803/insights/DVXgEnBp)
- [New registrations over time (wizard)](https://us.posthog.com/project/506803/insights/kM1V8xwp)
- [Class watches created vs deleted (wizard)](https://us.posthog.com/project/506803/insights/QFx4RTg4)
- [Churn signals: unsubscribes and deletions (wizard)](https://us.posthog.com/project/506803/insights/2PKhvkCb)
- [Weekly active users (wizard)](https://us.posthog.com/project/506803/insights/G4V1cKxT)

## Verify before merging

- [ ] Run a full production build (the wizard only verified the files it touched) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST` to `.env.example` and any onboarding scripts so collaborators know what to set.
- [ ] Wire source-map upload (`posthog-cli sourcemap` or your bundler's upload step) into CI so production stack traces de-minify.
- [ ] Confirm the returning-visitor path also calls `identify` — the `initializeAuth` function in `AuthContext.tsx` calls `posthog.identify` when a user is already logged in on page load, but verify this fires correctly in your local environment.

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.
