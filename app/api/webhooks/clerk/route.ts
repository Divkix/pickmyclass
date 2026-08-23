/**
 * Clerk webhook receiver — keeps the local `users` mirror in sync.
 * Events: user.created / user.updated delegate to
 * `syncUserMirrorFromClerkUser` to upsert the mirror row and ensure the 1:1
 * user_profiles row exists (this replaces the dropped Supabase
 * `on_auth_user_created` trigger). user.deleted applies the CCPA-consistent
 * soft delete on the profile.
 *
 * Contract: verify the Standard-Webhooks signature, return 2xx fast, never
 * throw — Svix retries on 4xx/5xx and the dashboard can replay. A 500 here is
 * correct for transient DB errors (Svix redelivers); a 400 is only for bad
 * signatures.
 */
import { verifyWebhook } from '@clerk/backend/webhooks';
import { env } from 'cloudflare:workers';
import { fail, ok } from '@/lib/api/response';
import { softDeleteUserById, syncUserMirrorFromClerkUser } from '@/lib/db/users';
import { log } from '@/lib/log';

export async function POST(request: Request) {
  // SAFETY: provisioned via `wrangler secret put CLERK_WEBHOOK_SIGNING_SECRET`.
  // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: Cloudflare Env has string-indexed bindings; narrow to known secret shape for optional chaining
  const { CLERK_WEBHOOK_SIGNING_SECRET } = env as unknown as {
    CLERK_WEBHOOK_SIGNING_SECRET?: string;
  };
  if (!CLERK_WEBHOOK_SIGNING_SECRET) {
    log('ClerkWebhook').error('CLERK_WEBHOOK_SIGNING_SECRET is not set');
    return fail('Webhook not configured', 500);
  }

  let event;
  try {
    event = await verifyWebhook(request, { signingSecret: CLERK_WEBHOOK_SIGNING_SECRET });
  } catch (error) {
    log('ClerkWebhook').warn('Signature verification failed:', error);
    return fail('Invalid signature', 400);
  }

  try {
    if (event.type === 'user.created' || event.type === 'user.updated') {
      const synced = await syncUserMirrorFromClerkUser(event.data);
      if (!synced) {
        log('ClerkWebhook').warn(
          `Event ${event.type} for ${event.data.id} has no email — skipping`
        );
      }
      return ok(null);
    }

    if (event.type === 'user.deleted') {
      const id = event.data.id;
      if (id) {
        await softDeleteUserById(id);
      }
      return ok(null);
    }

    // Unrelated event types (sessions, organizations, …) are acknowledged.
    return ok(null);
  } catch (error) {
    // Transient DB failure — 500 so Svix redelivers.
    log('ClerkWebhook').error(`Failed to process ${event.type}:`, error);
    return fail('Webhook processing failed', 500);
  }
}
