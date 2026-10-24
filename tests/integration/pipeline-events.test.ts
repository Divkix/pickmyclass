import { readFileSync } from "node:fs";
import { Pool, type QueryResult } from "pg";
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { QUEUE_MAX_RETRIES } from "@/lib/config";
import { ClerkIdentityDeletionIncomplete } from "@/lib/auth/clerk-errors";
import { processSection, type SectionCheckOutcome } from "@/lib/queue/process-section";
import type { Env } from "@/lib/types/env";
import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import type { ClassCheckMessage } from "@/lib/types/queue";
import {
  MaintenanceWorkflow,
  SectionCheckWorkflow,
  cycleElapsedMs,
  cycleStamp,
} from "@/lib/workflows/cron-workflows";
import { NonRetryableError } from "cloudflare:workflows";

const { deleteClerkUser } = vi.hoisted(() => ({ deleteClerkUser: vi.fn() }));

vi.mock("@/lib/auth/clerk-session", () => ({ deleteClerkUser }));

vi.mock("@/lib/queue/process-section", () => ({
  processSection: vi.fn(),
  retryDelaySeconds: () => undefined,
}));

const worker = (await import("@/worker")).default;

const firedAt = new Date("2026-10-23T15:00:00.000Z");
const cycle = cycleStamp(firedAt, "even");

// SAFETY: the queue handler reads only HYPERDRIVE, and getDb never connects until a query runs.
const env = { HYPERDRIVE: { connectionString: "postgres://localhost/test" } } as Env;

// SAFETY: the queue handler never touches the execution context.
const ctx = {} as ExecutionContext;

function message(id: string, attempts: number): Message<ClassCheckMessage> {
  return {
    id,
    timestamp: new Date(),
    attempts,
    body: {
      class_nbr: "12345",
      term: "2267",
      enqueued_at: cycle,
      cycle,
      workflow_instance_id: "wf-1",
    },
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

function outcome(disposition: "ack" | "retry"): SectionCheckOutcome {
  return {
    disposition,
    httpStatus: disposition === "ack" ? 200 : 502,
    retryable: disposition === "retry",
    result: {
      success: disposition === "ack",
      classNbr: "12345",
      emailsSent: disposition === "ack" ? 2 : 0,
      processingTimeMs: 5,
      changes: {
        seatBecameAvailable: disposition === "ack",
        seatsFilled: false,
        instructorAssigned: false,
        newOpenSeats: disposition === "ack" ? 3 : 0,
      },
    },
  };
}

describe("pipeline events", () => {
  let info: MockInstance<typeof console.info>;

  const events = (name: string) =>
    info.mock.calls.flatMap(([line]) =>
      line instanceof Object && "event" in line && line.event === name ? [line] : [],
    );

  beforeEach(() => {
    info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records one section_check_completed per delivery and flags dead letters", async () => {
    vi.mocked(processSection)
      .mockResolvedValueOnce(outcome("ack"))
      .mockResolvedValueOnce(outcome("retry"))
      .mockResolvedValueOnce(outcome("retry"))
      .mockRejectedValueOnce(new TypeError("socket closed"))
      .mockRejectedValueOnce(new TypeError("socket closed"));

    const batch: MessageBatch<ClassCheckMessage> = {
      queue: "pickmyclass-queue",
      // Deliveries 1-3 may retry; a retry on delivery 4 (attempts > max_retries) dead-letters.
      messages: [
        message("ok", 1),
        message("retry-last", 4),
        message("retry-early", 3),
        message("threw-early", 2),
        message("threw-last", 4),
      ],
      metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      retryAll: vi.fn(),
      ackAll: vi.fn(),
    };

    await worker.queue(batch, env, ctx);

    expect(events("section_check_completed")).toEqual([
      expect.objectContaining({
        result: "ok",
        disposition: "ack",
        emails_sent: 2,
        seat_opened: true,
        dead_lettered: false,
        workflow_instance_id: "wf-1",
        cycle_elapsed_ms: expect.any(Number),
      }),
      expect.objectContaining({ result: "failed", disposition: "retry", dead_lettered: true }),
      expect.objectContaining({ result: "failed", disposition: "retry", dead_lettered: false }),
      expect.objectContaining({ result: "threw", disposition: "retry", dead_lettered: false }),
      expect.objectContaining({ result: "threw", disposition: "retry", dead_lettered: true }),
    ]);
    expect(events("queue_batch_processed")).toEqual([
      expect.objectContaining({ messages: 5, successful: 1, failed: 4 }),
    ]);
  });

  it("records the cycle once its batches are enqueued", async () => {
    const result: QueryResult = {
      command: "SELECT",
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [{ expired: 0, class_nbr: "12345", term: "2297" }],
    };

    vi.spyOn(Pool.prototype, "query").mockImplementation(() => Promise.resolve(result));

    const sendBatch = vi.fn().mockResolvedValue(undefined);

    const workflow = new SectionCheckWorkflow(ctx, {
      HYPERDRIVE: env.HYPERDRIVE,
      PICKMYCLASS_QUEUE: { sendBatch },
    });

    const stepNames: string[] = [];

    const step = {
      do: <T>(name: string, _config: WorkflowStepConfig, run: () => Promise<T>) => {
        stepNames.push(name);

        return run();
      },
    };

    const event = {
      payload: {},
      timestamp: firedAt,
      instanceId: "wf-1",
      workflowName: "section-check",
    };

    // SAFETY: run() only calls step.do, always with a config.
    await workflow.run(event, step as WorkflowStep);

    expect(sendBatch.mock.calls[0]?.[0]).toEqual([
      {
        body: expect.objectContaining({ class_nbr: "12345", workflow_instance_id: "wf-1", cycle }),
      },
    ]);
    expect(stepNames).toContain("record cycle");
    expect(events("section_check_cycle_enqueued")).toEqual([
      expect.objectContaining({ cycle, sections: 1, batches: 1, failed_batches: 0 }),
    ]);
  });

  it("does not read a malformed expire_stale_notifications result as zero", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result: QueryResult = {
      command: "SELECT",
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [{ expired: "many", class_nbr: "12345", term: "2297" }],
    };

    vi.spyOn(Pool.prototype, "query").mockImplementation(() => Promise.resolve(result));

    const workflow = new SectionCheckWorkflow(ctx, {
      HYPERDRIVE: env.HYPERDRIVE,
      PICKMYCLASS_QUEUE: { sendBatch: vi.fn().mockResolvedValue(undefined) },
    });

    const step = {
      do: <T>(_name: string, _config: WorkflowStepConfig, run: () => Promise<T>) => run(),
    };

    const event = {
      payload: {},
      timestamp: firedAt,
      instanceId: "wf-1",
      workflowName: "section-check",
    };

    // SAFETY: run() only calls step.do, always with a config.
    await workflow.run(event, step as WorkflowStep);

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: "Failed to expire stale notifications" }),
    );
  });

  it("measures cycle age from the stamp's fire time", () => {
    expect(cycleElapsedMs(cycle, Date.parse("2026-10-23T15:20:00.000Z"))).toBe(20 * 60_000);
    expect(cycleElapsedMs(undefined, Date.now())).toBeUndefined();
    expect(cycleElapsedMs("garbage", Date.now())).toBeUndefined();
  });
});

