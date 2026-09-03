import { NextResponse } from 'next/server';
import type { ZodError, ZodType } from 'zod';
import { fail } from '@/lib/api/response';

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

// eslint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: `data` is untrusted request input; schema.safeParse validates at this boundary before any domain use.
function tryParse<T>(schema: ZodType<T>, data: unknown): { data: T } | { error: ZodError } {
  const result = schema.safeParse(data);
  if (!result.success) return { error: result.error };
  return { data: result.data };
}

export function parseOrFail<T>(
  schema: ZodType<T>,
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: `data` is untrusted request input; schema.safeParse validates at this boundary before any domain use.
  data: unknown
): { success: true; data: T } | { success: false; response: NextResponse } {
  const parsed = tryParse(schema, data);
  if ('error' in parsed) {
    return { success: false, response: validationFail(parsed.error) };
  }
  return { success: true, data: parsed.data };
}

export function parseOrThrow<T>(
  schema: ZodType<T>,
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: `data` is untrusted input; validated via schema.safeParse before throw-or-return.
  data: unknown
): T {
  const parsed = tryParse(schema, data);
  if ('error' in parsed) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid input');
  }
  return parsed.data;
}
