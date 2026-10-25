import type { JsonValue } from "@/lib/api/wire";

export function ok<T extends object>(
  data: (T & { success?: never }) | null | undefined,
  init?: ResponseInit,
): Response {
  if (data == null) {
    return Response.json({ success: true }, init);
  }

  return Response.json({ ...data, success: true as const }, init);
}

export function fail(error: string, status: number, details?: JsonValue): Response {
  const body = { success: false as const, error } satisfies {
    success: false;
    error: string;
    details?: JsonValue;
  };

  if (details !== undefined) Object.assign(body, { details });

  return Response.json(body, { status });
}