describe("MaintenanceWorkflow", () => {
  const rowFor = (text: string) =>
    text.includes("purge_expired_data")
      ? purgeRow
      : text.includes("AS clerk_user_id")
        ? { clerk_user_id: "user_expired" }
        : { expired: 3 };

  const purgeRow = { accounts_purged: 2, notifications_purged: 5, class_states_purged: 1 };

  const stepFailures = new Map<string, Error>();

  function run(query: (text: string) => Promise<QueryResult>) {
    vi.spyOn(Pool.prototype, "query").mockImplementation(
      // SAFETY: the workflow only uses the promise form, query(config, values).
      ((config: { text: string }) => query(config.text)) as never,
    );

    const workflow = new MaintenanceWorkflow(ctx, {
      HYPERDRIVE: env.HYPERDRIVE,
      PICKMYCLASS_QUEUE: { sendBatch: vi.fn() },
    });

    stepFailures.clear();

    const step = {
      do: <T>(name: string, _config: WorkflowStepConfig, work: () => Promise<T>) =>
        work().catch((error: Error) => {
          stepFailures.set(name, error);
          throw error;
        }),
    };

    return workflow.run(
      { payload: {}, timestamp: firedAt, instanceId: "wf-m", workflowName: "maintenance" },
      // SAFETY: run() only calls step.do, always with a config.
      step as WorkflowStep,
    );
  }

  const result = (rows: unknown[]): QueryResult => ({
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  });

  it("purges data past the retention windows and reports the counts", async () => {
    const statements: string[] = [];

    deleteClerkUser.mockResolvedValue(undefined);

    const outcome = await run((text) => {
      statements.push(text);

      return Promise.resolve(result([rowFor(text)]));
    });

    expect(statements.some((text) => text.includes("public.purge_expired_data("))).toBe(true);
    expect(outcome).toEqual({
      expired: 3,
      swept: 1,
      accountsPurged: 2,
      notificationsPurged: 5,
      classStatesPurged: 1,
      clerkIdentitiesDeleted: 1,
    });
    expect(deleteClerkUser).toHaveBeenCalledWith("user_expired");
  });

  it("fails the step when a Clerk identity cannot be deleted, so it is retried", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    deleteClerkUser.mockRejectedValue(new Error("clerk unavailable"));

    await expect(run((text) => Promise.resolve(result([rowFor(text)])))).rejects.toThrow(
      /Maintenance failed/,
    );
    expect(stepFailures.get("purge expired data")).toBeInstanceOf(ClerkIdentityDeletionIncomplete);
  });

  it("fails the instance when the purge fails, so the missed retention shows up", async () => {
    deleteClerkUser.mockResolvedValue(undefined);

    await expect(
      run((text) =>
        text.includes("purge_expired_data")
          ? Promise.reject(new Error("connection reset"))
          : Promise.resolve(result([rowFor(text)])),
      ),
    ).rejects.toThrow(/purge expired data|Failed to purge expired data/);
  });

  // The sweep and purge steps fail inside query helpers that rewrap the driver error.
  it.each([
    ["stops retrying every step whose statement the server rejects for good", "42P01", true],
    ["leaves a failover to each step's own retries", "57P01", false],
  ])("%s", async (_label, code, permanent) => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      run(() => Promise.reject(Object.assign(new Error("boom"), { code }))),
    ).rejects.toThrow(/Maintenance failed/);

    expect(stepFailures.size).toBe(3);

    for (const failure of stepFailures.values())
      expect(failure instanceof NonRetryableError).toBe(permanent);
  });
});

describe("QUEUE_MAX_RETRIES", () => {
  it("matches the queue consumer's max_retries in wrangler.jsonc", () => {
    const wrangler = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");

    expect(wrangler).toMatch(new RegExp(`"max_retries":\\s*${QUEUE_MAX_RETRIES}\\b`));
  });
});
