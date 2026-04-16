/**
 * Consolidated Cloudflare Workers environment bindings.
 *
 * Single source of truth for Env interface used across worker.ts,
 * queue processing, and API routes.
 */

import type { ClassCheckMessage } from './queue';

/**
 * Cloudflare Workers environment bindings.
 *
 * Includes all bindings needed for:
 * - Asset serving (ASSETS)
 * - Queue processing (PICKMYCLASS_QUEUE)
 * - Durable Objects (CIRCUIT_BREAKER_DO, PICKMYCLASS_CRON_LOCK_DO)
 * - KV storage (PICKMYCLASS_DISPOSABLE_DOMAINS)
 * - Supabase configuration
 * - ASU API credentials
 * - Email/notification settings
 */
export interface Env extends Record<string, unknown> {
  // Asset serving
  ASSETS: Fetcher;

  // Cron protection
  CRON_SECRET: string;

  // Queue bindings
  PICKMYCLASS_QUEUE: Queue<ClassCheckMessage>;

  // Durable Object bindings
  CIRCUIT_BREAKER_DO: DurableObjectNamespace;
  PICKMYCLASS_CRON_LOCK_DO: DurableObjectNamespace;

  // KV namespace bindings
  PICKMYCLASS_DISPOSABLE_DOMAINS: KVNamespace;

  // Supabase configuration
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;

  // ASU API credentials
  ASU_API_BASE_URL: string;
  ASU_API_TOKEN: string;

  // Email/notification settings (optional)
  RESEND_API_KEY?: string;
  NOTIFICATION_FROM_EMAIL?: string;

  // App configuration (optional)
  MAX_WATCHES_PER_USER?: string;
  UNSUBSCRIBE_SIGNING_SECRET?: string;
}

/**
 * Cloudflare Workers Fetcher type (for asset serving)
 */
export interface Fetcher {
  fetch(request: Request): Promise<Response>;
}
