import { AuthError, NotFoundError } from '@/lib/asu/api';
import { fail } from '@/lib/api/response';

/**
 * Map a caught ASU API error to an appropriate HTTP response.
 * Used in route handlers that call the ASU API.
 */
// eslint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: boundary decoder narrows unknown catch error via instanceof checks
export function mapAsuErrorToResponse(error: unknown) {
  if (error instanceof NotFoundError) {
    return fail('Class section not found', 404);
  }
  if (error instanceof AuthError) {
    return fail('Service temporarily unavailable', 503);
  }
  return fail('Failed to fetch class details', 500);
}
