export type AsuSeason = "spring" | "summer" | "fall";

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

const ASU_TIMEZONE = "America/Phoenix";

const PHOENIX_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: ASU_TIMEZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

const SEASON_SUFFIX = {
  spring: 1,
  summer: 4,
  fall: 7,
} as const satisfies Record<AsuSeason, number>;

const SEASON_LABEL = {
  spring: "Spring",
  summer: "Summer",
  fall: "Fall",
} as const satisfies Record<AsuSeason, string>;

// Day numbers as returned by Date#getUTCDay.
const MONDAY = 1;
const THURSDAY = 4;
const FRIDAY = 5;
const SATURDAY = 6;

/** The first `weekday` on or after `month`/`day`, `yearOffset` years from the term year. */
interface WeekdayRule {
  yearOffset: number;
  month: number;
  day: number;
  weekday: number;
}

type TermDateField = "catalogAvailable" | "sessionStart" | "sessionEnd";

const SEASONS = ["spring", "summer", "fall"] as const satisfies readonly AsuSeason[];

// Earliest term the app has served; past-term sweeps start here.
const FIRST_TERM_YEAR = 2025;

// Derived from ASU's published calendars. Selectable windows overlap by months
// (fall opens in Feb, spring in Sep), so a rule that lands a few days off
// never leaves a day without a selectable term.
const SEASON_RULES = {
  spring: {
    catalogAvailable: { yearOffset: -1, month: 9, day: 20, weekday: MONDAY },
    sessionStart: { yearOffset: 0, month: 1, day: 10, weekday: MONDAY },
    sessionEnd: { yearOffset: 0, month: 5, day: 6, weekday: SATURDAY },
  },
  summer: {
    catalogAvailable: { yearOffset: 0, month: 2, day: 3, weekday: THURSDAY },
    sessionStart: { yearOffset: 0, month: 5, day: 15, weekday: MONDAY },
    sessionEnd: { yearOffset: 0, month: 8, day: 10, weekday: FRIDAY },
  },
  fall: {
    catalogAvailable: { yearOffset: 0, month: 2, day: 21, weekday: MONDAY },
    sessionStart: { yearOffset: 0, month: 8, day: 17, weekday: THURSDAY },
    sessionEnd: { yearOffset: 0, month: 12, day: 10, weekday: SATURDAY },
  },
} as const satisfies Record<AsuSeason, Record<TermDateField, WeekdayRule>>;

// Hand-entered dates, keyed by term code, that the rules above do not produce.
const TERM_DATE_OVERRIDES = new Map<string, Partial<Record<TermDateField, DateParts>>>([
  ["2251", { sessionEnd: { year: 2025, month: 5, day: 9 } }],
  ["2254", { sessionEnd: { year: 2025, month: 8, day: 12 } }],
  ["2281", { sessionEnd: { year: 2028, month: 5, day: 7 } }],
  ["2284", { sessionEnd: { year: 2028, month: 8, day: 12 } }],
  ["2287", { sessionEnd: { year: 2028, month: 12, day: 10 } }],
]);

function resolveWeekdayRule(year: number, rule: WeekdayRule): DateParts {
  const date = new Date(Date.UTC(year + rule.yearOffset, rule.month - 1, rule.day));

  date.setUTCDate(date.getUTCDate() + ((rule.weekday - date.getUTCDay() + 7) % 7));

  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function generateTerm(year: number, season: AsuSeason): AsuTerm {
  const code = encodeTermCode(year, season);
  const rules = SEASON_RULES[season];
  const overrides = TERM_DATE_OVERRIDES.get(code);

  return {
    code,
    label: `${SEASON_LABEL[season]} ${year}`,
    season,
    year,
    catalogAvailable:
      overrides?.catalogAvailable ?? resolveWeekdayRule(year, rules.catalogAvailable),
    sessionStart: overrides?.sessionStart ?? resolveWeekdayRule(year, rules.sessionStart),
    sessionEnd: overrides?.sessionEnd ?? resolveWeekdayRule(year, rules.sessionEnd),
  };
}

function generateTerms(fromYear: number, toYear: number): AsuTerm[] {
  const terms: AsuTerm[] = [];

  for (let year = fromYear; year <= toYear; year++) {
    for (const season of SEASONS) terms.push(generateTerm(year, season));
  }

  return terms;
}

function encodeTermCode(year: number, season: AsuSeason): string {
  const yy = year % 100;

  return `2${String(yy).padStart(2, "0")}${SEASON_SUFFIX[season]}`;
}

function compareDateParts(a: DateParts, b: DateParts): number {
  if (a.year !== b.year) return a.year - b.year;

  if (a.month !== b.month) return a.month - b.month;

  return a.day - b.day;
}

function getPhoenixDateParts(now: Date = new Date()): DateParts {
  const parts = PHOENIX_DATE_FORMATTER.formatToParts(now);
  const lookup = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);

  return {
    year: lookup("year"),
    month: lookup("month"),
    day: lookup("day"),
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
    case "fall":
      return { season: "spring", year: year + 1 } satisfies { season: AsuSeason; year: number };
    case "spring":
      return { season: "summer", year } satisfies { season: AsuSeason; year: number };
    case "summer":
      return { season: "fall", year } satisfies { season: AsuSeason; year: number };
  }
}

const TERM_CODE_PATTERN = /^2(\d{2})([147])$/;

function findTermByCode(code: string): AsuTerm | undefined {
  const match = TERM_CODE_PATTERN.exec(code);
  const season = SEASONS.find((s) => String(SEASON_SUFFIX[s]) === match?.[2]);

  return match && season ? generateTerm(2000 + Number(match[1]), season) : undefined;
}

/** Uses the same season/year label as term options, preserving unknown codes. */
export function getTermLabel(code: string): string {
  return findTermByCode(code)?.label ?? code;
}

export function getSelectableTerms(now: Date = new Date()): AsuTerm[] {
  const today = getPhoenixDateParts(now);

  // Last year's fall through next year's spring covers every term open today.
  const selectable = generateTerms(today.year - 1, today.year + 1).filter((t) =>
    isSelectable(t, today),
  );

  if (selectable.length === 0) {
    return [];
  }

  const inSession = selectable.find((t) => isInSession(t, today));
  const current = inSession ?? selectable[0];

  const { season: nextSeason, year: nextYear } = getNextSeason(current.season, current.year);
  const nextCandidate = generateTerm(nextYear, nextSeason);

  if (isSelectable(nextCandidate, today)) {
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

  return generateTerms(FIRST_TERM_YEAR, today.year).flatMap((t) =>
    isEntryPast(t, today) ? [t.code] : [],
  );
}

export function formatTermOption(termEntry: AsuTerm): string {
  return `${termEntry.label} (${termEntry.code})`;
}
