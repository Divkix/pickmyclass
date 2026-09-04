import { z } from 'zod';
import { isTermSelectable } from '@/lib/asu/terms';

const termSchema = z.string().regex(/^\d{4}$/, 'Term must be a 4-digit code (e.g., "2261")');

const classNbrSchema = z
  .string()
  .regex(/^\d{5}$/, 'Section number must be a 5-digit code (e.g., "12431")');

const uuidSchema = z.string().uuid('ID must be a valid UUID');

const selectableTermRefinement = {
  message: 'This term is no longer available. Please refresh and select a current term.',
  path: ['term'],
};

function isSelectableTermCode(term: string): boolean {
  return isTermSelectable(term);
}

const classWatchFieldsSchema = z.object({
  term: termSchema.min(1, 'Term is required'),
  class_nbr: classNbrSchema.min(1, 'Class number is required'),
});

export const createClassWatchSchema = classWatchFieldsSchema.refine(
  (data) => isSelectableTermCode(data.term),
  selectableTermRefinement
);

export const deleteClassWatchSchema = z.object({
  id: uuidSchema,
});

export const consentSchema = z.object({
  ageVerified: z
    .boolean()
    .refine((v) => v === true, 'You must be 18 years or older to use this service'),
  agreedToTerms: z
    .boolean()
    .refine((v) => v === true, 'You must agree to the Terms of Service and Privacy Policy'),
});

export const unsubscribeTokenSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});
