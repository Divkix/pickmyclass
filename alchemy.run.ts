// Production deploy: `pnpm run deploy` runs `alchemy deploy --stage prod` after the Vite build.
// wrangler.jsonc stays the single source of config (Vite dev, `wrangler dev` and this stack all
// read it); only what Alchemy needs to adopt the live resources lives here.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import { unstable_readConfig } from "wrangler";
import { z } from "zod";

const STAGE = "prod";

// unstable_readConfig types most collections loosely; validate exactly what this stack consumes.
const one = <T extends z.ZodType>(item: T) => z.tuple([item]).transform(([value]) => value);

const wrangler = z
  .object({
    name: z.string(),
    compatibility_date: z.string(),
    compatibility_flags: z.array(z.string()),
    logpush: z.boolean(),
    assets: z.object({
      html_handling: z.enum([
        "auto-trailing-slash",
        "force-trailing-slash",
        "drop-trailing-slash",
        "none",
      ]),
      not_found_handling: z.enum(["none", "404-page", "single-page-application"]),
    }),
    observability: z.object({
      enabled: z.boolean(),
      logs: z.object({
        enabled: z.boolean(),
        persist: z.boolean(),
        invocation_logs: z.boolean(),
        destinations: z.array(z.string()),
      }),
      traces: z.object({
        enabled: z.boolean(),
        persist: z.boolean(),
        destinations: z.array(z.string()),
      }),
    }),
    triggers: z.object({ crons: z.array(z.string()) }),
    vars: z.record(z.string(), z.string()),
    version_metadata: z.object({ binding: z.string() }),
    hyperdrive: one(z.object({ binding: z.string(), id: z.string() })),
    send_email: one(z.object({ name: z.string() })),
    workflows: z.array(
      z.object({
        name: z.string(),
        binding: z.string(),
        class_name: z.string(),
        schedules: z.array(z.string()),
      }),
    ),
    queues: z.object({
      producers: one(z.object({ binding: z.string(), queue: z.string() })),
      consumers: one(
        z.object({
          queue: z.string(),
          max_batch_size: z.number(),
          max_batch_timeout: z.number(),
          max_concurrency: z.number(),
          max_retries: z.number(),
          retry_delay: z.number(),
          dead_letter_queue: z.string(),
        }),
      ),
    }),
  })
  .parse(unstable_readConfig({ config: "wrangler.jsonc" }));

const producer = wrangler.queues.producers;
const consumer = wrangler.queues.consumers;

if (consumer.queue !== producer.queue) {
  throw new Error("wrangler.jsonc: consumer and producer queues differ");
}

export default Alchemy.Stack(
  "pickmyclass",
  // State lives in the gitignored .alchemy/ directory. Losing it is recoverable with
  // `alchemy deploy --stage prod --adopt`, since every resource below has a fixed name.
  { providers: Cloudflare.providers(), state: Alchemy.localState() },
  Effect.gen(function* () {
    // Every name below is the live production name. Any other stage would fight prod for them.
    if ((yield* Alchemy.Stage) !== STAGE) {
      return yield* Effect.die(new Error(`Only --stage ${STAGE} is supported.`));
    }

    // Prod is the only stage: `alchemy destroy` and refactors forget resources instead of deleting them.
    const keep = Alchemy.RemovalPolicy.retain(true);

    const queue = yield* Cloudflare.Queues.Queue("Queue", { name: producer.queue }).pipe(keep);

    const deadLetterQueue = yield* Cloudflare.Queues.Queue("DeadLetterQueue", {
      name: consumer.dead_letter_queue,
    }).pipe(keep);

    const worker = yield* Cloudflare.Worker("Worker", {
      name: wrangler.name,
      // Prebuilt by `vp build` (@cloudflare/vite-plugin). worker.ts re-exports the Workflow
      // classes, which `bundle: false` requires.
      main: "./dist/server/index.js",
      bundle: false,
      assets: {
        directory: "./dist/client",
        htmlHandling: wrangler.assets.html_handling,
        notFoundHandling: wrangler.assets.not_found_handling,
      },
      compatibility: {
        date: wrangler.compatibility_date,
        flags: wrangler.compatibility_flags,
      },
      // Alchemy defaults version preview URLs on; Wrangler had left them off.
      workersDev: { enabled: true, previewsEnabled: false },
      placement: { mode: "smart" },
      logpush: wrangler.logpush,
      observability: {
        enabled: wrangler.observability.enabled,
        logs: {
          enabled: wrangler.observability.logs.enabled,
          persist: wrangler.observability.logs.persist,
          invocationLogs: wrangler.observability.logs.invocation_logs,
          destinations: wrangler.observability.logs.destinations,
        },
        traces: {
          enabled: wrangler.observability.traces.enabled,
          persist: wrangler.observability.traces.persist,
          destinations: wrangler.observability.traces.destinations,
        },
      },
      crons: wrangler.triggers.crons,
      // Custom domains (pickmyclass.app, www) stay dashboard-managed: omitting `domain` leaves them alone.
      env: {
        ...wrangler.vars,
        // Secrets stay `wrangler secret put` / dashboard managed: Alchemy never deletes secrets it
        // did not upload.
        [wrangler.hyperdrive.binding]: Cloudflare.Hyperdrive.lookup("Hyperdrive", {
          hyperdriveId: wrangler.hyperdrive.id,
        }),
        [wrangler.send_email.name]: Cloudflare.Email.SendEmail(wrangler.send_email.name),
        [wrangler.version_metadata.binding]: Cloudflare.Workers.VersionMetadata(),
        [producer.binding]: queue,
        ...Object.fromEntries(
          wrangler.workflows.map((workflow) => [
            workflow.binding,
            Cloudflare.Workflow(workflow.name, {
              workflowName: workflow.name,
              className: workflow.class_name,
              schedules: workflow.schedules,
            }),
          ]),
        ),
      },
    }).pipe(keep);

    yield* Cloudflare.Queues.Consumer("QueueConsumer", {
      queueId: queue.queueId,
      scriptName: worker.workerName,
      deadLetterQueue: deadLetterQueue.queueName,
      settings: {
        batchSize: consumer.max_batch_size,
        maxWaitTimeMs: consumer.max_batch_timeout * 1000,
        maxConcurrency: consumer.max_concurrency,
        maxRetries: consumer.max_retries,
        retryDelay: consumer.retry_delay,
      },
    }).pipe(keep);

    return { url: worker.url };
  }),
);
