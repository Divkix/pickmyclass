/**
 * Server-side analytics boundary.
 *
 * Every send constructs a FRESH PostHog client (flushAt 1 / flushInterval 0 /
 * no retries / 1s timeout) so a Workers isolate never keeps sockets, retry
 * timers, or feature-flag pollers alive between requests. Events are
 * fire-and-forget: the flush/shutdown promise is registered with `waitUntil`
 * so analytics outages can never fail the product request that emitted them.
 *
 * Identity rule: server routes already resolve the stable app user id
 * (`externalId ?? Clerk id`, the `ext_id` session claim) — pass it as `distinctId`.
 * Request-error instrumentation has no resolved user, so it recovers the
 * browser's distinct id from the posthog-js cookie instead.
 */

import { waitUntil } from "cloudflare:workers";
import { createHash } from "node:crypto";
import { PostHog } from "posthog-node";
import { z } from "zod";
import { log } from "@/lib/log";
import { POSTHOG_API_HOST, POSTHOG_PROJECT_TOKEN } from "./config";
import type { AnalyticsEventMap, AnalyticsProperties } from "./events";

const SHUTDOWN_TIMEOUT_MS = 1_000;

/** posthog-js default persistence cookie: `ph_<project token>_posthog`. */
const POSTHOG_COOKIE_NAME = `ph_${POSTHOG_PROJECT_TOKEN}_posthog`;

const posthogCookieSchema = z.object({ distinct_id: z.string().min(1) });

function shutdownClient(client: PostHog): Promise<void> {
  return client.shutdown(SHUTDOWN_TIMEOUT_MS).catch((error) => {
    log("Analytics").warn("Failed to shut down analytics client:", error);
  });
}

function createClient(): PostHog {
  return new PostHog(POSTHOG_PROJECT_TOKEN, {
    host: POSTHOG_API_HOST,
    flushAt: 1,
    flushInterval: 0,
    fetchRetryCount: 0,
    requestTimeout: SHUTDOWN_TIMEOUT_MS,
  });
}

/**
 * Makes a capture idempotent across retries: PostHog merges events that share
 * uuid, event, distinct id and timestamp, so the same key always yields the
 * same uuid and the timestamp must come from the source record.
 */
export interface ServerEventDedupe {
  key: string;
  timestamp: Date;
}

function dedupeUuid(key: string): string {
  const hex = createHash("sha256").update(key).digest("hex");
  // RFC 9562 version 8 (custom) with the RFC variant bits.
  const variant = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function captureServerEvent<E extends keyof AnalyticsEventMap>(
  distinctId: string,
  event: E,
  properties: AnalyticsEventMap[E],
  dedupe?: ServerEventDedupe,
): void {
  const client = createClient();
  waitUntil(
    client
      .captureImmediate({
        distinctId,
        event,
        properties,
        uuid: dedupe ? dedupeUuid(dedupe.key) : undefined,
        timestamp: dedupe?.timestamp,
      })
      .catch((error) => {
        log("Analytics").warn("Failed to send analytics event:", error);
      })
      .finally(() => shutdownClient(client)),
  );
}

/**
 * Reads the browser's PostHog distinct id from the posthog-js persistence
 * cookie, as PostHog's Next.js error-tracking guide does in onRequestError, so
 * server exceptions attach to the same person as their client events.
 * Malformed or missing cookies yield undefined (a personless exception).
 */
export function distinctIdFromCookieHeader(
  cookieHeader: string | string[] | undefined,
): string | undefined {
  if (!cookieHeader) return undefined;

  const cookies = Array.isArray(cookieHeader) ? cookieHeader.join("; ") : cookieHeader;

  for (const cookie of cookies.split(";")) {
    const separator = cookie.indexOf("=");

    if (separator === -1 || cookie.slice(0, separator).trim() !== POSTHOG_COOKIE_NAME) continue;

    try {
      const parsed = posthogCookieSchema.safeParse(
        JSON.parse(decodeURIComponent(cookie.slice(separator + 1).trim())),
      );

      return parsed.success ? parsed.data.distinct_id : undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

// Server instrumentation receives arbitrary thrown JavaScript values by contract;
// `cause` is the caught value forwarded to PostHog.
export async function captureServerException(
  cause: unknown,
  properties?: AnalyticsProperties,
  distinctId?: string,
): Promise<void> {
  const client = createClient();

  try {
    // SAFETY: metadata must occupy the third slot — the second is the optional distinct id.
    await client.captureExceptionImmediate(cause, distinctId, properties);
  } catch (sendError) {
    log("Analytics").warn("Failed to send analytics exception:", sendError);
  } finally {
    await shutdownClient(client);
  }
}
