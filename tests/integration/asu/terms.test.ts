import { describe, expect, it } from "vite-plus/test";
import {
  type AsuSeason,
  generateTerm,
  getPastTermCodes,
  getSelectableTerms,
  getTermLabel,
  isTermSelectable,
} from "@/lib/asu/terms";

const DAY_MS = 86_400_000;

// Phoenix is UTC-7 year-round, so 19:00Z is local noon.
function phoenixNoon(date: string): Date {
  return new Date(`${date}T19:00:00Z`);
}

function parts(date: string) {
  const [year, month, day] = date.split("-").map(Number);

  return { year, month, day };
}

function dayNumber(date: { year: number; month: number; day: number }): number {
  return Date.UTC(date.year, date.month - 1, date.day) / DAY_MS;
}

// The hand-maintained calendar this generator replaced, verbatim.
const HAND_WRITTEN_CALENDAR: [number, AsuSeason, string, string, string][] = [
  [2025, "spring", "2024-09-23", "2025-01-13", "2025-05-09"],
  [2025, "summer", "2025-02-06", "2025-05-19", "2025-08-12"],
  [2025, "fall", "2025-02-24", "2025-08-21", "2025-12-13"],
  [2026, "spring", "2025-09-22", "2026-01-12", "2026-05-09"],
  [2026, "summer", "2026-02-05", "2026-05-18", "2026-08-14"],
  [2026, "fall", "2026-02-23", "2026-08-20", "2026-12-12"],
  [2027, "spring", "2026-09-21", "2027-01-11", "2027-05-08"],
  [2027, "summer", "2027-02-04", "2027-05-17", "2027-08-13"],
  [2027, "fall", "2027-02-22", "2027-08-19", "2027-12-11"],
  [2028, "spring", "2027-09-20", "2028-01-10", "2028-05-07"],
  [2028, "summer", "2028-02-03", "2028-05-15", "2028-08-12"],
  [2028, "fall", "2028-02-21", "2028-08-17", "2028-12-10"],
];

const SEASON_LABEL = { spring: "Spring", summer: "Summer", fall: "Fall" };
const SEASON_SUFFIX = { spring: "1", summer: "4", fall: "7" };

describe("ASU term calendar", () => {
  it.each(HAND_WRITTEN_CALENDAR)(
    "reproduces the hand-written %s %s entry",
    (year, season, catalogAvailable, sessionStart, sessionEnd) => {
      expect(generateTerm(year, season)).toEqual({
        code: `2${year % 100}${SEASON_SUFFIX[season]}`,
        label: `${SEASON_LABEL[season]} ${year}`,
        season,
        year,
        catalogAvailable: parts(catalogAvailable),
        sessionStart: parts(sessionStart),
        sessionEnd: parts(sessionEnd),
      });
    },
  );

  it.each([
    [2026, "fall", "2026-08-20", "2026-12-12"],
    [2027, "spring", "2027-01-11", "2027-05-08"],
    [2027, "summer", "2027-05-17", "2027-08-10"],
    [2027, "fall", "2027-08-19", null],
  ] satisfies [number, AsuSeason, string, string | null][])(
    "matches ASU's published %s %s dates",
    (year, season, firstDay, lastDay) => {
      const term = generateTerm(year, season);

      expect(term.sessionStart).toEqual(parts(firstDay));

      if (lastDay)
        expect(dayNumber(term.sessionEnd)).toBeGreaterThanOrEqual(dayNumber(parts(lastDay)));
    },
  );

  it("keeps a month of overlap between consecutive selectable windows", () => {
    const seasons: AsuSeason[] = ["spring", "summer", "fall"];

    const terms = Array.from({ length: 2100 - 2025 }, (_, i) => 2025 + i).flatMap((year) =>
      seasons.map((season) => generateTerm(year, season)),
    );

    for (let i = 1; i < terms.length; i++) {
      const overlapDays = dayNumber(terms[i - 1].sessionEnd) - dayNumber(terms[i].catalogAvailable);

      expect(overlapDays, terms[i].code).toBeGreaterThanOrEqual(30);
    }
  });

  it("offers a selectable term on every Phoenix day through 2045", () => {
    for (let day = dayNumber(parts("2025-01-01")); day <= dayNumber(parts("2045-12-31")); day++) {
      const now = new Date(day * DAY_MS + 19 * 3_600_000);
      const terms = getSelectableTerms(now);

      expect(terms.length, now.toISOString()).toBeGreaterThan(0);

      for (const term of terms) expect(isTermSelectable(term.code, now)).toBe(true);
    }
  });

  it.each([
    ["2026-10-17", ["2267", "2271"]],
    ["2027-01-20", ["2271"]],
    ["2027-03-01", ["2271", "2274"]],
    ["2031-03-01", ["2311", "2314"]],
    ["2040-12-01", ["2407", "2411"]],
  ])("selects the current and next term on %s", (date, codes) => {
    expect(getSelectableTerms(phoenixNoon(date)).map((t) => t.code)).toEqual(codes);
  });

  it("closes a term after its last day in Phoenix time", () => {
    expect(isTermSelectable("2267", new Date("2026-12-13T06:59:59Z"))).toBe(true);
    expect(isTermSelectable("2267", new Date("2026-12-13T07:00:00Z"))).toBe(false);
    expect(getPastTermCodes(new Date("2026-12-13T07:00:00Z"))).toContain("2267");
  });

  it.each(["", "2262", "226", "22671", "abcd", "3267"])(
    "rejects malformed term code %j",
    (code) => {
      expect(isTermSelectable(code, phoenixNoon("2026-10-17"))).toBe(false);
    },
  );

  it.each([
    ["2271", "Spring 2027"],
    ["2264", "Summer 2026"],
    ["2257", "Fall 2025"],
    ["2262", "2262"],
    ["unknown", "unknown"],
  ])("labels term %j without hiding unknown codes", (code, label) => {
    expect(getTermLabel(code)).toBe(label);
  });

  it("lists every past term since the first served term", () => {
    expect(getPastTermCodes(phoenixNoon("2026-10-17"))).toEqual([
      "2251",
      "2254",
      "2257",
      "2261",
      "2264",
    ]);
    expect(getPastTermCodes(phoenixNoon("2031-09-01"))).toHaveLength(6 * 3 + 2);
  });
});
