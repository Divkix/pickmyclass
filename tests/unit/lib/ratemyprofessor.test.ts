import { describe, expect, it } from 'vite-plus/test';
import { getRateMyProfessorUrl } from '@/lib/utils/ratemyprofessor';

describe('getRateMyProfessorUrl', () => {
  it('builds an ASU professor search URL', () => {
    expect(getRateMyProfessorUrl('James Gordon')).toBe(
      'https://www.ratemyprofessors.com/search/professors/15723?q=James%20Gordon'
    );
  });

  it('trims and encodes professor names', () => {
    expect(getRateMyProfessorUrl('  José García  ')).toContain(
      `q=${encodeURIComponent('José García')}`
    );
  });

  it.each([null, undefined, '', ' \t '])('rejects an empty name: %s', (name) => {
    expect(getRateMyProfessorUrl(name)).toBeNull();
  });

  it.each(['Staff', ' staff ', 'TBA', 'tbd', 'To Be Announced', 'TO BE DETERMINED'])(
    'rejects placeholder instructor name: %s',
    (name) => {
      expect(getRateMyProfessorUrl(name)).toBeNull();
    }
  );
});
