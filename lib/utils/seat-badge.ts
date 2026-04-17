/**
 * Returns the seat availability badge variant for admin views.
 */
export function getSeatBadgeVariant(
  available: number,
  capacity: number
): 'success' | 'destructive' | 'warning' {
  if (available === 0) return 'destructive';
  if (available / capacity < 0.2) return 'warning';
  return 'success';
}
