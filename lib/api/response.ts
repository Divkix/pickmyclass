import { NextResponse } from 'next/server';

/**
 * Standard API response envelope helpers.
 *
 * ALL new API routes MUST use ok()/fail() rather than hand-rolling NextResponse.json().
 *
 * Documented exceptions (do NOT convert these):
 *   - app/api/monitoring/health/route.ts — external monitoring probe uses { status: 'ok' }
 *   - app/api/auth/send-email-hook/route.ts — Supabase standardwebhooks protocol dictates shape
 *   - app/api/queue/process-section/route.ts — queue consumer reads top-level `retryable` boolean
 *     and HTTP status codes (200/429/502) that cannot be expressed via fail()
 */

/**
 * Return a successful JSON response envelope: { success: true, ...data }
 *
 * Spreads data at the top level for backward compatibility with consumers
 * that read fields directly (e.g. `data.watches`).
 */
export function ok<T extends (Record<string, unknown> & { success?: never }) | null | undefined>(
  data: T,
  init?: ResponseInit
): NextResponse {
  if (data == null) {
    return NextResponse.json({ success: true }, init);
  }
  const responseData: Record<string, unknown> = { ...data, success: true };
  return NextResponse.json(responseData, init);
}

/**
 * Return a failure JSON response envelope: { success: false, error, details? }
 */
export function fail(error: string, status: number, details?: unknown): NextResponse {
  const body: { success: false; error: string; details?: unknown } = { success: false, error };
  if (details !== undefined) body.details = details;
  return NextResponse.json(body, { status });
}
