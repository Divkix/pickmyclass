import posthog from 'posthog-js';
import {
  POSTHOG_BROWSER_API_HOST,
  POSTHOG_PROJECT_TOKEN,
  POSTHOG_UI_HOST,
} from '@/lib/posthog/config';

posthog.init(POSTHOG_PROJECT_TOKEN, {
  api_host: POSTHOG_BROWSER_API_HOST,
  ui_host: POSTHOG_UI_HOST,
  defaults: '2026-01-30',
  capture_exceptions: true,
  debug: process.env.NODE_ENV === 'development',
});
