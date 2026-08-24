/**
 * Central application constants.
 *
 * Values are sourced from environment / wrangler vars where the runtime provides them;
 * here they are declared as named constants for use throughout the codebase.
 */

export const NOTIFICATION_FROM_EMAIL = 'notifications@pickmyclass.app';
export const ALERTS_FROM_EMAIL = 'alerts@pickmyclass.app';
export const DEFAULT_SITE_URL = 'https://pickmyclass.app';

/** ASU API response cache TTL: 2 minutes */
export const ASU_CACHE_TTL_MS = 2 * 60 * 1000;

/** Admin query cache TTL: 10 minutes */
export const ADMIN_CACHE_TTL_MS = 600_000;

/** Unsubscribe token validity window in days. Must be 90 to preserve backward compatibility. */
export const UNSUBSCRIBE_TOKEN_EXPIRY_DAYS = 90;

/**
 * Edge HTML cache TTL (seconds) for anonymous marketing pages cached in
 * worker.ts via the Cache API. The deploy version id in the cache key is the
 * real busting mechanism; this TTL just bounds staleness within a deploy.
 */
export const EDGE_HTML_CACHE_TTL_S = 3600;

/** Max emails sent per batch */
export const EMAIL_BATCH_SIZE = 10;

/** Delay between email batches in milliseconds */
export const EMAIL_BATCH_DELAY_MS = 75;
/** Auto-cleanup: consecutive NotFound threshold before deleting a section (3 strikes) */
export const AUTO_CLEANUP_THRESHOLD = 3;

/** Auto-cleanup circuit-breaker: max ratio of flagged/total class_states before suppression (20%) */
export const AUTO_CLEANUP_BREAKER_RATIO = 0.2;

/**
 * Auto-cleanup: max emails sent per cycle per SectionRef deletion.
 * Caps blast radius if breaker is just under threshold (19% flagged): without this
 * cap a single popular section with 10k watchers could burst-email all at once;
 * with cap, at most 500 per cycle. Truncation keeps first 500 entries.
 */
export const AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE = 500;
