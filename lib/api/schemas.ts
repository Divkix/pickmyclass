/**
 * Shared Zod validation schemas.
 *
 * Reusable validators for common API inputs to ensure consistency
 * across all API routes.
 */

import { z } from 'zod';
import { isTermSelectable } from '@/lib/asu/terms';

/**
 * Term code validation (4-digit format: YYSM)
 * Example: "2261" for Spring 2026
 */
const termSchema = z.string().regex(/^\d{4}$/, 'Term must be a 4-digit code (e.g., "2261")');

/**
 * Class/section number validation (5-digit format)
 * Example: "12431"
 */
const classNbrSchema = z
  .string()
  .regex(/^\d{5}$/, 'Section number must be a 5-digit code (e.g., "12431")');

/**
 * UUID validation for record IDs
 */
const uuidSchema = z.string().uuid('ID must be a valid UUID');

const selectableTermRefinement = {
  message: 'This term is no longer available. Please refresh and select a current term.',
  path: ['term'],
};

function isSelectableTermCode(term: string): boolean {
  return isTermSelectable(term);
}

// --- Pre-built schemas for common route inputs ---

const classWatchFieldsSchema = z.object({
  term: termSchema.min(1, 'Term is required'),
  class_nbr: classNbrSchema.min(1, 'Class number is required'),
});

/**
 * Schema for class watch creation (term + class_nbr)
 */
export const createClassWatchSchema = classWatchFieldsSchema.refine(
  (data) => isSelectableTermCode(data.term),
  selectableTermRefinement
);

/**
 * Schema for class watch deletion (watch ID)
 */
export const deleteClassWatchSchema = z.object({
  id: uuidSchema,
});

/**
 * Schema for recording consent after an OAuth account has authenticated.
 */
export const consentSchema = z.object({
  ageVerified: z
    .boolean()
    .refine((v) => v === true, 'You must be 18 years or older to use this service'),
  agreedToTerms: z
    .boolean()
    .refine((v) => v === true, 'You must agree to the Terms of Service and Privacy Policy'),
});

/** Schema for unsubscribe token query/body parameter */
export const unsubscribeTokenSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});
