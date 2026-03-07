'use client';

import { motion } from 'framer-motion';
import { CheckCircle2, Clock, Mail, Sparkles, Zap } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { scaleInSpring, staggerContainer, staggerItem } from '@/lib/animations';

export function HeroSection() {
  return (
    <section className="relative overflow-hidden border-b border-border px-6 py-24 sm:py-32">
      {/* Gradient Background */}
      <div className="absolute inset-0 -z-10 bg-grid-pattern mask-[linear-gradient(to_bottom,white,transparent)]" />
      <div className="absolute inset-0 bg-linear-to-br from-primary/10 via-background to-accent/10 opacity-80" />

      <motion.div
        className="relative mx-auto max-w-5xl space-y-10 text-center"
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        <motion.div className="space-y-6" variants={staggerItem}>
          <motion.div
            className="inline-flex items-center gap-2 rounded-full bg-asu-maroon px-4 py-1.5 text-sm font-medium text-white"
            variants={scaleInSpring}
          >
            <Sparkles className="size-4" />
            Built for Sun Devils
          </motion.div>

          <h1 className="text-hero">
            Stop Refreshing MyASU <span className="text-gradient">Every 5 Minutes</span>
          </h1>

          <p className="mx-auto max-w-2xl text-lg text-muted-foreground sm:text-xl">
            Get timely email alerts when seats open up in full classes. We check every 30 minutes so
            you don&apos;t have to.
          </p>
        </motion.div>

        <motion.div
          className="flex flex-col items-center justify-center gap-4 sm:flex-row"
          variants={staggerItem}
        >
          <Link href="/register">
            <Button size="lg" variant="gradient" className="w-full text-base sm:w-auto">
              <Mail className="size-5" />
              Get Started Free
            </Button>
          </Link>
          <Link href="/login">
            <Button size="lg" variant="outline" className="w-full text-base sm:w-auto">
              Sign In
            </Button>
          </Link>
        </motion.div>

        <motion.div
          className="flex flex-wrap items-center justify-center gap-4 pt-4 text-sm text-muted-foreground sm:gap-8"
          variants={staggerItem}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-green-500" />
            <span>Free forever</span>
          </div>
          <div className="flex items-center gap-2">
            <Zap className="size-4 text-asu-gold" />
            <span>No spam, just seats</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-primary" />
            <span>Checks every 30 min</span>
          </div>
        </motion.div>
      </motion.div>
    </section>
  );
}
