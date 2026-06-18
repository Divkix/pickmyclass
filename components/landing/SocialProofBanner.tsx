'use client';

import { motion } from 'framer-motion';
import { GraduationCap } from 'lucide-react';
import { fadeInUp } from '@/lib/animations';

export function SocialProofBanner() {
  return (
    <section className="border-b border-border bg-primary text-primary-foreground">
      <motion.div
        className="mx-auto flex max-w-5xl flex-col items-center gap-x-8 gap-y-3 px-6 py-5 text-center sm:flex-row sm:justify-center sm:text-left"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true }}
        variants={fadeInUp}
      >
        <span className="inline-flex items-center gap-2 text-sm font-medium">
          <GraduationCap className="size-5 text-accent" aria-hidden="true" />
          Trusted across every ASU campus
        </span>
        <span className="hidden h-4 w-px bg-primary-foreground/25 sm:block" aria-hidden="true" />
        <p className="text-sm text-primary-foreground/85">
          <strong className="font-semibold text-primary-foreground">2,400+</strong> Sun Devils ·{' '}
          <strong className="font-semibold text-primary-foreground">15,000+</strong> classes
          monitored · <strong className="font-semibold text-accent">8,500+</strong> seats secured
        </p>
      </motion.div>
    </section>
  );
}
