/**
 * Clerk webhook receiver — keeps the local `users` mirror in sync.
 *
 * Events: user.created / user.updated upsert the mirror row (id, email,
 * email_confirmed_at, last_sign_in_at) and ensure the 1:1 user_profiles row
 * exists (this replaces the dropped Supabase `on_auth_user_created` trigger).
 * user.deleted applies the CCPA-consistent soft delete on the profile.
 *
 * Contract: verify the Standard-Webhooks signature, return 2xx fast, never
 * throw — Svix retries on 4xx/5xx and the dashboard can replay. A 500 here is
 * correct for transient DB errors (Svix redelivers); a 400 is only for bad
 * signatures.
 */
import { verifyWebhook } from '@clerk/backend/webhooks';
import type { UserJSON } from '@clerk/backend';
import { env } from 'cloudflare:workers';
import { fail, ok } from '@/lib/api/response';
import { softDeleteUserById, upsertUserFromClerkWebhook } from '@/lib/db/users';
import { log } from '@/lib/log';

/** Pull the primary email + its verification state out of the Clerk user payload. */
function extractPrimaryEmail(user: UserJSON): { email: string; verified: boolean } | null {
  const primary =
    user.email_addresses.find((e) => e.id === user.primary_email_address_id) ??
    user.email_addresses[0];
  if (!primary) return null;
  return { email: primary.email_address, verified: primary.verification?.status === 'verified' };
}

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
      const data = event.data;
      const primary = extractPrimaryEmail(data);
      if (!primary) {
        log('ClerkWebhook').warn(`Event ${event.type} for ${data.id} has no email — skipping`);
        return ok(null);
      }

      // Stable app user id: externalId for migrated users (old Supabase UUID),
      // otherwise the Clerk user id.
      const appUserId = data.external_id ?? data.id;
      // eslint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- SAFETY: Clerk UserJSON public_metadata is Record<string, unknown> | null per Clerk types; narrow from unknown
      const metadata = data.public_metadata as Record<string, unknown> | null;

      await upsertUserFromClerkWebhook({
        id: appUserId,
        clerkUserId: data.id,
        email: primary.email.toLowerCase(),
        emailConfirmedAt: primary.verified ? new Date() : null,
        createdAt: typeof data.created_at === 'number' ? new Date(data.created_at) : null,
        lastSignInAt:
          typeof data.last_sign_in_at === 'number' ? new Date(data.last_sign_in_at) : null,
        ageVerified: metadata?.age_verified === true,
        agreedToTerms: metadata?.agreed_to_terms === true,
      });
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
