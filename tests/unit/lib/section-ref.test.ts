import { describe, expect, it } from 'vite-plus/test';
import { applySectionRef, type SectionRef, sectionRefKey } from '@/lib/section-ref';
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

describe('structural compatibility', () => {
  it('existing rows and ClassCheckMessage satisfy SectionRef with no wrapping', () => {
    // Compile-time proof: each shape is assignable to SectionRef directly.
    const message = {
      class_nbr: '1',
      term: '2261',
      enqueued_at: '',
    } as const;
    const fromMessage: SectionRef = message satisfies ClassCheckMessage;
    // SAFETY: structural compatibility test with controlled literal; narrow mock to ClassStateRow is safe for SectionRef assignment check
    const fromState: SectionRef = { class_nbr: '1', term: '2261' } as ClassStateRow;
    // SAFETY: structural compatibility test with controlled literal; narrow mock to ClassWatchRow is safe for SectionRef assignment check
    const fromWatch: SectionRef = { class_nbr: '1', term: '2261' } as ClassWatchRow;

    expect(fromMessage.class_nbr).toBe(fromState.class_nbr);
    expect(fromMessage.term).toBe(fromState.term);
    expect(fromState.class_nbr).toBe(fromWatch.class_nbr);
    expect(fromState.term).toBe(fromWatch.term);
  });
});
