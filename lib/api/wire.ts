type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type WirePayload = Record<string, JsonValue>;

// eslint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: type guard decodes unknown wire payload at I/O boundary
export function isRecord(value: unknown): value is WirePayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
