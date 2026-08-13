/**
 * Canonical class information types used across the application.
 *
 * Consolidates class section data shapes from email templates, ASU API,
 * and API response DTOs into a single source of truth.
 */

/**
 * Core class section information.
 * Used in email templates, API responses, and database operations.
 */
export interface ClassInfo {
  term: string;
  subject: string;
  catalog_nbr: string;
  class_nbr: string;
  title: string;
  instructor_name: string;
  seats_available: number;
  seats_capacity: number;
  non_reserved_seats?: number | null;
  location?: string;
  meeting_times?: string;
}

/**
 * Class details from ASU API (subset of ClassInfo without term/class_nbr).
 * Used in lib/asu/api.ts for raw API response shape.
 */
export interface ClassDetails {
  [key: string]: string | number | null;
  subject: string;
  catalog_nbr: string;
  title: string;
  instructor_name: string;
  seats_available: number;
  seats_capacity: number;
  non_reserved_seats: number | null;
  location: string;
  meeting_times: string;
}

/**
 * API response for fetch-class-details endpoint.
 * Derived from ClassInfo with all fields optional/nullable for API safety.
 */
export type FetchClassDetailsResponse = Partial<
  Pick<
    ClassInfo,
    | 'subject'
    | 'catalog_nbr'
    | 'title'
    | 'instructor_name'
    | 'seats_available'
    | 'seats_capacity'
    | 'location'
    | 'meeting_times'
  >
>;
