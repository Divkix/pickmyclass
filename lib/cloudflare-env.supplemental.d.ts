/**
 * Supplemental Cloudflare env types for runtime secrets.
 * Extends the auto-generated types in cloudflare-env.d.ts.
 */
declare namespace Cloudflare {
  interface Env {
    CRON_SECRET: string;
    UNSUBSCRIBE_SIGNING_SECRET?: string;
    SUPABASE_SEND_EMAIL_HOOK_SECRET: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
    ASU_API_BASE_URL: string;
    ASU_API_TOKEN: string;
  }
}

declare namespace NodeJS {
  interface ProcessEnv {
    CRON_SECRET: string;
    UNSUBSCRIBE_SIGNING_SECRET?: string;
    SUPABASE_SEND_EMAIL_HOOK_SECRET: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
    ASU_API_BASE_URL: string;
    ASU_API_TOKEN: string;
  }
}
