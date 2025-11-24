/**
 * Request payload for scraping a class section
 */
export interface ScrapeRequest {
  sectionNumber: string;
  term: string;
}

/**
 * Detailed information about a class section
 */
export interface ClassDetails {
  subject: string;
  catalog_nbr: string;
  title: string;
  instructor?: string;
  seats_available?: number;
  seats_capacity?: number;
  non_reserved_seats?: number | null; // null = couldn't determine reserved status
  location?: string;
  meeting_times?: string;
}

/**
 * Response from the scrape endpoint
 */
export interface ScrapeResponse {
  success: boolean;
  data?: ClassDetails;
  error?: string;
}

/**
 * Express request with authentication
 */
export interface AuthenticatedRequest extends Express.Request {
  isAuthenticated?: boolean;
}
