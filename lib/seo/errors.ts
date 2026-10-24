/**
 * Typed failures of the IndexNow deploy script's requests. Both extend `Error`.
 * Not retried per request: the script polls the key file and sitemap itself,
 * and a failed ping only delays a recrawl, so the outcome is `skipped`.
 *
 * @module lib/seo/errors
 */
import { Data } from "effect";

export class IndexNowRequestFailed extends Data.TaggedError("IndexNowRequestFailed")<{
  message: string;
  url: string;
  cause: Error;
}> {}

export class IndexNowRequestTimedOut extends Data.TaggedError("IndexNowRequestTimedOut")<{
  message: string;
  url: string;
  timeoutMs: number;
}> {}
