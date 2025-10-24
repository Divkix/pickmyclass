/**
 * Sentry Edge Configuration
 *
 * This configuration is used to initialize Sentry on Cloudflare Workers (edge runtime).
 * It tracks errors in edge functions and middleware.
 */

import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Set environment based on NODE_ENV
  environment: process.env.NODE_ENV || 'development',

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  // Don't send errors if DSN is not configured
  enabled: !!process.env.SENTRY_DSN,
})
