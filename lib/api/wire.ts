import { z } from 'zod';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };

export type WirePayload = Record<string, JsonValue>;

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);

export const wirePayloadSchema = z.record(z.string(), jsonValueSchema);

// SAFETY: type guard decodes unknown wire payload at I/O boundary
export function isRecord(value: unknown): value is WirePayload {
  return wirePayloadSchema.safeParse(value).success;
}
