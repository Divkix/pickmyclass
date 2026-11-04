// The whole Cloudflare setup. `pnpm run deploy` runs `alchemy deploy --stage prod` (it builds the
// Vite app too); `pnpm dev` runs `alchemy dev`, which serves the same Worker locally from Vite.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { QUEUE_MAX_RETRIES } from "./lib/config";

// Every name below is the live production name, so prod is the only deployable stage.
const STAGE = "prod";

const QUEUE = "pickmyclass-queue";

const VARS = {
  // Public: `clerkMiddleware` sends it to the browser in each page's Clerk init state.
  CLERK_PUBLISHABLE_KEY: "pk_live_Y2xlcmsucGlja215Y2xhc3MuYXBwJA",
  // Public limit: lib/faqs.ts, app/routes/faq.tsx, app/routes/docs.tsx, public/pricing.md and lib/seo/llms*.ts state up to 10 classes at a time.
  MAX_WATCHES_PER_USER: "10",
  NOTIFICATION_FROM_EMAIL: "notifications@pickmyclass.app",
  NEXT_PUBLIC_SITE_URL: "https://pickmyclass.app",
  OTEL_COLLECTOR_URL: "https://observe.divkix.me/api/default",
};

// Production values live on the Worker (dashboard or Cloudflare API): Alchemy never deletes a
// secret it did not upload. Under `alchemy dev` they come from `.env`, each one optional.
const SECRETS = [
  "ASU_API_BASE_URL",
  "ASU_API_TOKEN",
  "CLERK_JWT_KEY",
  "CLERK_SECRET_KEY",
  "CLERK_WEBHOOK_SIGNING_SECRET",
  "CRON_SECRET",
  "OTEL_BROWSER_INGEST_KEY",
  "UNSUBSCRIBE_SIGNING_SECRET",
] as const;

// `.env` overrides any var (e.g. a Clerk test key, a localhost site URL) and supplies secrets.
const devEnv = Effect.gen(function* () {
  const env: Record<string, string | Redacted.Redacted<string>> = {};

  for (const [key, value] of Object.entries(VARS)) {
    env[key] = yield* Config.String(key).pipe(Config.withDefault(value));
  }

  for (const key of SECRETS) {
    const value = yield* Config.option(Config.Redacted(key));

    if (Option.isSome(value)) env[key] = value.value;
  }

  return env;
});

// Local Postgres behind the emulated Hyperdrive binding.
const devDatabase = Effect.gen(function* () {
  const url = new URL(
    yield* Config.String("LOCAL_DATABASE_URL").pipe(
      Config.withDefault("postgresql://postgres:postgres@localhost:5432/postgres"),
    ),
  );

  return {
    scheme: "postgres" as const,
    host: url.hostname,
    port: Number(url.port || 5432),
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    password: Redacted.make(decodeURIComponent(url.password)),
    sslmode: "disable" as const,
  };
});

export default Alchemy.Stack(
  "pickmyclass",
  // Deploys keep state in this account's Alchemy state store (`alchemy state bootstrap`), shared by
  // laptop and CI. Losing it is recoverable with `alchemy deploy --stage prod --adopt`, since every
  // resource below has a fixed name. `alchemy dev` keeps its own state in .alchemy/.
  {
    providers: Cloudflare.providers(),
    state: process.env.ALCHEMY_DEV === "true" ? Alchemy.localState() : Cloudflare.state(),
  },
  Effect.gen(function* () {
    const dev = yield* Alchemy.ALCHEMY_DEV;

    if (!dev && (yield* Alchemy.Stage) !== STAGE) {
      return yield* Effect.die(new Error(`Only --stage ${STAGE} is supported.`));
    }

    // `alchemy destroy` and refactors forget resources instead of deleting them.
    const keep = Alchemy.RemovalPolicy.retain(true);

    const queue = yield* Cloudflare.Queues.Queue("Queue", { name: QUEUE }).pipe(keep);

    // No consumer on the DLQ: exhausted messages stay there to inspect or redrive from the
    // dashboard (24h retention on Workers Free).
    const deadLetterQueue = yield* Cloudflare.Queues.Queue("DeadLetterQueue", {
      name: "pickmyclass-dlq",
    }).pipe(keep);

    const worker = yield* Cloudflare.Website.Vite("Worker", {
      name: "pickmyclass",
      // worker.ts wraps the TanStack Start handler and exports the Workflow classes.
      main: "./worker.ts",
      assets: {
        // TanStack Start renders every page, so a stray public/*.html must never answer an
        // extensionless route ahead of the request gate (auth + CSP).
        htmlHandling: "none",
        notFoundHandling: "none",
      },
      compatibility: {
        date: "2026-05-07",
        flags: ["nodejs_compat", "global_fetch_strictly_public"],
      },
      // Alchemy defaults version preview URLs on; production never used them.
      workersDev: { enabled: true, previewsEnabled: false },
      placement: { mode: "smart" },
      // Clerk dev instances authorize this local port (lib/auth/clerk-session.ts), so a second
      // `alchemy dev` exits instead of drifting to one where sign-in fails.
      dev: { port: 3000, strictPort: true },
      logpush: false,
      observability: {
        enabled: true,
        // Sent only to OpenObserve: `persist: false` keeps no Cloudflare copy, so it is not billed.
        logs: {
          enabled: true,
          persist: false,
          invocationLogs: true,
          destinations: ["openobserve-logs"],
        },
        traces: { enabled: true, persist: false, destinations: ["openobserve-traces"] },
      },
      // Schedules live on the Workflows below; no scheduled() triggers.
      crons: [],
      // Custom domains (pickmyclass.app, www) stay dashboard-managed: omitting `domain` leaves them alone.
      env: {
        ...(dev ? yield* devEnv : VARS),
        HYPERDRIVE: Cloudflare.Hyperdrive.lookup("Hyperdrive", {
          hyperdriveId: "749d7808617942ceabbca1059710fbbf",
          dev: dev ? yield* devDatabase : undefined,
        }),
        EMAIL: Cloudflare.Email.SendEmail("EMAIL"),
        CF_VERSION_METADATA: Cloudflare.Workers.VersionMetadata(),
        // Workers Free allows roughly 10k queue operations/day; delivery costs about 3 per message.
        PICKMYCLASS_QUEUE: queue,
        SECTION_CHECK_WORKFLOW: Cloudflare.Workflow("pickmyclass-section-check", {
          workflowName: "pickmyclass-section-check",
          className: "SectionCheckWorkflow",
          schedules: ["0,15,30,45 * * * *"],
        }),
        MAINTENANCE_WORKFLOW: Cloudflare.Workflow("pickmyclass-maintenance", {
          workflowName: "pickmyclass-maintenance",
          className: "MaintenanceWorkflow",
          schedules: ["5 * * * *"],
        }),
      },
    }).pipe(keep);

    yield* Cloudflare.Queues.Consumer("QueueConsumer", {
      queueId: queue.queueId,
      scriptName: worker.workerName,
      deadLetterQueue: deadLetterQueue.queueName,
      settings: {
        batchSize: 5,
        maxWaitTimeMs: 10_000,
        maxConcurrency: 20,
        maxRetries: QUEUE_MAX_RETRIES,
        retryDelay: 60,
      },
    }).pipe(keep);

    return { url: worker.url };
  }),
);
