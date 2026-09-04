import { describe, expect, it } from 'vite-plus/test';
import { type SectionRef, sectionRefKey } from '@/lib/section-ref';
import type { ClassStateRow, ClassWatchRow } from '@/lib/types/class-watch';
import type { ClassCheckMessage } from '@/lib/types/queue';

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
    const message = {
      class_nbr: '1',
      term: '2261',
      enqueued_at: '',
    } as const;
    const fromMessage: SectionRef = message satisfies ClassCheckMessage;
    const fromState: SectionRef = { class_nbr: '1', term: '2261' } as ClassStateRow;
    const fromWatch: SectionRef = { class_nbr: '1', term: '2261' } as ClassWatchRow;

    expect(fromMessage.class_nbr).toBe(fromState.class_nbr);
    expect(fromMessage.term).toBe(fromState.term);
    expect(fromState.class_nbr).toBe(fromWatch.class_nbr);
    expect(fromState.term).toBe(fromWatch.term);
  });
});
