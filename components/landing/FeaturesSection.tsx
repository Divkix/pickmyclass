'use client';

import { motion } from 'framer-motion';
import { Bell, RefreshCw, TrendingUp, User } from 'lucide-react';
import Link from 'next/link';
import { fadeInUp, staggerContainer, staggerItem } from '@/lib/animations';

export function FeaturesSection() {
  return (
    <section className="border-b border-border px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <motion.div
          className="mb-12 max-w-2xl"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          variants={fadeInUp}
        >
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            We get it. <span className="text-emphasis">Registration sucks.</span>
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            You&apos;ve got better things to do than stare at MyASU all day. Here&apos;s what we
            handle while you live your life.
          </p>
        </motion.div>

        <motion.div
          className="grid gap-4 md:grid-cols-3 md:grid-rows-2"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          variants={staggerContainer}
        >
          {/* Primary feature — spans two columns, maroon-forward */}
          <motion.article
            className="flex flex-col justify-between gap-6 rounded-xl border border-primary/20 bg-primary p-7 text-primary-foreground shadow-smooth md:col-span-2 md:row-span-2"
            variants={staggerItem}
          >
            <div className="flex size-12 items-center justify-center rounded-lg bg-primary-foreground/10">
              <RefreshCw className="size-6 text-accent" aria-hidden="true" />
            </div>
            <div className="space-y-3">
              <h3 className="text-2xl font-semibold">Stop the refresh loop</h3>
              <p className="max-w-md text-base leading-relaxed text-primary-foreground/85">
                You know that thing where you refresh MyASU 47 times during add/drop? We do that for
                you — every 30 minutes, around the clock, automatically. No timer, no tabs, no
                stress.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <span className="rounded-full bg-primary-foreground/10 px-3 py-1 text-xs font-medium">
                  Every 30 minutes
                </span>
                <span className="rounded-full bg-primary-foreground/10 px-3 py-1 text-xs font-medium">
                  24/7 monitoring
                </span>
                <span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">
                  Instant email alerts
                </span>
              </div>
            </div>
          </motion.article>

          {/* Secondary — instructor changes */}
          <motion.article
            className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-smooth"
            variants={staggerItem}
          >
            <div className="flex size-11 items-center justify-center rounded-lg bg-accent/20">
              <User className="size-5 text-primary" aria-hidden="true" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-semibold text-foreground">Know your professor</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                &ldquo;Staff&rdquo; got assigned? We tell you who it is the moment ASU updates it —
                time to check RateMyProfessors.
              </p>
            </div>
          </motion.article>

          {/* Tertiary — beat the waitlist */}
          <motion.article
            className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-smooth"
            variants={staggerItem}
          >
            <div className="flex size-11 items-center justify-center rounded-lg bg-primary/10">
              <TrendingUp className="size-5 text-primary" aria-hidden="true" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-semibold text-foreground">Beat the waitlist</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Someone drops? You know within 30 minutes — and register before the other 200 people
                even check their inbox. If the section actually has a waitlist, start with the{' '}
                <Link
                  href="/blog/asu-waitlist-guide"
                  className="font-medium text-foreground underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
                >
                  ASU waitlist guide
                </Link>
                .
              </p>
            </div>
          </motion.article>
        </motion.div>

        {/* Closing reassurance strip */}
        <motion.div
          className="mt-4 flex items-center gap-3 rounded-xl border border-dashed border-border bg-muted/30 px-6 py-4"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeInUp}
        >
          <Bell className="size-5 shrink-0 text-primary" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            One email per change. No marketing, no digests, no noise — just the alerts that matter.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
