import { Pool, type QueryConfig, type QueryResult } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { encodeTermCode } from "@/lib/asu/terms";
import { processSection } from "@/lib/queue/process-section";
import type { Env } from "@/lib/types/env";
import type { ClassCheckMessage } from "@/lib/types/queue";
import { SectionCheckWorkflow } from "@/lib/workflows/cron-workflows";
import { openedSpans } from "@/tests/mocks/cloudflare-workers";
import worker from "@/worker";
import { type DriverRow, createScriptedPostgres } from "../../mocks/scripted-postgres";
import { claim, pending, ref, state, watcher } from "../queue/fixtures";

/**
 * CPU time per Section Check, per queue message and per SectionCheckWorkflow run:
 * process.cpuUsage() around the real code, with scripted Postgres, a stubbed fetch
 * that answers as ASU and fake bindings, so nothing waits on I/O. The ASU client
 * (fetchClassFromASU → fetchClassEffect) and the queue consumer (worker.queue) run
 * for real. Compare a commit with the pre-Effect (slice-0) baseline commit named in
 * AGENTS.md → Effect, on the same machine (`pnpm run bench`), not with production,
 * which adds sockets and the runtime's log serialisation.
 *
 * Each sample is the mean of BATCH consecutive runs, and each path samples from
 * a freshly collected heap (the project passes --expose-gc). Garbage collection
 * lands in a few runs and depends on the heap the previous path left, which made
 * p95 swing by up to 40% between runs; both keep that cost in the numbers but
 * spread it evenly. Only the warm steady state is measured: every path first runs
 * WARMUP_SAMPLES × BATCH times.
 */

const BATCH = 10;

const WARMUP_SAMPLES = 200;

const SAMPLES = 1000;

/** Sections per Cron Cycle in production on 2026-10-24 (about 60). */
const WORKFLOW_SECTIONS = 60;

/** Messages per queue batch: the consumer's max_batch_size in wrangler.jsonc. */
const QUEUE_BATCH_SIZE = 5;

const CONSOLE_METHODS = ["debug", "info", "log", "warn", "error"] as const;

const recipients = ["watch-1", "watch-2", "watch-3"];

/** One ASU class-search hit for `ref`, shaped like tests/integration/asu/asu-client.test.ts. */
function asuHit(enrolled: number) {
  return {
    _source: {
      CLASSNBR: ref.class_nbr,
      SUBJECT: "CSE",
      CATALOGNBR: "110",
      TITLE: "Programming",
      ENRLCAP: "30",
      ENRLTOT: String(enrolled),
      WAITTOT: "0",
      INSTRUCTORSLIST: ["Staff"],
      MON: "Y",
      WED: "Y",
      STARTTIME: "13:15",
      ENDTIME: "14:30",
    },
  };
}

/** ASU response bodies, serialised once so the timer measures the client, not the fixture. */
const ASU_BODIES = {
  // 30 - 28 = 2 open seats: no change against state(2), a seat opening against state().
  twoOpenSeats: JSON.stringify({ hits: { total: { value: 1 }, hits: [asuHit(28)] } }),
  notFound: JSON.stringify({ hits: { total: { value: 0 }, hits: [] } }),
};

const ASU_HEADERS = { "content-type": "application/json" };

/** The body the stubbed fetch returns; each path sets it before it runs. */
let asuBody = ASU_BODIES.twoOpenSeats;

// Plain functions, not vi.fn: a mock would record every call across the runs.
async function asuFetch(): Promise<Response> {
  return new Response(asuBody, { status: 200, headers: ASU_HEADERS });
}

const environment = {
  ASU_API_BASE_URL: "https://asu.test",
  ASU_API_TOKEN: "bench-token",
  // SAFETY: the pipeline only calls the Email binding's send method.
  EMAIL: { send: async () => ({ messageId: "message-1" }) } as SendEmail,
  NOTIFICATION_FROM_EMAIL: "sender@test.com",
};

// SAFETY: getDb reads only connectionString, and the scripted pool query never connects.
const HYPERDRIVE = { connectionString: "postgres://bench@localhost/bench" } as Hyperdrive;

interface BenchRow {
  bench: "section-check-cpu";
  path: string;
  /** What one measured unit is; CPU and queries are per unit. */
  unit: "section_check" | "message" | "workflow_run";
  units: number;
  queries_per_unit: number;
  p50_us: number;
  p95_us: number;
  mean_us: number;
}

function tenths(value: number): number {
  return Math.round(value * 10) / 10;
}

function percentile(sorted: Float64Array, fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
}

/** Mean CPU microseconds per run over one batch, user plus system. */
async function batchMicros(run: () => Promise<void>): Promise<number> {
  // The workers mock keeps every span; drop the last batch's so the heap stays flat.
  openedSpans.length = 0;
  const start = process.cpuUsage();

  for (let i = 0; i < BATCH; i += 1) await run();
  const used = process.cpuUsage(start);

  return (used.user + used.system) / BATCH;
}

