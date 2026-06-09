import { AuthError, NotFoundError } from '@/lib/asu/api';
import { NextResponse } from 'next/server';

const fail = (error: string) => ({ success: false, error });

/**
 * Map a caught ASU API error to an appropriate HTTP response.
 * Used in route handlers that call the ASU API.
 */
export function mapAsuErrorToResponse(error: unknown): NextResponse {
  if (error instanceof NotFoundError) {
    return NextResponse.json(fail('Class section not found'), { status: 404 });
  }
  if (error instanceof AuthError) {
    return NextResponse.json(fail('Service temporarily unavailable'), { status: 503 });
  }
  return NextResponse.json(fail('Failed to fetch class details'), { status: 500 });
}
