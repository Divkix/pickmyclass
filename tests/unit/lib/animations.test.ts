import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { buttonTap, fadeInUp, reduceMotion, staggerContainer, staggerItem } from '@/lib/animations';

describe('Animation variants', () => {
  describe('fadeInUp', () => {
    it('should have fadeInUp with y translation', () => {
      expect(fadeInUp.hidden).toHaveProperty('y', 20);
      expect(fadeInUp.visible).toHaveProperty('y', 0);
    });
  });

  describe('stagger variants', () => {
    it('should have staggerContainer with staggerChildren', () => {
      expect(staggerContainer.visible).toHaveProperty('transition');
      // SAFETY: test narrows staggerContainer.visible to its known transition shape
      const transition = staggerContainer.visible as {
        transition: { staggerChildren: number; delayChildren: number };
      };
      expect(transition.transition.staggerChildren).toBe(0.1);
      expect(transition.transition.delayChildren).toBe(0.1);
    });

    it('should have staggerItem with standard fadeInUp behavior', () => {
      expect(staggerItem.hidden).toHaveProperty('opacity', 0);
      expect(staggerItem.hidden).toHaveProperty('y', 20);
      expect(staggerItem.visible).toHaveProperty('opacity', 1);
      expect(staggerItem.visible).toHaveProperty('y', 0);
    });
  });

  describe('buttonTap', () => {
    it('should scale down on tap', () => {
      expect(buttonTap).toHaveProperty('scale', 0.95);
    });

    it('should have fast transition', () => {
      expect(buttonTap.transition).toHaveProperty('duration', 0.1);
    });
  });

  describe('reduceMotion utility', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          matches: false,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });
    });

    it('should return original variants when reduced motion is not preferred', () => {
      const result = reduceMotion(fadeInUp);
      expect(result).toEqual(fadeInUp);
    });

    it('should modify transitions when reduced motion is preferred', () => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          matches: query === '(prefers-reduced-motion: reduce)',
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });

      const result = reduceMotion(fadeInUp);

      // SAFETY: reduceMotion returns original variant with transition added; cast narrows to asserted shape
      expect((result.hidden as { transition: { duration: number } }).transition.duration).toBe(
        0.01
      );
      // SAFETY: reduceMotion returns original variant with transition added; cast narrows to asserted shape
      expect((result.visible as { transition: { duration: number } }).transition.duration).toBe(
        0.01
      );
    });

    it('should preserve non-transition properties', () => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          matches: query === '(prefers-reduced-motion: reduce)',
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });

      const result = reduceMotion(fadeInUp);

      // SAFETY: result is fadeInUp variant with known opacity field; cast narrows to asserted shape
      expect((result.hidden as { opacity: number }).opacity).toBe(0);
      // SAFETY: result is fadeInUp variant with known y field; cast narrows to asserted shape
      expect((result.hidden as { y: number }).y).toBe(20);
      // SAFETY: result is fadeInUp variant with known opacity field; cast narrows to asserted shape
      expect((result.visible as { opacity: number }).opacity).toBe(1);
      // SAFETY: result is fadeInUp variant with known y field; cast narrows to asserted shape
      expect((result.visible as { y: number }).y).toBe(0);
    });
  });
});