/**
 * Warms the path up, samples it, and prints one JSON line. `prepare(runs)` sets
 * up the next batch outside the timer; `queries()` counts the batch's queries.
 * One run covers `unitsPerRun` units, and the row reports per unit.
 */
async function measure(
  path: string,
  unit: BenchRow["unit"],
  unitsPerRun: number,
  prepare: (runs: number) => void,
  run: () => Promise<void>,
  queries: () => number,
): Promise<BenchRow> {
  for (let i = 0; i < WARMUP_SAMPLES; i += 1) {
    prepare(BATCH);
    await batchMicros(run);
  }

  const samples = new Float64Array(SAMPLES);
  // Start from the same heap whatever ran before.
  globalThis.gc?.();

  for (let i = 0; i < SAMPLES; i += 1) {
    prepare(BATCH);
    samples[i] = (await batchMicros(run)) / unitsPerRun;
  }

  samples.sort();
  let total = 0;

  for (const sample of samples) total += sample;

  const row: BenchRow = {
    bench: "section-check-cpu",
    path,
    unit,
    units: SAMPLES * BATCH * unitsPerRun,
    queries_per_unit: queries() / (BATCH * unitsPerRun),
    p50_us: tenths(percentile(samples, 0.5)),
    p95_us: tenths(percentile(samples, 0.95)),
    mean_us: tenths(total / SAMPLES),
  };

  process.stdout.write(`${JSON.stringify(row)}\n`);

  return row;
}

/** Scripted Postgres that replays `script` once per run, so every run takes the same path. */
function scriptedPath(script: DriverRow[][]) {
  const pg = createScriptedPostgres();

  return {
    db: pg.db,
    prepare(runs: number) {
      pg.statements.length = 0;

      for (let i = 0; i < runs; i += 1) for (const rows of script) pg.next(rows);
    },
    queries: () => pg.statements.length,
  };
}

/** Rows for the Workflow's two queries, matched on their SQL text. */
function workflowRows(text: string, term: string): DriverRow[] {
  if (text.includes("expire_stale_notifications")) return [{ expired: 0 }];

  if (!text.includes("get_sections_to_check")) throw new Error(`Unscripted query: ${text}`);

  return Array.from({ length: WORKFLOW_SECTIONS }, (_, index) => ({
    class_nbr: String(10_000 + index),
    term,
  }));
}

/** Rows for a no-change Section Check's two queries, matched on their SQL text. */
function noChangeRows(text: string): DriverRow[] {
  if (text.includes("record_section_observation"))
    return [{ applied: true, intent_created: false }];

  if (!text.includes("class_states")) throw new Error(`Unscripted query: ${text}`);

  return [state(2)];
}

