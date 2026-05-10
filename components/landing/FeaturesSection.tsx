'use client';

import { m } from 'framer-motion';
import { RefreshCw, TrendingUp, User } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { staggerContainer, staggerItem } from '@/lib/animations';

export function FeaturesSection() {
  return (
    <section className="border-b border-border px-6 py-20">
      <m.div
        className="mx-auto max-w-6xl"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-100px' }}
        variants={staggerContainer}
      >
        <m.div className="mb-16 text-center" variants={staggerItem}>
          <h2 className="mb-4 text-3xl font-semibold text-foreground sm:text-4xl">
            We Get It. <span className="text-gradient">Registration Sucks.</span>
          </h2>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            You&apos;ve got better things to do than stare at MyASU all day.
          </p>
        </m.div>

        <m.div
          className="grid gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3"
          variants={staggerContainer}
        >
          <m.div variants={staggerItem}>
            <Card interactive className="h-full">
              <CardHeader>
                <div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-primary/10">
                  <RefreshCw className="size-6 text-primary" />
                </div>
                <CardTitle className="text-xl">Stop the Refresh Loop</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base leading-relaxed">
                  You know that thing where you refresh MyASU 47 times during add/drop? We do that
                  for you. Every 30 minutes. Automatically.
                </CardDescription>
              </CardContent>
            </Card>
          </m.div>

          <m.div variants={staggerItem}>
            <Card interactive className="h-full">
              <CardHeader>
                <div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-accent/10">
                  <User className="size-6 text-accent" />
                </div>
                <CardTitle className="text-xl">Know Your Professor</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base leading-relaxed">
                  &ldquo;Staff&rdquo; got assigned? We&apos;ll tell you who it is the moment ASU
                  updates it. Check RateMyProfessors before you commit.
                </CardDescription>
              </CardContent>
            </Card>
          </m.div>

          <m.div variants={staggerItem}>
            <Card interactive className="h-full">
              <CardHeader>
                <div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-asu-maroon/10">
                  <TrendingUp className="size-6 text-asu-maroon" />
                </div>
                <CardTitle className="text-xl">Beat the Waitlist</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base leading-relaxed">
                  Someone drops? You&apos;ll know within 30 minutes. Register before the 200 other
                  people on the waitlist even check their email.
                </CardDescription>
              </CardContent>
            </Card>
          </m.div>
        </m.div>
      </m.div>
    </section>
  );
}
