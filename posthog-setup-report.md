# PostHog post-wizard report

The wizard completed a deep integration of PostHog analytics into PickMyClass. It installed `posthog-js` (client-side) and `posthog-node` (server-side), initialized PostHog via `instrumentation-client.ts` with the direct PostHog API host, added user identification in `AuthContext`, and instrumented the full user lifecycle: registration, login/logout, class watching, unsubscribes, account deletion, data export, and onboarding.

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

## Verification

- The browser and server SDKs use the public token and direct API host from `lib/posthog/config.ts`; no build-time environment variables are required.
- The CSP permits browser connections to `https://us.i.posthog.com`.
- Production builds and the full test suite exercise the integration, including returning-user identification.
- Browser smoke testing confirms PostHog assets load and the feature-flags request succeeds against the direct API host.
