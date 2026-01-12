import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils';

describe('cn - Tailwind class merging utility', () => {
  describe('basic class concatenation', () => {
    it('should merge multiple class strings', () => {
      const result = cn('foo', 'bar', 'baz');
      expect(result).toBe('foo bar baz');
    });

    it('should handle single class', () => {
      const result = cn('single-class');
      expect(result).toBe('single-class');
    });

    it('should return empty string for no arguments', () => {
      const result = cn();
      expect(result).toBe('');
    });
  });

  describe('conditional classes', () => {
    it('should handle conditional classes with boolean', () => {
      const isActive = true;
      const result = cn('base', isActive && 'active');
      expect(result).toBe('base active');
    });

    it('should filter out falsy values', () => {
      const result = cn('base', false, null, undefined, 'valid');
      expect(result).toBe('base valid');
    });

    it('should handle object syntax', () => {
      const result = cn({
        base: true,
        active: true,
        disabled: false,
      });
      expect(result).toBe('base active');
    });
  });

  describe('Tailwind class conflict resolution', () => {
    it('should merge conflicting padding classes (last wins)', () => {
      const result = cn('p-4', 'p-8');
      expect(result).toBe('p-8');
    });

    it('should merge conflicting margin classes', () => {
      const result = cn('m-2', 'm-6');
      expect(result).toBe('m-6');
    });

    it('should merge conflicting text color classes', () => {
      const result = cn('text-red-500', 'text-blue-500');
      expect(result).toBe('text-blue-500');
    });

    it('should merge conflicting background color classes', () => {
      const result = cn('bg-white', 'bg-gray-100');
      expect(result).toBe('bg-gray-100');
    });

    it('should not merge non-conflicting classes', () => {
      const result = cn('p-4', 'm-4', 'text-red-500', 'bg-white');
      expect(result).toBe('p-4 m-4 text-red-500 bg-white');
    });

    it('should handle responsive variants correctly', () => {
      const result = cn('text-sm', 'md:text-lg', 'text-base');
      expect(result).toBe('md:text-lg text-base');
    });

    it('should handle hover states correctly', () => {
      const result = cn('hover:bg-blue-500', 'hover:bg-red-500');
      expect(result).toBe('hover:bg-red-500');
    });
  });

  describe('array inputs', () => {
    it('should handle array of classes', () => {
      const result = cn(['foo', 'bar', 'baz']);
      expect(result).toBe('foo bar baz');
    });

    it('should handle nested arrays', () => {
      const result = cn(['foo', ['bar', 'baz']]);
      expect(result).toBe('foo bar baz');
    });

    it('should handle mix of arrays and strings', () => {
      const result = cn('first', ['middle1', 'middle2'], 'last');
      expect(result).toBe('first middle1 middle2 last');
    });
  });

  describe('edge cases', () => {
    it('should handle whitespace in class names', () => {
      const result = cn('  foo  ', 'bar');
      expect(result).toBe('foo bar');
    });

    it('should handle empty strings', () => {
      const result = cn('foo', '', 'bar');
      expect(result).toBe('foo bar');
    });

    it('should handle complex real-world usage', () => {
      const isDisabled = false;
      const variant: 'primary' | 'secondary' = 'primary';
      const result = cn(
        'inline-flex items-center justify-center',
        'rounded-md text-sm font-medium',
        variant === 'primary' && 'bg-primary text-primary-foreground',
        variant === 'secondary' && 'bg-secondary text-secondary-foreground',
        isDisabled && 'opacity-50 cursor-not-allowed',
        'px-4 py-2'
      );
      expect(result).toBe(
        'inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground px-4 py-2'
      );
    });
  });
});
