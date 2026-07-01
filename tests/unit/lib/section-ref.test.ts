import { describe, expect, it } from 'vite-plus/test';
import {
  applySectionRef,
  type SectionRef,
  sectionRefEquals,
  sectionRefKey,
} from '@/lib/section-ref';
import type { ClassStateRow, ClassWatchRow } from '@/lib/types/class-watch';
import type { ClassCheckMessage } from '@/lib/types/queue';

/**
 * Records every `.eq(column, value)` call and returns itself for chaining,
 * mirroring the shape of a Supabase query/filter builder.
 */
class FakeQueryBuilder {
  readonly calls: Array<{ column: string; value: string }> = [];

  eq(column: 'class_nbr' | 'term', value: string): this {
    this.calls.push({ column, value });
    return this;
  }
}

describe('applySectionRef', () => {
  it('applies both class_nbr and term equality filters', () => {
    const query = new FakeQueryBuilder();
    const ref: SectionRef = { class_nbr: '12431', term: '2261' };

    applySectionRef(query, ref);

    expect(query.calls).toEqual([
      { column: 'class_nbr', value: '12431' },
      { column: 'term', value: '2261' },
    ]);
  });

  it('returns the same builder for chaining', () => {
    const query = new FakeQueryBuilder();

    const result = applySectionRef(query, { class_nbr: '12431', term: '2261' });

    expect(result).toBe(query);
  });
});

describe('sectionRefKey', () => {
  it('derives a term:class_nbr key from both fields', () => {
    expect(sectionRefKey({ class_nbr: '12431', term: '2261' })).toBe('2261:12431');
  });

  it('distinguishes the same class_nbr across different terms', () => {
    const current = sectionRefKey({ class_nbr: '12431', term: '2261' });
    const next = sectionRefKey({ class_nbr: '12431', term: '2267' });

    expect(current).not.toBe(next);
  });
});

describe('sectionRefEquals', () => {
  it('is true when both fields match', () => {
    expect(
      sectionRefEquals({ class_nbr: '12431', term: '2261' }, { class_nbr: '12431', term: '2261' })
    ).toBe(true);
  });

  it('is false when the class_nbr differs', () => {
    expect(
      sectionRefEquals({ class_nbr: '12431', term: '2261' }, { class_nbr: '99999', term: '2261' })
    ).toBe(false);
  });

  it('is false when the term differs', () => {
    expect(
      sectionRefEquals({ class_nbr: '12431', term: '2261' }, { class_nbr: '12431', term: '2267' })
    ).toBe(false);
  });
});

describe('structural compatibility', () => {
  it('existing rows and ClassCheckMessage satisfy SectionRef with no wrapping', () => {
    // Compile-time proof: each shape is assignable to SectionRef directly.
    const message = {
      class_nbr: '1',
      term: '2261',
      enqueued_at: '',
      stagger_group: 'even',
    } as const;
    const fromMessage: SectionRef = message satisfies ClassCheckMessage;
    const fromState: SectionRef = { class_nbr: '1', term: '2261' } as ClassStateRow;
    const fromWatch: SectionRef = { class_nbr: '1', term: '2261' } as ClassWatchRow;

    expect(sectionRefEquals(fromMessage, fromState)).toBe(true);
    expect(sectionRefEquals(fromState, fromWatch)).toBe(true);
  });
});
