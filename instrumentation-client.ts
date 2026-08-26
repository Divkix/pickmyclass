import 'posthog-js/dist/exception-autocapture';
import posthog from 'posthog-js/dist/module.no-external';
import { POSTHOG_API_HOST, POSTHOG_PROJECT_TOKEN, POSTHOG_UI_HOST } from '@/lib/analytics/config';

posthog.init(POSTHOG_PROJECT_TOKEN, {
  api_host: POSTHOG_API_HOST,
  ui_host: POSTHOG_UI_HOST,
  defaults: '2026-05-30',
  capture_exceptions: true,
  debug: process.env.NODE_ENV === 'development',
});
