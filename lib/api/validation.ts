import type { ZodError } from 'zod';

export interface ValidationIssueDetail {
  field: string;
  message: string;
}

export function mapValidationIssues(error: ZodError): ValidationIssueDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));
}
