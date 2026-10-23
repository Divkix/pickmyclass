import { Effect, Match } from "effect";
import { fetchClassEffect, type AsuError } from "@/lib/asu/asu-client";
import { TtlCache } from "@/lib/cache/ttl-cache";
import { ASU_CACHE_TTL_MS } from "@/lib/config";
import { sectionFields, sectionRefKey, type SectionRef } from "@/lib/section-ref";
import { withSpan } from "@/lib/telemetry/span";
import type { ClassDetails } from "@/lib/types/class";
import type { Env } from "@/lib/types/env";

export type { ClassDetails };

export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public retryable = true,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class AuthError extends ApiError {
  constructor(message: string) {
    super(message, 401);
    this.name = "AuthError";
  }
}

export class RateLimitError extends ApiError {
  constructor(
    message: string,
    public retryAfterSeconds?: number,
  ) {
    super(message, 429);
    this.name = "RateLimitError";
  }
}

export class NotFoundError extends ApiError {
  constructor(message: string) {
    super(message, 404);
    this.name = "NotFoundError";
  }
}

const asuApiCache = new TtlCache<ClassDetails>(ASU_CACHE_TTL_MS, 1000);

function legacyError(error: AsuError): ApiError {
  return Match.valueTags(error, {
    AsuNotFound: (e) => new NotFoundError(e.message),
    AsuAuth: (e) => new AuthError(e.message),
    AsuRateLimited: (e) => new RateLimitError(e.message, e.retryAfterSeconds),
    AsuUpstream: (e) => new ApiError(e.message, e.status),
    AsuInvalidResponse: (e) => new ApiError(e.message, e.status, false),
  });
}

/** Cache-aware ASU fetch; Section Checks bypass reads but still refresh the UI cache. */
export async function fetchClassFromASU(
  ref: SectionRef,
  env: Pick<Env, "ASU_API_BASE_URL" | "ASU_API_TOKEN">,
  opts: { useCache?: boolean } = {},
): Promise<ClassDetails> {
  if (!env.ASU_API_BASE_URL || !env.ASU_API_TOKEN)
    throw new ApiError("ASU API environment variables not configured");
  const key = sectionRefKey(ref);
  const cached = opts.useCache === false ? undefined : asuApiCache.get(key);

  if (cached) return cached;

  // The runtime spans the fetch itself; this one names the section and, on a
  // throw, the legacy error class (`NotFoundError`, `RateLimitError`, ...).
  const result = await withSpan("asu.fetch_class", sectionFields(ref), () =>
    Effect.runPromise(fetchClassEffect(ref, env).pipe(Effect.mapError(legacyError))),
  );

  asuApiCache.set(key, result);

  return result;
}
