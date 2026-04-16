/**
 * Time formatting utilities.
 *
 * Provides consistent relative time formatting across the application.
 */

/**
 * Format a timestamp to a relative time string.
 *
 * Examples:
 * - "Just now" (less than 1 minute)
 * - "5m ago" (less than 1 hour)
 * - "3h ago" (less than 24 hours)
 * - "2d ago" (1 day or more)
 *
 * @param timestamp - ISO timestamp string
 * @returns Relative time string
 */
export function formatRelativeTime(timestamp: string): string {
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

/**
 * Format a date string to a readable format with relative time.
 *
 * For dates within the last 7 days, shows relative time ("Just now", "2 hours ago", "3 days ago").
 * For older dates, returns null to allow fallback to absolute date formatting.
 *
 * @param dateString - ISO date string or null
 * @returns Relative time string, or null if older than 7 days
 */
export function formatRelativeDate(dateString: string | null): string | null {
  if (!dateString) return null;

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // If less than 7 days ago, show relative time
  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      return diffMinutes <= 1 ? 'Just now' : `${diffMinutes} minutes ago`;
    }
    return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
  }

  if (diffDays < 7) {
    return diffDays === 1 ? 'Yesterday' : `${diffDays} days ago`;
  }

  return null;
}
