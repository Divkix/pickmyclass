import { describe, expect, it } from "vite-plus/test";
import { DbQueryFailed } from "@/lib/db/errors";
import { isPermanentFailure } from "@/lib/effect/failure";

function dbFailure(retryable: boolean) {
  return new DbQueryFailed({
    message: "boom",
    operation: "select",
    retryable,
    cause: new Error("driver"),
  });
}

describe("isPermanentFailure", () => {
  it("reads the flag on the error itself", () => {
    expect(isPermanentFailure(dbFailure(false))).toBe(true);
    expect(isPermanentFailure(dbFailure(true))).toBe(false);
  });

  it("sees through a wrapper that carries the typed failure as its cause", () => {
    expect(isPermanentFailure(new Error("Failed query", { cause: dbFailure(false) }))).toBe(true);
    expect(isPermanentFailure(new Error("Failed query", { cause: dbFailure(true) }))).toBe(false);
  });

  it("treats an error with no flag anywhere as worth retrying", () => {
    expect(isPermanentFailure(new Error("plain", { cause: new Error("inner") }))).toBe(false);
  });
});
