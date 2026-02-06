'use client';

import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { staggerContainer, staggerItem } from '@/lib/animations';

export function HowItWorks() {
  return (
    <section className="px-6 py-20">
      <motion.div
        className="mx-auto max-w-4xl"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-100px' }}
        variants={staggerContainer}
      >
        <motion.div className="mb-16 text-center" variants={staggerItem}>
          <h2 className="mb-4 text-3xl font-bold text-foreground sm:text-4xl">How It Works</h2>
          <p className="text-lg text-muted-foreground">
            Three simple steps to never miss a class again
          </p>
        </motion.div>

        <div className="relative space-y-12">
          {/* Connecting Line */}
          <div className="absolute bottom-5 left-4.5 top-5 w-0.5 bg-linear-to-b from-primary via-accent to-asu-maroon sm:left-6" />

          {/* Step 1 */}
          <motion.div className="relative flex items-start gap-6" variants={staggerItem}>
            <div className="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground shadow-lg sm:size-12">
              1
            </div>
            <div className="flex-1 space-y-2 pt-1">
              <h3 className="text-xl font-semibold text-foreground sm:text-2xl">
                Add Your Classes
              </h3>
              <p className="text-base text-muted-foreground sm:text-lg">
                Search for ASU classes by section number and add them to your watchlist.
              </p>
            </div>
          </motion.div>

          {/* Step 2 */}
          <motion.div className="relative flex items-start gap-6" variants={staggerItem}>
            <div className="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-lg font-bold text-white shadow-lg sm:size-12">
              2
            </div>
            <div className="flex-1 space-y-2 pt-1">
              <h3 className="text-xl font-semibold text-foreground sm:text-2xl">
                We Handle the Obsessing
              </h3>
              <p className="text-base text-muted-foreground sm:text-lg">
                Our system checks ASU&apos;s class search every 30 minutes for seat availability and
                instructor changes.
              </p>
            </div>
          </motion.div>

          {/* Step 3 */}
          <motion.div className="relative flex items-start gap-6" variants={staggerItem}>
            <div className="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full bg-asu-maroon text-lg font-bold text-white shadow-lg sm:size-12">
              3
            </div>
            <div className="flex-1 space-y-2 pt-1">
              <h3 className="text-xl font-semibold text-foreground sm:text-2xl">
                Register Before Everyone Else
              </h3>
              <p className="text-base text-muted-foreground sm:text-lg">
                Get an email the moment a seat opens. Beat the crowd. Get your schedule.
              </p>
            </div>
          </motion.div>
        </div>

        <motion.div className="mt-16 text-center" variants={staggerItem}>
          <Link href="/register">
            <Button size="lg" variant="gradient" className="text-base">
              <Sparkles className="size-5" />
              Join 2,400+ Sun Devils
            </Button>
          </Link>
        </motion.div>
      </motion.div>
    </section>
  );
}
