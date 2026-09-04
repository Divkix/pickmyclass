declare namespace Cloudflare {
  interface Env {
    CRON_SECRET: string;
    UNSUBSCRIBE_SIGNING_SECRET?: string;
    CLERK_SECRET_KEY: string;
    CLERK_PUBLISHABLE_KEY: string;
    CLERK_JWT_KEY?: string;
    CLERK_WEBHOOK_SIGNING_SECRET: string;
    ASU_API_BASE_URL: string;
    ASU_API_TOKEN: string;
  }
}

declare namespace NodeJS {
  interface ProcessEnv {
    CRON_SECRET: string;
    UNSUBSCRIBE_SIGNING_SECRET?: string;
    CLERK_SECRET_KEY: string;
    CLERK_PUBLISHABLE_KEY: string;
    CLERK_JWT_KEY?: string;
    CLERK_WEBHOOK_SIGNING_SECRET: string;
    ASU_API_BASE_URL: string;
    ASU_API_TOKEN: string;
  }
}
