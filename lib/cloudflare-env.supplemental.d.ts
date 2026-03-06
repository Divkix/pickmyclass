/**
 * Supplemental Cloudflare env types for runtime secrets.
 * Extends the auto-generated types in cloudflare-env.d.ts.
 */
declare namespace Cloudflare {
  interface Env {
    CRON_SECRET: string;
    RESEND_WEBHOOK_SECRET: string;
    UNSUBSCRIBE_SIGNING_SECRET?: string;
    ASU_API_BASE_URL: string;
    ASU_API_TOKEN: string;
    PICKMYCLASS_DISPOSABLE_DOMAINS: KVNamespace;
  }
}

declare namespace NodeJS {
  interface ProcessEnv {
    CRON_SECRET: string;
    RESEND_WEBHOOK_SECRET: string;
    UNSUBSCRIBE_SIGNING_SECRET?: string;
    ASU_API_BASE_URL: string;
    ASU_API_TOKEN: string;
  }
}
