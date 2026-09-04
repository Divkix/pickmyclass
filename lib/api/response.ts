import { NextResponse } from 'next/server';
import type { JsonValue } from '@/lib/api/wire';

type ApiData = Record<string, unknown>;

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

export function fail(error: string, status: number, details?: JsonValue): NextResponse {
  const body = { success: false as const, error } satisfies {
    success: false;
    error: string;
    details?: JsonValue;
  };
  if (details !== undefined) Object.assign(body, { details });
  return NextResponse.json(body, { status });
}
