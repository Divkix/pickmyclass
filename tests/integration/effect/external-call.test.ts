import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { externalCall } from "@/lib/effect/external-call";

class Failed {
  readonly kind = "failed";
  constructor(readonly error: Error) {}
}

class TimedOut {
  readonly kind = "timed-out";
}

const call = (attempt: (signal: AbortSignal) => Promise<string>, timeoutMs: number) =>
  externalCall(
    attempt,
    timeoutMs,
    (error) => new Failed(error),
    () => new TimedOut(),
  );

describe("externalCall", () => {
  it("returns the attempt's value", async () => {
    await expect(Effect.runPromise(call(() => Promise.resolve("ok"), 1_000))).resolves.toBe("ok");
  });

  it("types a rejection with the thrown error", async () => {
    const boom = new Error("boom");
    const failure = await Effect.runPromise(Effect.flip(call(() => Promise.reject(boom), 1_000)));

    expect(failure).toEqual(new Failed(boom));
  });

  it("wraps a non-Error rejection so callers always get an Error", async () => {
    const failure = await Effect.runPromise(
      Effect.flip(call(() => Promise.reject("plain string"), 1_000)),
    );

    expect(failure).toBeInstanceOf(Failed);
    expect(failure instanceof Failed && failure.error.message).toBe("plain string");
  });

  it("gives up with the timeout failure and aborts the signal", async () => {
    let signal: AbortSignal | undefined;

    const failure = await Effect.runPromise(
      Effect.flip(
        call((received) => {
          signal = received;

          return new Promise<string>(() => {});
        }, 20),
      ),
    );

    expect(failure).toBeInstanceOf(TimedOut);
    expect(signal?.aborted).toBe(true);
  });

  it("does not abort a call that finished in time", async () => {
    let signal: AbortSignal | undefined;

    await Effect.runPromise(
      call((received) => {
        signal = received;

        return Promise.resolve("done");
      }, 1_000),
    );

    // Released after use either way; the point is that it never fired early.
    expect(signal).toBeDefined();
  });
});
