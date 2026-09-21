import { NextResponse } from 'next/server';
import type { ZodError, ZodType } from 'zod';
import { fail } from '@/lib/api/response';
import type { JsonValue } from '@/lib/api/wire';

export type ValidationIssueDetail = {
  field: string;
  message: string;
};

export function mapValidationIssues(error: ZodError): ValidationIssueDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));
}

function validationFail(error: ZodError): NextResponse {
  return fail('Invalid input', 400, mapValidationIssues(error));
}

// SAFETY: `data` is a wire JSON value from the request body; the schema is the decoder
// at this boundary before any domain use.
function tryParse<T>(schema: ZodType<T>, data: JsonValue): { data: T } | { error: ZodError } {
  const result = schema.safeParse(data);

  if (!result.success) return { error: result.error };

  return { data: result.data };
}

export function parseOrFail<T>(
  schema: ZodType<T>,
  // SAFETY: `data` is a wire JSON value from the request body; the schema is the decoder
  // at this boundary before any domain use.
  data: JsonValue
): { success: true; data: T } | { success: false; response: NextResponse } {
  const parsed = tryParse(schema, data);

  if ('error' in parsed) {
    return { success: false, response: validationFail(parsed.error) };
  }

  return { success: true, data: parsed.data };
}

export function parseOrThrow<T>(
  schema: ZodType<T>,
  // SAFETY: `data` is a wire JSON value from the request body; the schema is the decoder
  // before throw-or-return.
  data: JsonValue
): T {
  const parsed = tryParse(schema, data);

  if ('error' in parsed) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid input');
  }

  return parsed.data;
}
