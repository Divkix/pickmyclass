import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { createClassWatchSchema } from '@/lib/api/schemas';
import {
  encodeTermCode,
  formatTermOption,
  getSelectableTerms,
  isTermSelectable,
} from '@/lib/asu/terms';

function phoenixDate(year: number, month: number, day: number): Date {
  // Noon UTC avoids edge cases around midnight in America/Phoenix (UTC-7, no DST)
  return new Date(Date.UTC(year, month - 1, day, 19, 0, 0));
}

function termCodes(terms: ReturnType<typeof getSelectableTerms>): string[] {
  return terms.map((t) => t.code);
}

describe('encodeTermCode', () => {
  it('encodes spring, summer, and fall term codes', () => {
    expect(encodeTermCode(2026, 'spring')).toBe('2261');
    expect(encodeTermCode(2026, 'summer')).toBe('2264');
    expect(encodeTermCode(2026, 'fall')).toBe('2267');
  });
});

describe('formatTermOption', () => {
  it('formats term for dropdown display', () => {
    const terms = getSelectableTerms(phoenixDate(2026, 5, 23));
    expect(formatTermOption(terms[0])).toMatch(/\(2264\)/);
  });
});

describe('getSelectableTerms', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns Spring 2026 only before Summer catalog is available', () => {
    vi.setSystemTime(phoenixDate(2026, 1, 15));
    expect(termCodes(getSelectableTerms())).toEqual(['2261']);
  });

  it('returns Spring and Summer when both are selectable', () => {
    vi.setSystemTime(phoenixDate(2026, 2, 10));
    expect(termCodes(getSelectableTerms())).toEqual(['2261', '2264']);
  });

  it('returns Summer and Fall during Summer session', () => {
    vi.setSystemTime(phoenixDate(2026, 5, 23));
    expect(termCodes(getSelectableTerms())).toEqual(['2264', '2267']);
  });

  it('returns Fall only before Spring catalog is available', () => {
    vi.setSystemTime(phoenixDate(2026, 8, 25));
    expect(termCodes(getSelectableTerms())).toEqual(['2267']);
  });

  it('returns Fall and Spring 2027 when both are selectable', () => {
    vi.setSystemTime(phoenixDate(2026, 9, 25));
    expect(termCodes(getSelectableTerms())).toEqual(['2267', '2271']);
  });

  it('returns Spring 2027 only during winter gap', () => {
    vi.setSystemTime(phoenixDate(2026, 12, 20));
    expect(termCodes(getSelectableTerms())).toEqual(['2271']);
  });

  it('never returns more than two terms', () => {
    vi.setSystemTime(phoenixDate(2026, 5, 23));
    expect(getSelectableTerms().length).toBeLessThanOrEqual(2);
  });
});

describe('isTermSelectable', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true for a currently selectable term', () => {
    vi.setSystemTime(phoenixDate(2026, 5, 23));
    expect(isTermSelectable('2264')).toBe(true);
    expect(isTermSelectable('2267')).toBe(true);
  });

  it('returns false for an expired term', () => {
    vi.setSystemTime(phoenixDate(2026, 5, 23));
    expect(isTermSelectable('2261')).toBe(false);
  });

  it('returns false for unknown term codes', () => {
    vi.setSystemTime(phoenixDate(2026, 5, 23));
    expect(isTermSelectable('9999')).toBe(false);
  });
});

describe('createClassWatchSchema term validation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(phoenixDate(2026, 5, 23));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts a selectable term', () => {
    const result = createClassWatchSchema.safeParse({ term: '2264', class_nbr: '12345' });
    expect(result.success).toBe(true);
  });

  it('rejects an expired term', () => {
    const result = createClassWatchSchema.safeParse({ term: '2261', class_nbr: '12345' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('no longer available');
    }
  });
});
