export const NOTIFICATION_FROM_EMAIL = 'notifications@pickmyclass.app';

export const DEFAULT_SITE_URL = 'https://pickmyclass.app';

export const ASU_CACHE_TTL_MS = 2 * 60 * 1000;

export const ADMIN_CACHE_TTL_MS = 600_000;

export const UNSUBSCRIBE_TOKEN_EXPIRY_DAYS = 90;

export const EDGE_HTML_CACHE_TTL_S = 3600;

export const EMAIL_BATCH_SIZE = 10;

export const EMAIL_BATCH_DELAY_MS = 75;

export const AUTO_CLEANUP_THRESHOLD = 3;

export const AUTO_CLEANUP_BREAKER_RATIO = 0.2;

export const AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE = 500;

/** Queue retry delay after an ASU 429: doubles per attempt from the base, capped. */
export const RATE_LIMIT_RETRY_BASE_S = 60;

export const RATE_LIMIT_RETRY_MAX_S = 15 * 60;