describe("Section Check CPU", () => {
  const originalConsole = CONSOLE_METHODS.map((method) => console[method]);
  const originalQuery = Pool.prototype.query;

  // The Workflow and the queue consumer build their own pool through getDb, so the pool
  // prototype is the only seam. Each pool path sets the rows its queries return.
  let poolRows: (text: string) => DriverRow[] = noChangeRows;
  let poolQueries = 0;

  async function scriptedQuery(config: QueryConfig & { rowMode?: string }): Promise<QueryResult> {
    poolQueries += 1;
    const rows = poolRows(config.text);

    return {
      command: "SELECT",
      rowCount: rows.length,
      oid: 0,
      fields: [],
      // Drizzle reads array-mode rows positionally, in the order its select lists the columns.
      rows: config.rowMode === "array" ? rows.map((row) => Object.values(row)) : rows,
    };
  }

  beforeAll(() => {
    vi.stubEnv("UNSUBSCRIBE_SIGNING_SECRET", "bench-signing-secret");
    vi.stubGlobal("fetch", asuFetch);
    // SAFETY: Drizzle's node-postgres session only calls the promise form, query(config, values).
    Pool.prototype.query = scriptedQuery as Pool["query"];

    // The test reporter would otherwise format every log object inside the timer.
    for (const method of CONSOLE_METHODS) console[method] = () => {};
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    CONSOLE_METHODS.forEach((method, index) => {
      console[method] = originalConsole[index];
    });
    Pool.prototype.query = originalQuery;
  });

  it("checks a section with no pending intent and no change", async () => {
    asuBody = ASU_BODIES.twoOpenSeats;
    const path = scriptedPath([[state(2)], [{ applied: true, intent_created: false }]]);

    const row = await measure(
      "no-change",
      "section_check",
      1,
      path.prepare,
      async () => {
        const outcome = await processSection(path.db, ref, environment);

        if (
          outcome.disposition !== "ack" ||
          !outcome.result.success ||
          outcome.result.emailsSent !== 0 ||
          outcome.result.changes.seatBecameAvailable
        )
          throw new Error("no-change path did not ack without a change");
      },
      path.queries,
    );

    expect(row.queries_per_unit).toBe(2);
  });

  it("delivers three seat emails for an intent this check created", async () => {
    asuBody = ASU_BODIES.twoOpenSeats;

    // The delivery confirmation and the intent delete return no rows.
    const path = scriptedPath([
      [state()],
      [{ applied: true, intent_created: true }],
      [],
      [pending],
      [pending],
      recipients.map((watch_id) => ({ ...watcher, watch_id })),
      recipients.map((watch_id, index) => ({
        ...claim,
        notification_id: `claim-${index + 1}`,
        class_watch_id: watch_id,
      })),
      [],
      [],
    ]);

    const row = await measure(
      "seat-opened-3-emails",
      "section_check",
      1,
      path.prepare,
      async () => {
        const outcome = await processSection(path.db, ref, environment);

        if (
          outcome.disposition !== "ack" ||
          !outcome.result.success ||
          !outcome.result.changes.seatBecameAvailable ||
          outcome.result.emailsSent !== recipients.length
        )
          throw new Error("delivery path did not send every email");
      },
      path.queries,
    );

    expect(row.queries_per_unit).toBe(9);
  });

  it("tracks a NotFound section towards retirement", async () => {
    asuBody = ASU_BODIES.notFound;
    const path = scriptedPath([[state()], [{ new_count: 1 }]]);

    const row = await measure(
      "not-found-tracked",
      "section_check",
      1,
      path.prepare,
      async () => {
        const outcome = await processSection(path.db, ref, environment);

        if (outcome.disposition !== "ack" || outcome.result.retirement?.status !== "tracked")
          throw new Error("NotFound path did not track the strike");
      },
      path.queries,
    );

    expect(row.queries_per_unit).toBe(2);
  });

  it("consumes a full queue batch of no-change Section Checks", async () => {
    asuBody = ASU_BODIES.twoOpenSeats;
    poolRows = noChangeRows;
    let acked = 0;
    let retried = 0;

    const message = (index: number): Message<ClassCheckMessage> => ({
      id: `message-${index}`,
      timestamp: new Date("2026-10-15T12:00:01.000Z"),
      body: {
        class_nbr: ref.class_nbr,
        term: ref.term,
        enqueued_at: ref.cycle,
        cycle: ref.cycle,
        workflow_instance_id: "bench-1",
      },
      attempts: 1,
      ack: () => {
        acked += 1;
      },
      retry: () => {
        retried += 1;
      },
    });

    const batch: MessageBatch<ClassCheckMessage> = {
      queue: "pickmyclass-queue",
      messages: Array.from({ length: QUEUE_BATCH_SIZE }, (_, index) => message(index)),
      metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      ackAll: () => {},
      retryAll: () => {},
    };

    // SAFETY: queue() reads only HYPERDRIVE, the ASU and Email bindings and CF_VERSION_METADATA.
    const env = { ...environment, HYPERDRIVE } as Env;

    const reset = () => {
      poolQueries = 0;
      acked = 0;
      retried = 0;
    };

    const row = await measure(
      `queue-batch-${QUEUE_BATCH_SIZE}`,
      "message",
      QUEUE_BATCH_SIZE,
      reset,
      async () => {
        // SAFETY: queue() never touches the execution context.
        await worker.queue(batch, env, {} as ExecutionContext);
      },
      () => poolQueries,
    );

    expect(row.queries_per_unit).toBe(2);
    expect({ acked, retried }).toEqual({ acked: QUEUE_BATCH_SIZE * BATCH, retried: 0 });
  });

  it("runs one SectionCheckWorkflow that enqueues a cycle", async () => {
    // Next year's fall is never a past term, so the Workflow enqueues every section.
    const term = encodeTermCode(new Date().getUTCFullYear() + 1, "fall");
    poolRows = (text) => workflowRows(text, term);
    let enqueued = 0;

    const workflow = new SectionCheckWorkflow(
      // SAFETY: run() never touches the execution context.
      {} as ExecutionContext,
      {
        HYPERDRIVE,
        PICKMYCLASS_QUEUE: {
          sendBatch: async (messages) => {
            enqueued += [...messages].length;

            return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } };
          },
        },
      },
    );

    const step = {
      do: <T>(_name: string, _config: WorkflowStepConfig, run: () => Promise<T>) => run(),
    };

    const event = {
      payload: {},
      timestamp: new Date("2026-10-24T15:00:00.000Z"),
      instanceId: "bench-1",
      workflowName: "pickmyclass-section-check",
    };

    const reset = () => {
      poolQueries = 0;
      enqueued = 0;
    };

    const row = await measure(
      "workflow-run",
      "workflow_run",
      1,
      reset,
      async () => {
        // SAFETY: run() only calls step.do, always with a config.
        const result = await workflow.run(event, step as WorkflowStep);

        if (result.sections_enqueued !== WORKFLOW_SECTIONS)
          throw new Error("workflow did not enqueue every section");
      },
      () => poolQueries,
    );

    expect(row.queries_per_unit).toBe(2);
    expect(enqueued).toBe(WORKFLOW_SECTIONS * BATCH);
  });
});
