import { type NextRequest } from 'next/server';
import { loginSchema } from '@/lib/api/schemas';
import { log } from '@/lib/log';
import { mapValidationIssues } from '@/lib/api/validation';
import { fail, ok } from '@/lib/api/response';
import { readAuthorizationState } from '@/lib/auth/authorization-state';
import { loginAttemptPolicy } from '@/lib/auth/login-attempt-policy';
import { createClient } from '@/lib/supabase/server';
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
    const validation = loginSchema.safeParse(body);

    if (!validation.success) {
      return fail('Invalid input', 400, mapValidationIssues(validation.error));
    }

    const password = validation.data.password;
    const decision = await loginAttemptPolicy.attempt(
      validation.data.email,
      async (normalizedEmail) => {
        const supabase = await createClient();
        const { data, error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });

        // FRESH read so a just-disabled account cannot log back in.
        if (data?.user) {
          const authState = await readAuthorizationState(supabase, data.user.id, {
            cache: false,
          });

          if (authState?.is_disabled) {
            await supabase.auth.signOut();
            return { kind: 'disabled' } as const;
          }
        }

        if (error || !data?.user) {
          return {
            kind: 'rejected',
            message: error?.message || 'Invalid email or password',
          } as const;
        }

        return { kind: 'authenticated' } as const;
      }
    );

    if (decision.kind === 'authenticated') return ok(null);
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
