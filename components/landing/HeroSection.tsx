'use client';

import { motion } from 'framer-motion';
import { Bell, CheckCircle2, Clock, Mail, Sparkles, Zap } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { revealUp, staggerContainer, staggerItem } from '@/lib/animations';

export function HeroSection() {
  return (
    <section className="relative overflow-hidden border-b border-border px-6 py-20 sm:py-28">
      {/* Maroon brand wash + faint grid */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-grid-pattern opacity-60" />
      <div className="pointer-events-none absolute -left-32 -top-32 -z-10 size-96 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-24 -z-10 size-96 rounded-full bg-accent/20 blur-3xl" />

      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
        {/* Left: message */}
        <motion.div
          className="space-y-8 text-center lg:text-left"
          initial="hidden"
          animate="visible"
          variants={staggerContainer}
        >
          <motion.div
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground shadow-smooth"
            variants={staggerItem}
          >
            <Sparkles className="size-4 text-accent" aria-hidden="true" />
            Built for Sun Devils
          </motion.div>

          <motion.h1 className="text-display" variants={staggerItem}>
            Free ASU class seat tracker: stop refreshing MyASU{' '}
            <span className="mark-gold">every 5 minutes</span>
          </motion.h1>

          <motion.p
            className="mx-auto max-w-xl text-lg text-muted-foreground sm:text-xl lg:mx-0"
            variants={staggerItem}
          >
            Get timely email alerts when seats open up in full ASU classes. PickMyClass (yep, people
            also call it Pick My Class) checks the ASU class search every 30 minutes so you
            don&apos;t have to.
          </motion.p>

          <motion.div
            className="flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start"
            variants={staggerItem}
          >
            <Link href="/sign-up" className="w-full sm:w-auto">
              <Button size="lg" variant="gradient" className="w-full text-base sm:w-auto">
                <Mail className="size-5" aria-hidden="true" />
                Get Started Free
              </Button>
            </Link>
            <Link href="/sign-in" className="w-full sm:w-auto">
              <Button size="lg" variant="outline" className="w-full text-base sm:w-auto">
                Sign In
              </Button>
            </Link>
          </motion.div>

          <motion.ul
            className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-muted-foreground lg:justify-start"
            variants={staggerItem}
          >
            <li className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
              <span>Free forever</span>
            </li>
            <li className="flex items-center gap-2">
              <Zap className="size-4 text-primary" aria-hidden="true" />
              <span>No spam, just seats</span>
            </li>
            <li className="flex items-center gap-2">
              <Clock className="size-4 text-primary" aria-hidden="true" />
              <span>Checks every 30 min</span>
            </li>
          </motion.ul>
        </motion.div>

        {/* Right: product visual — the alert you'll actually receive */}
        <motion.div
          className="relative mx-auto w-full max-w-md lg:max-w-none"
          initial="hidden"
          animate="visible"
          variants={revealUp}
        >
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-smooth-lg">
            {/* Email chrome */}
            <div className="flex items-center gap-3 border-b border-border bg-muted/60 px-5 py-3">
              <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Bell className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  A seat just opened in CSE 240
                </p>
                <p className="truncate text-xs text-muted-foreground">PickMyClass · just now</p>
              </div>
            </div>

            {/* Email body */}
            <div className="space-y-4 p-5">
              <p className="text-sm text-muted-foreground">
                Good news — a seat opened in a class you&apos;re watching. Register now before it
                fills back up.
              </p>

              <div className="rounded-xl border border-border bg-background p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-foreground">CSE 240</p>
                    <p className="text-xs text-muted-foreground">
                      Intro to Programming Languages · #12345
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-xs font-semibold text-success">
                    <CheckCircle2 className="size-3.5" aria-hidden="true" />3 seats open
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="size-3.5" aria-hidden="true" />
                  Detected 2 minutes ago
                </div>
              </div>

              <div className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground">
                Register on MyASU →
              </div>
            </div>
          </div>

          {/* Floating "live" chip */}
          <div className="absolute -bottom-4 -left-4 hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-2 shadow-smooth-lg sm:flex">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-accent" />
            </span>
            <span className="text-xs font-medium text-foreground">Checking 24/7</span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
