import { NonRetryableError } from "cloudflare:workflows";
import { describe, expect, it } from "vite-plus/test";
import { DbQueryFailed, DbQueryTimedOut } from "@/lib/db/errors";
import { failPermanently } from "@/lib/workflows/step-errors";

function dbFailure(retryable: boolean): DbQueryFailed {
  return new DbQueryFailed({
    message: "boom",
    operation: "select",
    code: retryable ? "08006" : "42601",
    retryable,
    cause: new Error("boom"),
  });
}

async function caught(run: () => Promise<number>): Promise<Error | undefined> {
  return failPermanently(run).then(
    () => undefined,
    (error: Error) => error,
  );
}

describe("failPermanently", () => {
  it("passes a result through", async () => {
    expect(await failPermanently(() => Promise.resolve(3))).toBe(3);
  });

  it("stops the step's retries on a failure that cannot succeed", async () => {
    const error = await caught(() => Promise.reject(dbFailure(false)));

    expect(error).toBeInstanceOf(NonRetryableError);
    expect(error?.name).toBe("DbQueryFailed");
  });

  it("leaves a transient failure for the step's own retries", async () => {
    const transient = dbFailure(true);

    expect(await caught(() => Promise.reject(transient))).toBe(transient);
  });

  it("leaves a timeout and an untyped error for the step's own retries", async () => {
    const timedOut = new DbQueryTimedOut({
      message: "t",
      operation: "select",
      timeoutMs: 1,
      retryable: true,
    });

    const plain = new Error("plain");

    expect(await caught(() => Promise.reject(timedOut))).toBe(timedOut);
    expect(await caught(() => Promise.reject(plain))).toBe(plain);
  });
});
