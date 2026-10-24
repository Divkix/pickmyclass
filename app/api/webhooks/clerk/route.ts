/**
 * Clerk webhook receiver — keeps the local `users` mirror in sync.
 * Events: user.created / user.updated delegate to
 * `syncUserMirrorFromClerkUser` to upsert the mirror row and ensure the 1:1
 * user_profiles row exists (this replaces the dropped Supabase
 * `on_auth_user_created` trigger). user.created also logs `user_registered`;
 * Svix redeliveries log it again, so count distinct `clerk_user_id`. user.deleted applies
 * the CCPA-consistent soft delete on the profile.
 *
 * Contract: verify the Standard-Webhooks signature, return 2xx fast, never
 * throw — Svix retries on 4xx/5xx and the dashboard can replay. A 500 here is
 * correct for transient DB errors (Svix redelivers); a 400 is only for bad
 * signatures and a 422 for a signed payload that does not match the expected shape.
 */
import { verifyWebhook } from "@clerk/backend/webhooks";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { fail, ok } from "@/lib/api/response";
import { clerkWebhookUserSchema } from "@/lib/auth/clerk-webhook-schema";
import { clearAuthorizationStateCache } from "@/lib/auth/authorization-state";
import { getDbFromEnv } from "@/lib/db";
import {
  clearUserVerificationCache,
  softDeleteUserById,
  syncUserMirrorFromClerkUser,
} from "@/lib/db/users";
import { errorFields, log, logEvent } from "@/lib/log";

const clerkWebhookEnvSchema = z.object({
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().optional(),
});

export async function POST(request: Request) {
  // SAFETY: provisioned via `wrangler secret put CLERK_WEBHOOK_SIGNING_SECRET`.
  const { CLERK_WEBHOOK_SIGNING_SECRET } = clerkWebhookEnvSchema.parse(env);

  if (!CLERK_WEBHOOK_SIGNING_SECRET) {
    log("ClerkWebhook").error("CLERK_WEBHOOK_SIGNING_SECRET is not set");

    return fail("Webhook not configured", 500);
  }

  let event;

  try {
    event = await verifyWebhook(request, { signingSecret: CLERK_WEBHOOK_SIGNING_SECRET });
  } catch (error) {
    log("ClerkWebhook").warn("Signature verification failed", errorFields(error));

    return fail("Invalid signature", 400);
  }

  try {
    const db = getDbFromEnv();

    if (event.type === "user.created" || event.type === "user.updated") {
      const parsed = clerkWebhookUserSchema.safeParse(event.data);

      if (!parsed.success) {
        // Redelivery cannot fix a payload shape this code does not know, but a failing endpoint
        // is visible in the Svix dashboard and the delivery can be replayed after a fix.
        log("ClerkWebhook").error("Webhook user payload does not match the expected shape", {
          event_type: event.type,
          "error.message": parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
        });

        return fail("Invalid webhook payload", 422);
      }

      const user = parsed.data;
      const synced = await syncUserMirrorFromClerkUser(db, user);

      if (!synced) {
        log("ClerkWebhook").warn("Webhook user has no email, skipping", {
          event_type: event.type,
          clerk_user_id: user.id,
        });
      } else if (event.type === "user.created") {
        logEvent("user_registered", {
          user_id: user.external_id ?? user.id,
          clerk_user_id: user.id,
          registered_at: new Date(user.created_at).toISOString(),
        });
      }

      return ok(null);
    }

    if (event.type === "user.deleted") {
      const id = event.data.id;

      if (id) {
        await softDeleteUserById(db, id);
        // The event only carries the Clerk id while the gate caches by app id
        // (the migrated Supabase UUID for old accounts), so drop the small
        // per-isolate caches wholesale rather than guess the key. Deletes are
        // rare; the cost is re-reading state on the next request.
        clearAuthorizationStateCache();
        clearUserVerificationCache();
      }

      return ok(null);
    }

    return ok(null);
  } catch (error) {
    log("ClerkWebhook").error("Failed to process webhook", {
      event_type: event.type,
      ...errorFields(error),
    });

    return fail("Webhook processing failed", 500);
  }
}
