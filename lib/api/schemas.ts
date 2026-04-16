/**
 * Shared Zod validation schemas.
 *
 * Reusable validators for common API inputs to ensure consistency
 * across all API routes.
 */

import { z } from 'zod';

/**
 * Term code validation (4-digit format: YYSM)
 * Example: "2261" for Spring 2026
 */
export const termSchema = z.string().regex(/^\d{4}$/, 'Term must be a 4-digit code (e.g., "2261")');

/**
 * Class/section number validation (5-digit format)
 * Example: "12431"
 */
export const classNbrSchema = z
  .string()
  .regex(/^\d{5}$/, 'Section number must be a 5-digit code (e.g., "12431")');

/**
 * Email validation with required check.
 */
export const emailSchema = z.string().email('Invalid email address').min(1, 'Email is required');

/**
 * Password validation for login (just required, no minimum length)
 */
export const loginPasswordSchema = z.string().min(1, 'Password is required');

/**
 * Password validation for registration (minimum 8 characters)
 */
export const registerPasswordSchema = z.string().min(8, 'Password must be at least 8 characters');

/**
 * UUID validation for record IDs
 */
export const uuidSchema = z.string().uuid('ID must be a valid UUID');

// --- Pre-built schemas for common route inputs ---

/**
 * Schema for class watch creation (term + class_nbr)
 */
export const createClassWatchSchema = z.object({
  term: termSchema.min(1, 'Term is required'),
  class_nbr: classNbrSchema.min(1, 'Class number is required'),
});

/**
 * Schema for class watch deletion (watch ID)
 */
export const deleteClassWatchSchema = z.object({
  id: uuidSchema,
});

/**
 * Schema for fetching class details
 */
export const fetchClassDetailsSchema = z.object({
  term: termSchema.min(1, 'Term is required'),
  class_nbr: classNbrSchema.min(1, 'Section number is required'),
});

/**
 * Schema for login requests
 */
export const loginSchema = z.object({
  email: emailSchema,
  password: loginPasswordSchema,
});

/**
 * Schema for registration requests
 */
export const registerSchema = z.object({
  email: emailSchema,
  password: registerPasswordSchema,
});

/**
 * Schema for lockout status check
 */
export const checkLockoutSchema = z.object({
  email: emailSchema,
});
