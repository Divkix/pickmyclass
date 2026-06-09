import { NextResponse } from 'next/server';

/**
 * Return a successful JSON response envelope: { success: true, ...data }
 *
 * Spreads data at the top level for backward compatibility with consumers
 * that read fields directly (e.g. `data.watches`).
 */
export function ok<T extends Record<string, unknown> | null | undefined>(
  data: T,
  init?: ResponseInit
): NextResponse {
  if (data == null) {
    return NextResponse.json({ success: true }, init);
  }
  return NextResponse.json({ success: true, ...data }, init);
}

/**
 * Return a failure JSON response envelope: { success: false, error, details? }
 */
export function fail(error: string, status: number, details?: unknown): NextResponse {
  const body: { success: false; error: string; details?: unknown } = { success: false, error };
  if (details !== undefined) body.details = details;
  return NextResponse.json(body, { status });
}
