import { NextResponse } from 'next/server';
import type { JsonValue } from '@/lib/api/wire';

type ApiData = Record<string, unknown>;
/**
 * Standard API response envelope helpers.
 *
 * ALL new API routes MUST use ok()/fail() rather than hand-rolling NextResponse.json().
 *
 * Documented exception (do NOT convert this):
 *   - app/api/monitoring/health/route.ts — external monitoring probe uses { status: 'ok' }

/**
 * Return a successful JSON response envelope: { success: true, ...data }
 *
 * Spreads data at the top level for backward compatibility with consumers
 * that read fields directly (e.g. `data.watches`).
 */
export function ok<T extends (ApiData & { success?: never }) | null | undefined>(
  data: T,
  init?: ResponseInit
): NextResponse {
  if (data == null) {
    return NextResponse.json({ success: true }, init);
  }
  const responseData = { ...data, success: true as const } satisfies ApiData;
  return NextResponse.json(responseData, init);
}

/**
 * Return a failure JSON response envelope: { success: false, error, details? }
 */
export function fail(error: string, status: number, details?: JsonValue): NextResponse {
  const body = { success: false as const, error } satisfies {
    success: false;
    error: string;
    details?: JsonValue;
  };
  if (details !== undefined) Object.assign(body, { details });
  return NextResponse.json(body, { status });
}
