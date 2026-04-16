import type { ZodError } from 'zod';

interface ValidationIssueDetail {
  field: string;
  message: string;
}

export function mapValidationIssues(error: ZodError): ValidationIssueDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));
}
