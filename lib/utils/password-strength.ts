/**
 * Simple client-side password strength checker
 * Returns score 0-4 based on password characteristics.
 *
 * Length awards a point at >= 8, >= 12, and >= 16 characters, so a long,
 * low-variety passphrase can still clear the minimum-strength gate (the
 * register API only requires 8 characters).
 */
type PasswordStrengthResult = {
  score: number;
  feedback: { warning?: string; suggestions?: string[] };
};

export function calculatePasswordStrength(password: string) {
  if (!password) return { score: 0, feedback: {} } satisfies PasswordStrengthResult;

  let score = 0;
  const feedback: string[] = [];

  // Length check
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;
  else if (password.length < 8) feedback.push('Use at least 8 characters');

  // Character variety checks
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  else feedback.push('Use both uppercase and lowercase letters');

  if (/\d/.test(password)) score++;
  else feedback.push('Add numbers');

  if (/[^a-zA-Z0-9]/.test(password)) score++;
  else feedback.push('Add special characters');

  // Cap at 4
  score = Math.min(score, 4);

  return {
    score,
    feedback: { suggestions: feedback.length > 0 ? feedback : undefined },
  } satisfies PasswordStrengthResult;
}
