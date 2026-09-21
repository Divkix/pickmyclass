import { NextResponse } from 'next/server';
import type { JsonValue } from '@/lib/api/wire';

export function ok<T extends object>(
  data: (T & { success?: never }) | null | undefined,
  init?: ResponseInit
): NextResponse {
  if (data == null) {
    return NextResponse.json({ success: true }, init);
  }

  return NextResponse.json({ ...data, success: true as const }, init);
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
