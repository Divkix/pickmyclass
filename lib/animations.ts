import type { Variants } from "framer-motion";

const easeOutExpo = [0.16, 1, 0.3, 1] as const;

const reduceMotion = (variants: Variants): Variants => {
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) {
    const reduced: Variants = {};

    for (const [key, value] of Object.entries(variants)) {
      reduced[key] = Object.assign({}, value, { transition: { duration: 0.01 } });
    }

    return reduced;
  }

  return variants;
};

export const fadeInUp: Variants = reduceMotion({
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: easeOutExpo },
  },
});

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
