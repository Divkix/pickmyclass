export type AsuSeason = 'spring' | 'summer' | 'fall';

interface DateParts {
  year: number;
  month: number;
  day: number;
}

export interface AsuTerm {
  code: string;
  label: string;
  season: AsuSeason;
  year: number;
  catalogAvailable: DateParts;
  sessionStart: DateParts;
  sessionEnd: DateParts;
}

const ASU_TIMEZONE = 'America/Phoenix';

const SEASON_SUFFIX = {
  spring: 1,
  summer: 4,
  fall: 7,
} as const satisfies Record<AsuSeason, number>;

const SEASON_LABEL = {
  spring: 'Spring',
  summer: 'Summer',
  fall: 'Fall',
} as const satisfies Record<AsuSeason, string>;

const ASU_TERM_CALENDAR: AsuTerm[] = [
  term(
    2025,
    'spring',
    { year: 2024, month: 9, day: 23 },
    { year: 2025, month: 1, day: 13 },
    { year: 2025, month: 5, day: 9 }
  ),
  term(
    2025,
    'summer',
    { year: 2025, month: 2, day: 6 },
    { year: 2025, month: 5, day: 19 },
    { year: 2025, month: 8, day: 12 }
  ),
  term(
    2025,
    'fall',
    { year: 2025, month: 2, day: 24 },
    { year: 2025, month: 8, day: 21 },
    { year: 2025, month: 12, day: 13 }
  ),
  term(
    2026,
    'spring',
    { year: 2025, month: 9, day: 22 },
    { year: 2026, month: 1, day: 12 },
    { year: 2026, month: 5, day: 9 }
  ),
  term(
    2026,
    'summer',
    { year: 2026, month: 2, day: 5 },
    { year: 2026, month: 5, day: 18 },
    { year: 2026, month: 8, day: 14 }
  ),
  term(
    2026,
    'fall',
    { year: 2026, month: 2, day: 23 },
    { year: 2026, month: 8, day: 20 },
    { year: 2026, month: 12, day: 12 }
  ),
  term(
    2027,
    'spring',
    { year: 2026, month: 9, day: 21 },
    { year: 2027, month: 1, day: 11 },
    { year: 2027, month: 5, day: 8 }
  ),
  term(
    2027,
    'summer',
    { year: 2027, month: 2, day: 4 },
    { year: 2027, month: 5, day: 17 },
    { year: 2027, month: 8, day: 13 }
  ),
  term(
    2027,
    'fall',
    { year: 2027, month: 2, day: 22 },
    { year: 2027, month: 8, day: 19 },
    { year: 2027, month: 12, day: 11 }
  ),
  term(
    2028,
    'spring',
    { year: 2027, month: 9, day: 20 },
    { year: 2028, month: 1, day: 10 },
    { year: 2028, month: 5, day: 7 }
  ),
  term(
    2028,
    'summer',
    { year: 2028, month: 2, day: 3 },
    { year: 2028, month: 5, day: 15 },
    { year: 2028, month: 8, day: 12 }
  ),
  term(
    2028,
    'fall',
    { year: 2028, month: 2, day: 21 },
    { year: 2028, month: 8, day: 17 },
    { year: 2028, month: 12, day: 10 }
  ),
];

function term(
  year: number,
  season: AsuSeason,
  catalogAvailable: DateParts,
  sessionStart: DateParts,
  sessionEnd: DateParts
): AsuTerm {
  const code = encodeTermCode(year, season);
  return {
    code,
    label: `${SEASON_LABEL[season]} ${year}`,
    season,
    year,
    catalogAvailable,
    sessionStart,
    sessionEnd,
  };
}

export function encodeTermCode(year: number, season: AsuSeason): string {
  const yy = year % 100;
  return `2${String(yy).padStart(2, '0')}${SEASON_SUFFIX[season]}`;
}

function compareDateParts(a: DateParts, b: DateParts): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

function getPhoenixDateParts(now: Date = new Date()): DateParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: ASU_TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });

  const parts = formatter.formatToParts(now);
  const lookup = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);

  return {
    year: lookup('year'),
    month: lookup('month'),
    day: lookup('day'),
  };
}

function isOnOrAfter(today: DateParts, target: DateParts): boolean {
  return compareDateParts(today, target) >= 0;
}

function isOnOrBefore(today: DateParts, target: DateParts): boolean {
  return compareDateParts(today, target) <= 0;
}

function isInSession(term: AsuTerm, today: DateParts): boolean {
  return isOnOrAfter(today, term.sessionStart) && isOnOrBefore(today, term.sessionEnd);
}

function isSelectable(term: AsuTerm, today: DateParts): boolean {
  return isOnOrAfter(today, term.catalogAvailable) && isOnOrBefore(today, term.sessionEnd);
}

function getNextSeason(season: AsuSeason, year: number) {
  switch (season) {
    case 'fall':
      return { season: 'spring', year: year + 1 } satisfies { season: AsuSeason; year: number };
    case 'spring':
      return { season: 'summer', year } satisfies { season: AsuSeason; year: number };
    case 'summer':
      return { season: 'fall', year } satisfies { season: AsuSeason; year: number };
  }
}

function findTerm(season: AsuSeason, year: number): AsuTerm | undefined {
  return ASU_TERM_CALENDAR.find((t) => t.season === season && t.year === year);
}

function findTermByCode(code: string): AsuTerm | undefined {
  return ASU_TERM_CALENDAR.find((t) => t.code === code);
}

export function getSelectableTerms(now: Date = new Date()): AsuTerm[] {
  const today = getPhoenixDateParts(now);
  const selectable = ASU_TERM_CALENDAR.filter((t) => isSelectable(t, today));

  if (selectable.length === 0) {
    return [];
  }

  const inSession = selectable.find((t) => isInSession(t, today));
  const current = inSession ?? selectable[0];

  const { season: nextSeason, year: nextYear } = getNextSeason(current.season, current.year);
  const nextCandidate = findTerm(nextSeason, nextYear);

  if (nextCandidate && isSelectable(nextCandidate, today) && nextCandidate.code !== current.code) {
    return [current, nextCandidate];
  }

  return [current];
}

export function isTermSelectable(code: string, now: Date = new Date()): boolean {
  const termEntry = findTermByCode(code);
  if (!termEntry) {
    return false;
  }

  const today = getPhoenixDateParts(now);
  return isSelectable(termEntry, today);
}

function isEntryPast(termEntry: AsuTerm, today: DateParts): boolean {
  return compareDateParts(today, termEntry.sessionEnd) > 0;
}

export function getPastTermCodes(now: Date = new Date()): string[] {
  const today = getPhoenixDateParts(now);
  return ASU_TERM_CALENDAR.filter((t) => isEntryPast(t, today)).map((t) => t.code);
}

export function formatTermOption(termEntry: AsuTerm): string {
  return `${termEntry.label} (${termEntry.code})`;
}
