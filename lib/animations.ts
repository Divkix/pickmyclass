import type { Variants } from 'framer-motion';

/**
 * Utility to respect user's motion preferences
 */
export const reduceMotion = (variants: Variants): Variants => {
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    // Return instant transitions for reduced motion
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
    transition: { duration: 0.5, ease: 'easeOut' },
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
    transition: { duration: 0.5, ease: 'easeOut' },
  },
});

// Card hover animations
export const cardHover: Variants = reduceMotion({
  rest: { scale: 1, y: 0 },
  hover: {
    scale: 1.02,
    y: -4,
    transition: { duration: 0.3, ease: 'easeOut' },
  },
});

// Button press animation
export const buttonTap = {
  scale: 0.95,
  transition: { duration: 0.1 },
};
