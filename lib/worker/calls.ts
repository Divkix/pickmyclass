/**
 * The Worker's outbound calls, each with an explicit timeout and typed
 * failures: the Cache API, the telemetry collector, and the assets binding.
 *
 * @module lib/worker/calls
 */
import { Effect } from "effect";
import { ASSETS_FETCH_TIMEOUT_MS, COLLECTOR_TIMEOUT_MS, EDGE_CACHE_TIMEOUT_MS } from "@/lib/config";
import { externalCall } from "@/lib/effect/external-call";
import {
  AssetsFetchFailed,
  AssetsFetchTimedOut,
  CollectorCallFailed,
  CollectorCallTimedOut,
  EdgeCacheFailed,
  EdgeCacheTimedOut,
} from "@/lib/worker/errors";
import type { Env } from "@/lib/types/env";

export function edgeCacheCall<A>(
  operation: string,
  attempt: () => Promise<A>,
  timeoutMs = EDGE_CACHE_TIMEOUT_MS,
): Promise<A> {
  return Effect.runPromise(
    externalCall(
      attempt,
      timeoutMs,
      (error) => new EdgeCacheFailed({ message: error.message, operation, cause: error }),
      () =>
        new EdgeCacheTimedOut({
          message: `Edge cache ${operation} timed out after ${timeoutMs}ms`,
          operation,
          timeoutMs,
        }),
    ),
  );
}

/** `attempt` receives the signal that aborts the request on timeout. */
export function collectorCall<A>(
  attempt: (signal: AbortSignal) => Promise<A>,
  timeoutMs = COLLECTOR_TIMEOUT_MS,
): Promise<A> {
  return Effect.runPromise(
    externalCall(
      attempt,
      timeoutMs,
      (error) => new CollectorCallFailed({ message: error.message, cause: error }),
      () =>
        new CollectorCallTimedOut({
          message: `Telemetry collector timed out after ${timeoutMs}ms`,
          timeoutMs,
        }),
    ),
  );
}

export function fetchAsset(
  assets: Env["ASSETS"],
  request: Request,
  timeoutMs = ASSETS_FETCH_TIMEOUT_MS,
): Promise<Response> {
  return Effect.runPromise(
    externalCall(
      () => assets.fetch(request),
      timeoutMs,
      (error) => new AssetsFetchFailed({ message: error.message, cause: error }),
      () =>
        new AssetsFetchTimedOut({
          message: `Assets fetch timed out after ${timeoutMs}ms`,
          timeoutMs,
        }),
    ),
  );
}
