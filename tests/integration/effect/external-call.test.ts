import { it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect } from "vite-plus/test";
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
  it.effect("returns the attempt's value", () =>
    Effect.gen(function* () {
      expect(yield* call(() => Promise.resolve("ok"), 1_000)).toBe("ok");
    }),
  );

  it.effect("types a rejection with the thrown error", () =>
    Effect.gen(function* () {
      const boom = new Error("boom");

      expect(yield* Effect.flip(call(() => Promise.reject(boom), 1_000))).toEqual(new Failed(boom));
    }),
  );

  it.effect("wraps a non-Error rejection so callers always get an Error", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(call(() => Promise.reject("plain string"), 1_000));

      expect(failure).toBeInstanceOf(Failed);
      expect(failure instanceof Failed && failure.error.message).toBe("plain string");
    }),
  );

  it.effect("gives up with the timeout failure and aborts the signal", () =>
    Effect.gen(function* () {
      let signal: AbortSignal | undefined;

      const fiber = yield* call((received) => {
        signal = received;

        return new Promise<string>(() => {});
      }, 20).pipe(Effect.flip, Effect.forkChild);

      yield* TestClock.adjust(20);

      expect(yield* Fiber.join(fiber)).toBeInstanceOf(TimedOut);
      expect(signal?.aborted).toBe(true);
    }),
  );

  it.effect("leaves the signal alone once the call settles in time", () =>
    Effect.gen(function* () {
      let signal: AbortSignal | undefined;

      yield* call((received) => {
        signal = received;

        return Promise.resolve("done");
      }, 1_000);

      expect(signal?.aborted).toBe(false);
    }),
  );
});
