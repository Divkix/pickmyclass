import { type NextRequest } from 'next/server';
import { checkLockoutSchema } from '@/lib/api/schemas';
import { mapValidationIssues } from '@/lib/api/validation';
import { fail, ok } from '@/lib/api/response';
import { checkLockoutStatus, getRemainingLockoutTime } from '@/lib/auth/lockout';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = checkLockoutSchema.safeParse(body);

    if (!validation.success) {
      return fail('Invalid input', 400, mapValidationIssues(validation.error));
    }

    const { email } = validation.data;

    const status = await checkLockoutStatus(email);

    // NOTE: `attempts` is intentionally omitted from the response.
    // Returning exact per-email failure counts turns this unauthenticated
    // endpoint into an account-state oracle (SEC-02). The login UI only needs
    // to know whether the account is locked and how long remains.
    //
    // Edge rate-limiting: this route MUST be protected by a Cloudflare WAF
    // rate-limiting rule (e.g. ≤20 req/min per IP on the path
    // `/api/auth/check-lockout`) to prevent it from being used as an
    // unauthenticated amplification primitive for account enumeration.
    // The in-app guard is intentionally omitted here because the right
    // enforcement layer is the edge (WAF), not per-Worker state.
    return ok({
      isLocked: status.isLocked,
      remainingMinutes: getRemainingLockoutTime(status.lockedUntil),
    });
  } catch (error) {
    console.error('Error checking lockout status:', error);
    return fail('Failed to check lockout status', 500);
  }
}
