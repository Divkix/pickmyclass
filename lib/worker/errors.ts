/**
 * Typed failures of the Worker's own outbound calls: the Cache API, the
 * telemetry collector and the static assets binding. All extend `Error`.
 *
 * None of them is retried, on purpose: a cache miss falls back to rendering,
 * browser telemetry is best-effort and already acknowledged, and the visitor
 * can reload a failed asset request. A timeout leaves the outcome unknown.
 *
 * @module lib/worker/errors
 */
import { Data } from "effect";

export class EdgeCacheFailed extends Data.TaggedError("EdgeCacheFailed")<{
  message: string;
  operation: string;
  cause: Error;
}> {}

export class EdgeCacheTimedOut extends Data.TaggedError("EdgeCacheTimedOut")<{
  message: string;
  operation: string;
  timeoutMs: number;
}> {}

export class CollectorCallFailed extends Data.TaggedError("CollectorCallFailed")<{
  message: string;
  cause: Error;
}> {}

export class CollectorCallTimedOut extends Data.TaggedError("CollectorCallTimedOut")<{
  message: string;
  timeoutMs: number;
}> {}

export class AssetsFetchFailed extends Data.TaggedError("AssetsFetchFailed")<{
  message: string;
  cause: Error;
}> {}

export class AssetsFetchTimedOut extends Data.TaggedError("AssetsFetchTimedOut")<{
  message: string;
  timeoutMs: number;
}> {}
