import type { Variants } from 'framer-motion';

/**
 * Exponential ease-out curves (no bounce/elastic). Entering motion eases out;
 * exiting motion eases in. Keeps the whole site on one motion rhythm.
 */
const easeOutExpo = [0.16, 1, 0.3, 1] as const;

/**
 * Utility to respect the user's motion preferences. When reduced motion is
 * requested, transitions collapse to a near-instant crossfade.
 */
export const reduceMotion = (variants: Variants): Variants => {
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    // SAFETY: empty object is initial Variants accumulator; reduce populates valid variant entries
    return Object.keys(variants).reduce((acc, key) => {
      acc[key] = {
        // oxlint-disable-next-line typescript/no-misused-spread
        ...variants[key],
        transition: { duration: 0.01 },
      };
      return acc;
    }, {} as Variants);
  }
  return variants;
};

/**
 * Reusable Framer Motion animation variants for consistent animations across the app
 */

export const fadeInUp: Variants = reduceMotion({
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: easeOutExpo },
  },
});

// A softer, slightly larger reveal for hero/feature imagery
export const revealUp: Variants = reduceMotion({
  hidden: { opacity: 0, y: 28, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.7, ease: easeOutExpo },
  },
});

// Stagger container for list animations
export const staggerContainer: Variants = reduceMotion({
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1,
    },
  },
});

export const staggerItem: Variants = reduceMotion({
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: easeOutExpo },
  },
});

// Button press animation
export const buttonTap = {
  scale: 0.95,
  transition: { duration: 0.1 },
};
