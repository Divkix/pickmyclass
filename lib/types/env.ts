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
 * - Durable Objects (PICKMYCLASS_CRON_LOCK_DO)
 * - KV storage (PICKMYCLASS_DISPOSABLE_DOMAINS)
 * - Database access via Hyperdrive (HYPERDRIVE — PlanetScale Postgres)
 * - ASU API credentials
 * - Email/notification settings
 */
/**
 * Cloudflare Workers SendEmail type (from generated types)
 */
export type SendEmail = Cloudflare.Env['EMAIL'];

/**
 * Hyperdrive binding — provides a connectionString that points at the local
 * Hyperdrive proxy inside the Workers runtime. Configured with
 * `--caching-disabled` for correctness-critical read-modify-write paths.
 */
export interface HyperdriveBinding {
  connectionString: string;
}

export interface Env extends Record<string, unknown> {
  // Asset serving
  ASSETS: Fetcher;

  // Cron protection
  CRON_SECRET: string;

  // Queue bindings
  PICKMYCLASS_QUEUE: Queue<ClassCheckMessage>;

  // Durable Object bindings
  PICKMYCLASS_CRON_LOCK_DO: DurableObjectNamespace;

  // KV namespace bindings
  PICKMYCLASS_DISPOSABLE_DOMAINS: KVNamespace;

  // Database access via Cloudflare Hyperdrive (PlanetScale Postgres)
  PICKMYCLASS_HYPERDRIVE: HyperdriveBinding;

  // ASU API credentials
  ASU_API_BASE_URL: string;
  ASU_API_TOKEN: string;

  // Email/notification settings (optional)
  EMAIL: SendEmail;
  NOTIFICATION_FROM_EMAIL?: string;

  // App configuration (optional)
  MAX_WATCHES_PER_USER?: string;
  UNSUBSCRIBE_SIGNING_SECRET?: string;

  // Deploy version metadata (from wrangler version_metadata binding).
  // Used in the edge HTML cache key so each deploy busts cached pages.
  CF_VERSION_METADATA?: { id: string; tag: string; timestamp: string };
}

/**
 * Cloudflare Workers Fetcher type (for asset serving)
 */
interface Fetcher {
  fetch(request: Request): Promise<Response>;
}
