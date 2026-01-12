import { describe, expect, it } from 'vitest';
import { getRateMyProfessorUrl, isValidProfessorName } from '@/lib/utils/ratemyprofessor';

const ASU_SCHOOL_ID = '15723';

describe('RateMyProfessor utilities', () => {
  describe('isValidProfessorName', () => {
    describe('valid professor names', () => {
      it('should return true for normal professor names', () => {
        expect(isValidProfessorName('James Gordon')).toBe(true);
        expect(isValidProfessorName('John Smith')).toBe(true);
        expect(isValidProfessorName('Dr. Jane Doe')).toBe(true);
      });

      it('should return true for names with special characters', () => {
        expect(isValidProfessorName("O'Connor")).toBe(true);
        expect(isValidProfessorName('García-López')).toBe(true);
        expect(isValidProfessorName('Müller')).toBe(true);
      });

      it('should return true for single word names', () => {
        expect(isValidProfessorName('Madonna')).toBe(true);
        expect(isValidProfessorName('Prince')).toBe(true);
      });

      it('should handle names with extra whitespace', () => {
        expect(isValidProfessorName('  John Smith  ')).toBe(true);
        expect(isValidProfessorName('  Jane   Doe  ')).toBe(true);
      });
    });

    describe('invalid professor names', () => {
      it('should return false for null', () => {
        expect(isValidProfessorName(null)).toBe(false);
      });

      it('should return false for undefined', () => {
        expect(isValidProfessorName(undefined)).toBe(false);
      });

      it('should return false for empty string', () => {
        expect(isValidProfessorName('')).toBe(false);
      });

      it('should return false for whitespace only', () => {
        expect(isValidProfessorName('   ')).toBe(false);
        expect(isValidProfessorName('\t')).toBe(false);
        expect(isValidProfessorName('\n')).toBe(false);
      });

      it('should return false for "Staff"', () => {
        expect(isValidProfessorName('Staff')).toBe(false);
        expect(isValidProfessorName('STAFF')).toBe(false);
        expect(isValidProfessorName('staff')).toBe(false);
        expect(isValidProfessorName('  Staff  ')).toBe(false);
      });

      it('should return false for "TBA"', () => {
        expect(isValidProfessorName('TBA')).toBe(false);
        expect(isValidProfessorName('tba')).toBe(false);
        expect(isValidProfessorName('Tba')).toBe(false);
      });

      it('should return false for "TBD"', () => {
        expect(isValidProfessorName('TBD')).toBe(false);
        expect(isValidProfessorName('tbd')).toBe(false);
        expect(isValidProfessorName('Tbd')).toBe(false);
      });

      it('should return false for "To Be Announced"', () => {
        expect(isValidProfessorName('To Be Announced')).toBe(false);
        expect(isValidProfessorName('to be announced')).toBe(false);
        expect(isValidProfessorName('TO BE ANNOUNCED')).toBe(false);
      });

      it('should return false for "To Be Determined"', () => {
        expect(isValidProfessorName('To Be Determined')).toBe(false);
        expect(isValidProfessorName('to be determined')).toBe(false);
        expect(isValidProfessorName('TO BE DETERMINED')).toBe(false);
      });
    });
  });

  describe('getRateMyProfessorUrl', () => {
    describe('valid URLs', () => {
      it('should generate correct URL for standard professor name', () => {
        const url = getRateMyProfessorUrl('James Gordon');
        expect(url).toBe(
          `https://www.ratemyprofessors.com/search/professors/${ASU_SCHOOL_ID}?q=James%20Gordon`
        );
      });

      it('should URL encode special characters', () => {
        const url = getRateMyProfessorUrl("O'Connor");
        expect(url).toBe(
          `https://www.ratemyprofessors.com/search/professors/${ASU_SCHOOL_ID}?q=O'Connor`
        );
      });

      it('should URL encode spaces', () => {
        const url = getRateMyProfessorUrl('John Doe');
        expect(url).toContain('John%20Doe');
      });

      it('should handle accented characters', () => {
        const url = getRateMyProfessorUrl('José García');
        expect(url).not.toBeNull();
        expect(url).toContain(encodeURIComponent('José García'));
      });

      it('should trim whitespace from names', () => {
        const url = getRateMyProfessorUrl('  John Smith  ');
        expect(url).toBe(
          `https://www.ratemyprofessors.com/search/professors/${ASU_SCHOOL_ID}?q=John%20Smith`
        );
      });

      it('should use ASU school ID', () => {
        const url = getRateMyProfessorUrl('Any Professor');
        expect(url).toContain(`/professors/${ASU_SCHOOL_ID}`);
      });
    });

    describe('null returns', () => {
      it('should return null for null input', () => {
        expect(getRateMyProfessorUrl(null)).toBeNull();
      });

      it('should return null for undefined input', () => {
        expect(getRateMyProfessorUrl(undefined)).toBeNull();
      });

      it('should return null for empty string', () => {
        expect(getRateMyProfessorUrl('')).toBeNull();
      });

      it('should return null for whitespace only', () => {
        expect(getRateMyProfessorUrl('   ')).toBeNull();
        expect(getRateMyProfessorUrl('\t')).toBeNull();
      });

      it('should return null for "Staff"', () => {
        expect(getRateMyProfessorUrl('Staff')).toBeNull();
        expect(getRateMyProfessorUrl('STAFF')).toBeNull();
        expect(getRateMyProfessorUrl('staff')).toBeNull();
      });
    });

    describe('URL structure validation', () => {
      it('should be a valid URL', () => {
        const url = getRateMyProfessorUrl('Test Professor');
        expect(url).not.toBeNull();
        expect(() => new URL(url!)).not.toThrow();
      });

      it('should use HTTPS protocol', () => {
        const url = getRateMyProfessorUrl('Test Professor');
        expect(url).toMatch(/^https:\/\//);
      });

      it('should point to ratemyprofessors.com', () => {
        const url = getRateMyProfessorUrl('Test Professor');
        const parsedUrl = new URL(url!);
        expect(parsedUrl.hostname).toBe('www.ratemyprofessors.com');
      });

      it('should include query parameter', () => {
        const url = getRateMyProfessorUrl('Test Professor');
        const parsedUrl = new URL(url!);
        expect(parsedUrl.searchParams.has('q')).toBe(true);
      });
    });
  });
});
