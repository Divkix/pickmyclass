import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buttonTap,
  cardHover,
  checkmarkDraw,
  createStagger,
  fadeIn,
  fadeInDown,
  fadeInLeft,
  fadeInRight,
  fadeInUp,
  modalBackdrop,
  modalContent,
  pageTransition,
  pulse,
  reduceMotion,
  scaleIn,
  scaleInSpring,
  shimmer,
  slideInLeft,
  slideInRight,
  spinnerRotate,
  staggerContainer,
  staggerItem,
  toastSlideIn,
} from '@/lib/animations';

describe('Animation variants', () => {
  describe('fadeIn variants', () => {
    it('should have hidden and visible states for fadeIn', () => {
      expect(fadeIn).toHaveProperty('hidden');
      expect(fadeIn).toHaveProperty('visible');
      expect(fadeIn.hidden).toHaveProperty('opacity', 0);
      expect(fadeIn.visible).toHaveProperty('opacity', 1);
    });

    it('should have fadeInUp with y translation', () => {
      expect(fadeInUp.hidden).toHaveProperty('y', 20);
      expect(fadeInUp.visible).toHaveProperty('y', 0);
    });

    it('should have fadeInDown with negative y translation', () => {
      expect(fadeInDown.hidden).toHaveProperty('y', -20);
      expect(fadeInDown.visible).toHaveProperty('y', 0);
    });

    it('should have fadeInLeft with negative x translation', () => {
      expect(fadeInLeft.hidden).toHaveProperty('x', -20);
      expect(fadeInLeft.visible).toHaveProperty('x', 0);
    });

    it('should have fadeInRight with positive x translation', () => {
      expect(fadeInRight.hidden).toHaveProperty('x', 20);
      expect(fadeInRight.visible).toHaveProperty('x', 0);
    });
  });

  describe('scaleIn variants', () => {
    it('should have scaleIn with scale property', () => {
      expect(scaleIn.hidden).toHaveProperty('scale', 0.8);
      expect(scaleIn.visible).toHaveProperty('scale', 1);
    });

    it('should have scaleInSpring with spring transition', () => {
      expect(scaleInSpring.visible).toHaveProperty('transition');
      const transition = scaleInSpring.visible as { transition: { type: string } };
      expect(transition.transition.type).toBe('spring');
    });
  });

  describe('stagger variants', () => {
    it('should have staggerContainer with staggerChildren', () => {
      expect(staggerContainer.visible).toHaveProperty('transition');
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

  describe('cardHover variant', () => {
    it('should have rest and hover states', () => {
      expect(cardHover).toHaveProperty('rest');
      expect(cardHover).toHaveProperty('hover');
    });

    it('should scale up and move up on hover', () => {
      expect(cardHover.hover).toHaveProperty('scale', 1.02);
      expect(cardHover.hover).toHaveProperty('y', -4);
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

  describe('slide variants', () => {
    it('should have slideInRight with full width translation', () => {
      expect(slideInRight.hidden).toHaveProperty('x', '100%');
      expect(slideInRight.visible).toHaveProperty('x', 0);
      expect(slideInRight.exit).toHaveProperty('x', '-100%');
    });

    it('should have slideInLeft with negative full width translation', () => {
      expect(slideInLeft.hidden).toHaveProperty('x', '-100%');
      expect(slideInLeft.visible).toHaveProperty('x', 0);
      expect(slideInLeft.exit).toHaveProperty('x', '100%');
    });

    it('should use spring transitions for visible state', () => {
      const visibleTransition = slideInRight.visible as { transition: { type: string } };
      expect(visibleTransition.transition.type).toBe('spring');
    });
  });

  describe('toast variant', () => {
    it('should slide in from right', () => {
      expect(toastSlideIn.hidden).toHaveProperty('x', '100%');
      expect(toastSlideIn.visible).toHaveProperty('x', 0);
    });

    it('should have fast spring transition', () => {
      const visibleTransition = toastSlideIn.visible as {
        transition: { type: string; stiffness: number };
      };
      expect(visibleTransition.transition.type).toBe('spring');
      expect(visibleTransition.transition.stiffness).toBe(500);
    });
  });

  describe('modal variants', () => {
    it('should have modalBackdrop with fade effect', () => {
      expect(modalBackdrop.hidden).toHaveProperty('opacity', 0);
      expect(modalBackdrop.visible).toHaveProperty('opacity', 1);
      expect(modalBackdrop).toHaveProperty('exit');
    });

    it('should have modalContent with scale and translate', () => {
      expect(modalContent.hidden).toMatchObject({
        opacity: 0,
        scale: 0.95,
        y: 20,
      });
      expect(modalContent.visible).toMatchObject({
        opacity: 1,
        scale: 1,
        y: 0,
      });
    });
  });

  describe('spinnerRotate', () => {
    it('should rotate 360 degrees infinitely', () => {
      expect(spinnerRotate).toHaveProperty('rotate', 360);
      expect(spinnerRotate.transition).toHaveProperty('repeat', Infinity);
      expect(spinnerRotate.transition).toHaveProperty('ease', 'linear');
    });
  });

  describe('checkmarkDraw', () => {
    it('should animate pathLength from 0 to 1', () => {
      expect(checkmarkDraw.hidden).toHaveProperty('pathLength', 0);
      expect(checkmarkDraw.visible).toHaveProperty('pathLength', 1);
    });
  });

  describe('pulse variant', () => {
    it('should animate scale in array', () => {
      expect(pulse.pulse).toHaveProperty('scale');
      const scale = pulse.pulse as { scale: number[] };
      expect(Array.isArray(scale.scale)).toBe(true);
      expect(scale.scale).toEqual([1, 1.05, 1]);
    });

    it('should repeat infinitely', () => {
      const pulseTransition = pulse.pulse as { transition: { repeat: number } };
      expect(pulseTransition.transition.repeat).toBe(Infinity);
    });
  });

  describe('shimmer', () => {
    it('should animate background position', () => {
      expect(shimmer).toHaveProperty('backgroundPosition');
    });

    it('should repeat infinitely', () => {
      expect(shimmer.transition).toHaveProperty('repeat', Infinity);
    });
  });

  describe('pageTransition', () => {
    it('should have hidden, visible, and exit states', () => {
      expect(pageTransition).toHaveProperty('hidden');
      expect(pageTransition).toHaveProperty('visible');
      expect(pageTransition).toHaveProperty('exit');
    });

    it('should fade and translate', () => {
      expect(pageTransition.hidden).toMatchObject({ opacity: 0, y: 20 });
      expect(pageTransition.visible).toMatchObject({ opacity: 1, y: 0 });
      expect(pageTransition.exit).toMatchObject({ opacity: 0, y: -20 });
    });
  });

  describe('createStagger factory', () => {
    it('should create stagger with default values', () => {
      const stagger = createStagger();
      expect(stagger.hidden).toHaveProperty('opacity', 0);
      expect(stagger.visible).toHaveProperty('opacity', 1);
      const transition = stagger.visible as {
        transition: { staggerChildren: number; delayChildren: number };
      };
      expect(transition.transition.staggerChildren).toBe(0.1);
      expect(transition.transition.delayChildren).toBe(0);
    });

    it('should accept custom staggerDelay', () => {
      const stagger = createStagger(0.2);
      const transition = stagger.visible as { transition: { staggerChildren: number } };
      expect(transition.transition.staggerChildren).toBe(0.2);
    });

    it('should accept custom delayChildren', () => {
      const stagger = createStagger(0.1, 0.5);
      const transition = stagger.visible as { transition: { delayChildren: number } };
      expect(transition.transition.delayChildren).toBe(0.5);
    });

    it('should accept both custom values', () => {
      const stagger = createStagger(0.3, 0.8);
      const transition = stagger.visible as {
        transition: { staggerChildren: number; delayChildren: number };
      };
      expect(transition.transition.staggerChildren).toBe(0.3);
      expect(transition.transition.delayChildren).toBe(0.8);
    });
  });

  describe('reduceMotion utility', () => {
    beforeEach(() => {
      // Reset matchMedia mock
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
      const result = reduceMotion(fadeIn);
      expect(result).toEqual(fadeIn);
    });

    it('should modify transitions when reduced motion is preferred', () => {
      // Mock prefers-reduced-motion: reduce
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

      const result = reduceMotion(fadeIn);

      // All states should have minimal duration
      expect((result.hidden as { transition: { duration: number } }).transition.duration).toBe(
        0.01
      );
      expect((result.visible as { transition: { duration: number } }).transition.duration).toBe(
        0.01
      );
    });

    it('should handle variants with multiple states', () => {
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

      const result = reduceMotion(slideInRight);

      expect((result.hidden as { transition: { duration: number } }).transition.duration).toBe(
        0.01
      );
      expect((result.visible as { transition: { duration: number } }).transition.duration).toBe(
        0.01
      );
      expect((result.exit as { transition: { duration: number } }).transition.duration).toBe(0.01);
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

      expect((result.hidden as { opacity: number }).opacity).toBe(0);
      expect((result.hidden as { y: number }).y).toBe(20);
      expect((result.visible as { opacity: number }).opacity).toBe(1);
      expect((result.visible as { y: number }).y).toBe(0);
    });
  });
});
