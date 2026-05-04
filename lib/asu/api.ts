/**
 * ASU Class Search API Client
 *
 * Direct API client replacing the Puppeteer scraper service.
 * Fetches class details from ASU's class search API.
 */

import { TtlCache } from '@/lib/cache/ttl-cache';

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

import type { ClassDetails } from '@/lib/types/class';
import type { Env } from '@/lib/types/env';

export type { ClassDetails };

type AsuApiEnv = Pick<Env, 'ASU_API_BASE_URL' | 'ASU_API_TOKEN'>;

interface AsuApiClassItem {
  CLASSNBR: string;
  SUBJECT: string;
  CATALOGNBR: string;
  TITLE?: string;
  COURSETITLELONG?: string;
  INSTRUCTORSLIST?: string[];
  ENRLCAP?: string;
  ENRLTOT?: string;
  FACILITYID?: string;
  MON?: string;
  TUES?: string;
  WED?: string;
  THURS?: string;
  FRI?: string;
  STARTTIME?: string | null;
  ENDTIME?: string | null;
  WAITTOT?: string;
  WAITCAP?: string;
}

/** Elasticsearch response envelope from ASU API */
interface AsuApiResponse {
  hits: {
    total: { value: number };
    hits: Array<{ _source: AsuApiClassItem }>;
  };
}

// --- Helpers ---

const CLASS_SEARCH_ENDPOINT_PATH = '/search/classes';

const asuApiCache = new TtlCache<ClassDetails>(2 * 60 * 1000);

/** Clear the in-memory ASU API cache. Exposed for test isolation. */
export function clearAsuApiCache(): void {
  asuApiCache.clear();
}

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
  const enrlCap = Number.parseInt(item.ENRLCAP || '0', 10);
  const enrlTot = Number.parseInt(item.ENRLTOT || '0', 10);
  const waitTot = Number.parseInt(item.WAITTOT || '0', 10);

  return {
    subject: item.SUBJECT,
    catalog_nbr: item.CATALOGNBR,
    title: item.COURSETITLELONG || item.TITLE || 'Unknown',
    instructor: item.INSTRUCTORSLIST?.[0] || 'Staff',
    seats_available: Math.max(0, enrlCap - enrlTot),
    seats_capacity: enrlCap,
    non_reserved_seats: Math.max(0, enrlCap - enrlTot - waitTot),
    location: item.FACILITYID || 'TBD',
    meeting_times: composeMeetingTimes(item),
  };
}

function buildClassSearchUrl(baseUrl: string, classNbr: string, term: string): string {
  const url = new URL(baseUrl);
  const trimmedPath = url.pathname.replace(/\/+$/, '');
  const endpointPath = trimmedPath.endsWith(CLASS_SEARCH_ENDPOINT_PATH)
    ? trimmedPath
    : `${trimmedPath}${CLASS_SEARCH_ENDPOINT_PATH}`;

  url.pathname = endpointPath;
  url.searchParams.set('classNbr', classNbr);
  url.searchParams.set('term', term);

  return url.toString();
}

function normalizeAuthHeader(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length === 0) return trimmed;
  if (/^Bearer\s+/i.test(trimmed)) return trimmed;
  return `Bearer ${trimmed}`;
}

// --- Main Function ---

export async function fetchClassFromASU(
  classNbr: string,
  term: string,
  env: AsuApiEnv
): Promise<ClassDetails> {
  if (!env.ASU_API_BASE_URL || !env.ASU_API_TOKEN) {
    throw new ApiError('ASU API environment variables not configured');
  }

  const cacheKey = `${classNbr}:${term}`;
  const cached = asuApiCache.get(cacheKey);
  if (cached) return cached;

  const url = buildClassSearchUrl(env.ASU_API_BASE_URL, classNbr, term);
  const authHeader = normalizeAuthHeader(env.ASU_API_TOKEN);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new ApiError('ASU API request timed out', 408);
    }
    throw error;
  }

  if (response.status === 401 || response.status === 403) {
    throw new AuthError('ASU API token expired or invalid');
  }
  if (response.status === 429) {
    throw new RateLimitError('ASU API rate limit hit');
  }
  if (!response.ok) {
    throw new ApiError(`ASU API returned ${response.status}`, response.status);
  }

  const data = (await response.json()) as AsuApiResponse;
  const hits = data?.hits?.hits;

  if (!hits || hits.length === 0) {
    throw new NotFoundError(`Section ${classNbr} not found`);
  }

  // Find the hit that matches the requested classNbr (handles fuzzy matches)
  const matchingHit = hits.find((h) => h._source.CLASSNBR === classNbr);
  if (!matchingHit) {
    throw new NotFoundError(`Section ${classNbr} not found in response`);
  }

  const result = mapToClassDetails(matchingHit._source);
  asuApiCache.set(cacheKey, result);
  return result;
}
