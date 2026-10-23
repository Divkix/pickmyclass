import type { ClassCheckMessage } from "./queue";

export type SendEmail = Cloudflare.Env["EMAIL"];

export interface Env extends Record<string, unknown> {
  ASSETS: Fetcher;

  PICKMYCLASS_QUEUE: Queue<ClassCheckMessage>;

  HYPERDRIVE: Hyperdrive;

  ASU_API_BASE_URL: string;
  ASU_API_TOKEN: string;

  EMAIL: SendEmail;
  NOTIFICATION_FROM_EMAIL?: string;

  /** Browser telemetry collector; `/otel` drops batches while either is unset. */
  OTEL_COLLECTOR_URL?: string;
  OTEL_BROWSER_INGEST_KEY?: string;

  CF_VERSION_METADATA?: { id: string; tag: string; timestamp: string };
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}
