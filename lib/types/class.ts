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
  /** ASU class dates as YYYY-MM-DD (America/Phoenix); null when ASU omits them. */
  start_date: string | null;
  end_date: string | null;
  session_code: string | null;
}
