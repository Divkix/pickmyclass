export const NOTIFICATION_FROM_EMAIL = "notifications@pickmyclass.app";

export const DEFAULT_SITE_URL = "https://pickmyclass.app";

export const ASU_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Longest a single statement may take before the Worker stops waiting. Shorter
 * than a Workflow step's 2-minute timeout so the step's own retry still runs.
 */
export const DB_QUERY_TIMEOUT_MS = 15_000;

/** Longest one Clerk Backend API call may take before the request stops waiting. */
export const CLERK_REQUEST_TIMEOUT_MS = 8_000;

/**
 * Expired accounts whose Clerk identity one Maintenance run deletes. Each delete
 * is a subrequest and Workflows Free allows 50 per instance, so the purge keeps
 * up through hourly runs (600 accounts a day) instead of one large run.
 */
export const CLERK_PURGE_BATCH_SIZE = 25;

/**
 * Active sessions one sign-out-everywhere revokes. Each revoke is a subrequest and Workers
 * Free allows 50 per invocation; the recheck reports any session left past this page.
 */
export const CLERK_SESSION_REVOKE_LIMIT = 40;

/** Cache API reads and writes are local to the colo; a slow one is skipped, not waited for. */
export const EDGE_CACHE_TIMEOUT_MS = 3_000;

export const COLLECTOR_TIMEOUT_MS = 10_000;

export const ASSETS_FETCH_TIMEOUT_MS = 10_000;

/** One IndexNow deploy-script request, body included. */
export const INDEXNOW_TIMEOUT_MS = 15_000;

export const ASU_CACHE_TTL_MS = 2 * 60 * 1000;

export const ADMIN_CACHE_TTL_MS = 600_000;

export const UNSUBSCRIBE_TOKEN_EXPIRY_DAYS = 90;

export const EDGE_HTML_CACHE_TTL_S = 3600;

/** Longest one Queue `sendBatch` may take; a Workflow step's retry covers a miss. */
export const QUEUE_SEND_TIMEOUT_MS = 10_000;

export const EMAIL_BATCH_SIZE = 10;

export const EMAIL_BATCH_DELAY_MS = 75;

/**
 * Longest one `send_email` call may take. A timeout leaves delivery unknown, so
 * the claim stays in flight instead of being released.
 */
export const EMAIL_SEND_TIMEOUT_MS = 10_000;

// Longer than the queue consumer's wall-time budget; a crashed owner can be replaced.
export const NOTIFICATION_LEASE_SECONDS = 960;

export const AUTO_CLEANUP_THRESHOLD = 3;

export const AUTO_CLEANUP_BREAKER_RATIO = 0.2;

// 25 sequential 10s sends + two 75ms pauses = 250.15s, below the 15-minute
// Queue wall limit. Five messages/batch use at most 125 removal-email subrequests,
// leaving ample room under the 1,000 Cloudflare-service subrequest limit for DB I/O.
export const AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE = 25;

/** Queue retry delay after an ASU 429: doubles per attempt from the base, capped. */
export const RATE_LIMIT_RETRY_BASE_S = 60;

export const RATE_LIMIT_RETRY_MAX_S = 15 * 60;

/** Must match `max_retries` on the queue consumer in wrangler.jsonc. */
export const QUEUE_MAX_RETRIES = 3;

/** localStorage key holding the last Clerk session id that recorded `user_logged_in`. */
export const LOGIN_SESSION_STORAGE_KEY = "pmc_logged_in_session";
