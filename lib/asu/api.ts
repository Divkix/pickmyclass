import { Effect } from "effect";
import { fetchClassEffect, type AsuError } from "@/lib/asu/asu-client";
import { TtlCache } from "@/lib/cache/ttl-cache";
import { ASU_CACHE_TTL_MS } from "@/lib/config";
import { sectionRefKey, type SectionRef } from "@/lib/section-ref";
import type { ClassDetails } from "@/lib/types/class";
import type { Env } from "@/lib/types/env";

export type { ClassDetails };

export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
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
  switch (error._tag) {
    case "AsuNotFound":
      return new NotFoundError(error.message);
    case "AsuAuth":
      return new AuthError(error.message);
    case "AsuRateLimited":
      return new RateLimitError(error.message, error.retryAfterSeconds);
    case "AsuUpstream":
      return new ApiError(error.message, error.status);
  }
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

  const result = await Effect.runPromise(
    fetchClassEffect(ref, env).pipe(Effect.mapError(legacyError)),
  );

  asuApiCache.set(key, result);

  return result;
}
