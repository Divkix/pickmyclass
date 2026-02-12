/**
 * ASU Class Search API Client
 *
 * Direct API client replacing the Puppeteer scraper service.
 * Fetches class details from ASU's class search API.
 */

// --- Error Classes ---

export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class AuthError extends ApiError {
  constructor(message: string) {
    super(message, 401);
    this.name = 'AuthError';
  }
}

export class RateLimitError extends ApiError {
  constructor(message: string) {
    super(message, 429);
    this.name = 'RateLimitError';
  }
}

export class NotFoundError extends ApiError {
  constructor(message: string) {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}

// --- Types ---

export interface ClassDetails {
  subject: string;
  catalog_nbr: string;
  title: string;
  instructor: string;
  seats_available: number;
  seats_capacity: number;
  non_reserved_seats: null;
  location: string;
  meeting_times: string;
}

interface AsuApiEnv {
  ASU_API_BASE_URL: string;
  ASU_API_TOKEN: string;
}

interface AsuApiClassItem {
  CLASSNBR: string;
  SUBJECT: string;
  CATALOGNBR: string;
  TITLE?: string;
  COURSETITLELONG?: string;
  INSTRUCTORS?: Array<{ NAME?: string }>;
  ENRLCAP?: number;
  ENRLTOT?: number;
  FACILITYID?: string;
  MON?: string;
  TUES?: string;
  WED?: string;
  THURS?: string;
  FRI?: string;
  STARTTIME?: string;
  ENDTIME?: string;
  WAITTOT?: number;
  WAITCAP?: number;
}

// --- Helpers ---

function formatTime(time: string): string {
  const [hourStr, minuteStr] = time.split(':');
  let hour = Number.parseInt(hourStr, 10);
  const minute = minuteStr || '00';
  const period = hour >= 12 ? 'PM' : 'AM';
  if (hour === 0) hour = 12;
  else if (hour > 12) hour -= 12;
  return `${hour}:${minute} ${period}`;
}

function composeMeetingTimes(item: AsuApiClassItem): string {
  const days: string[] = [];
  if (item.MON === 'Y') days.push('M');
  if (item.TUES === 'Y') days.push('Tu');
  if (item.WED === 'Y') days.push('W');
  if (item.THURS === 'Y') days.push('Th');
  if (item.FRI === 'Y') days.push('F');

  if (days.length === 0 || !item.STARTTIME || !item.ENDTIME) {
    return 'TBD';
  }

  return `${days.join('')} ${formatTime(item.STARTTIME)}-${formatTime(item.ENDTIME)}`;
}

function mapToClassDetails(item: AsuApiClassItem): ClassDetails {
  return {
    subject: item.SUBJECT,
    catalog_nbr: item.CATALOGNBR,
    title: item.COURSETITLELONG || item.TITLE || 'Unknown',
    instructor: item.INSTRUCTORS?.[0]?.NAME || 'Staff',
    seats_available: Math.max(0, (item.ENRLCAP ?? 0) - (item.ENRLTOT ?? 0)),
    seats_capacity: item.ENRLCAP ?? 0,
    non_reserved_seats: null,
    location: item.FACILITYID || 'TBD',
    meeting_times: composeMeetingTimes(item),
  };
}

// --- Main Function ---

export async function fetchClassFromASU(
  classNbr: string,
  term: string,
  env: AsuApiEnv
): Promise<ClassDetails> {
  const url = `${env.ASU_API_BASE_URL}?classNbr=${classNbr}&term=${term}`;

  const response = await fetch(url, {
    headers: { Authorization: env.ASU_API_TOKEN },
    signal: AbortSignal.timeout(10_000),
  });

  if (response.status === 401 || response.status === 403) {
    throw new AuthError('ASU API token expired or invalid');
  }
  if (response.status === 429) {
    throw new RateLimitError('ASU API rate limit hit');
  }
  if (!response.ok) {
    throw new ApiError(`ASU API returned ${response.status}`, response.status);
  }

  const data = await response.json();
  const results = data as AsuApiClassItem[];

  if (!results || results.length === 0) {
    throw new NotFoundError(`Section ${classNbr} not found`);
  }

  return mapToClassDetails(results[0]);
}
