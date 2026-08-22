import { type NextRequest } from 'next/server';
import { loginSchema } from '@/lib/api/schemas';
import { log } from '@/lib/log';
import { parseOrFail } from '@/lib/api/validation';
import { fail, ok } from '@/lib/api/response';
import { readAuthorizationState } from '@/lib/auth/authorization-state';
import {
  createSignInTicket,
  revokeAllUserSessions,
  verifyEmailPassword,
} from '@/lib/auth/clerk-session';
import { loginAttemptPolicy } from '@/lib/auth/login-attempt-policy';
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = parseOrFail(loginSchema, body);

    if (!parsed.success) {
      return parsed.response;
    }

    const password = parsed.data.password;
    // Carried out of the policy closure on success — needed to mint the ticket.
    let authenticatedClerkUserId: string | null = null;

    const decision = await loginAttemptPolicy.attempt(
      parsed.data.email,
      async (normalizedEmail) => {
        const verified = await verifyEmailPassword(normalizedEmail, password);
        if (!verified) {
          return { kind: 'rejected', message: 'Invalid email or password' } as const;
        }

        // FRESH read so a just-disabled account cannot log back in.
        const appUserId = verified.externalId ?? verified.clerkUserId;
        const authState = await readAuthorizationState(appUserId, { cache: false });

        if (authState?.is_disabled) {
          // No session exists yet (password check is sessionless), but revoke
          // any other live sessions for the account — the signOut equivalent.
          try {
            await revokeAllUserSessions(verified.clerkUserId);
          } catch (error) {
            log('Auth').warn('Failed to revoke sessions for disabled account:', error);
          }
          return { kind: 'disabled' } as const;
        }

        authenticatedClerkUserId = verified.clerkUserId;
        return { kind: 'authenticated' } as const;
      }
    );

    if (decision.kind === 'authenticated') {
      // Credentials are verified and lockout is cleared. Hand the browser a
      // one-time sign-in token; the page redeems it via clerk-react
      // (strategy: 'ticket'), binding the session to its own Clerk client.
      if (!authenticatedClerkUserId) {
        log('Auth').error('Authenticated decision without a captured Clerk user id');
        return fail('Failed to sign in', 500);
      }
      try {
        const ticket = await createSignInTicket(authenticatedClerkUserId);
        return ok({ ticket });
      } catch (error) {
        log('Auth').error('Failed to mint sign-in ticket:', error);
        return fail('Failed to sign in', 500);
      }
    }
    if (decision.kind === 'disabled') return fail('Account has been disabled', 403);
    if (decision.kind === 'rejected') {
      return fail(decision.message, 401, {
        isLocked: false,
        remainingAttempts: decision.remainingAttempts,
      });
    }
    const details = {
      isLocked: true as const,
      remainingMinutes: decision.remainingMinutes,
    } satisfies {
      isLocked: true;
      remainingMinutes: number;
      remainingAttempts?: number;
      [key: string]: JsonValue | undefined;
    };
    if (decision.reason === 'newly_locked') Object.assign(details, { remainingAttempts: 0 });
    return fail(
      decision.reason === 'preexisting'
        ? 'Account locked due to too many failed login attempts. Please try again later.'
        : 'Too many failed login attempts. Your account has been locked for 15 minutes.',
      423,
      details
    );
  } catch (err) {
    log('Auth').error('Unexpected error:', err);
    return fail('Failed to sign in', 500);
  }
}
