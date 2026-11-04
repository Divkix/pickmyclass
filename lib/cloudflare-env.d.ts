/// <reference types="@cloudflare/workers-types" />

/**
 * The Worker's bindings, as declared in alchemy.run.ts. Keep the two in step: a binding added
 * there needs its type here. Secrets are optional under `alchemy dev` (`.env` may omit them).
 */
declare namespace Cloudflare {
  interface Env {
    ASSETS: Fetcher;
    HYPERDRIVE: Hyperdrive;
    EMAIL: SendEmail;
    PICKMYCLASS_QUEUE: Queue;
    CF_VERSION_METADATA: WorkerVersionMetadata;
    SECTION_CHECK_WORKFLOW: Workflow;
    MAINTENANCE_WORKFLOW: Workflow;

    CLERK_PUBLISHABLE_KEY: string;
    MAX_WATCHES_PER_USER: string;
    NOTIFICATION_FROM_EMAIL: string;
    NEXT_PUBLIC_SITE_URL: string;
    OTEL_COLLECTOR_URL: string;

    CRON_SECRET: string;
    UNSUBSCRIBE_SIGNING_SECRET?: string;
    CLERK_SECRET_KEY: string;
    CLERK_JWT_KEY?: string;
    CLERK_WEBHOOK_SIGNING_SECRET: string;
    ASU_API_BASE_URL: string;
    ASU_API_TOKEN: string;
    OTEL_BROWSER_INGEST_KEY?: string;
  }
}

declare namespace NodeJS {
  interface ProcessEnv {
    CLERK_PUBLISHABLE_KEY: string;
    MAX_WATCHES_PER_USER: string;
    NOTIFICATION_FROM_EMAIL: string;
    NEXT_PUBLIC_SITE_URL: string;
    OTEL_COLLECTOR_URL: string;
    CRON_SECRET: string;
    UNSUBSCRIBE_SIGNING_SECRET?: string;
    CLERK_SECRET_KEY: string;
    CLERK_JWT_KEY?: string;
    CLERK_WEBHOOK_SIGNING_SECRET: string;
    ASU_API_BASE_URL: string;
    ASU_API_TOKEN: string;
  }
}
