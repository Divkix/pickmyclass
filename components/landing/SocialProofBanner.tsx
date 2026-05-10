'use client';

import { m } from 'framer-motion';
import { staggerContainer, staggerItem } from '@/lib/animations';

export function SocialProofBanner() {
  return (
    <section className="border-b border-border bg-muted/30 py-8">
      <m.div
        className="mx-auto max-w-4xl px-6"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true }}
        variants={staggerContainer}
      >
        <m.div
          className="flex flex-col items-center justify-center gap-8 sm:flex-row sm:gap-16"
          variants={staggerItem}
        >
          <div className="text-center">
            <div className="text-3xl font-bold text-foreground">2,400+</div>
            <div className="text-sm text-muted-foreground">Sun Devils using it</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-foreground">15,000+</div>
            <div className="text-sm text-muted-foreground">Classes monitored</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-primary">8,500+</div>
            <div className="text-sm text-muted-foreground">Students got their seat</div>
          </div>
        </m.div>
      </m.div>
    </section>
  );
}
