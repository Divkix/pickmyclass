import { z } from "zod";

const postHogSessionIdSchema = z.uuid();

export function postHogSessionIdFromHeaders(headers: Headers): string | undefined {
  const sessionId = headers.get("X-PostHog-Session-Id");

  return sessionId && postHogSessionIdSchema.safeParse(sessionId).success ? sessionId : undefined;
}
