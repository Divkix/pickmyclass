"use client";

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Bell, Clock, Eye, Sparkles, Mail, TrendingUp } from 'lucide-react'
import { Header } from '@/components/Header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { staggerContainer, staggerItem, scaleInSpring } from '@/lib/animations'

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />

      <main className="flex-1">
        {/* Hero Section - Modernized */}
        <section className="relative overflow-hidden border-b border-border px-6 py-24 sm:py-32">
          {/* Gradient Background */}
          <div className="absolute inset-0 bg-linear-to-br from-primary/5 via-background to-accent/5" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(99,102,241,0.1),transparent_50%)]" />

          <motion.div
            className="relative mx-auto max-w-5xl space-y-10 text-center"
            initial="hidden"
            animate="visible"
            variants={staggerContainer}
          >
            <motion.div className="space-y-6" variants={staggerItem}>
              <motion.div
                className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary"
                variants={scaleInSpring}
              >
                <Sparkles className="size-4" />
                Never miss your chance to enroll
              </motion.div>

              <h1 className="text-hero">
                Never Miss a Seat in{" "}
                <span className="text-gradient">Your Classes</span>
              </h1>

              <p className="mx-auto max-w-2xl text-lg text-muted-foreground sm:text-xl">
                Get instant email notifications when seats become available or instructors are assigned to your waitlisted ASU classes.
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
              className="flex flex-wrap items-center justify-center gap-8 pt-8 text-sm text-muted-foreground"
              variants={staggerItem}
            >
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-full bg-accent/20">
                  <Clock className="size-4 text-accent" />
                </div>
                <span>Checks every 30min</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-full bg-primary/20">
                  <Bell className="size-4 text-primary" />
                </div>
                <span>Instant notifications</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-full bg-success/20">
                  <TrendingUp className="size-4 text-success" />
                </div>
                <span>Real-time updates</span>
              </div>
            </motion.div>
          </motion.div>
        </section>

        {/* Features Section - Modernized */}
        <section className="border-b border-border px-6 py-20">
          <motion.div
            className="mx-auto max-w-6xl"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={staggerContainer}
          >
            <motion.div className="mb-16 text-center" variants={staggerItem}>
              <h2 className="mb-4 text-3xl font-bold text-foreground sm:text-4xl">
                Stop Refreshing. Start{" "}
                <span className="text-gradient">Getting Notified</span>.
              </h2>
              <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
                Let our system do the work while you focus on what matters.
              </p>
            </motion.div>

            <motion.div
              className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
              variants={staggerContainer}
            >
              <motion.div variants={staggerItem}>
                <Card interactive className="h-full">
                  <CardHeader>
                    <div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-primary/10">
                      <Eye className="size-6 text-primary" />
                    </div>
                    <CardTitle className="text-xl">Seat Monitoring</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-base leading-relaxed">
                      Automatic checks every 30 minutes. Get notified the moment a seat opens in your full class.
                    </CardDescription>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div variants={staggerItem}>
                <Card interactive className="h-full">
                  <CardHeader>
                    <div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-accent/10">
                      <Bell className="size-6 text-accent" />
                    </div>
                    <CardTitle className="text-xl">Instructor Tracking</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-base leading-relaxed">
                      Know immediately when &ldquo;Staff&rdquo; sections get assigned to specific professors.
                    </CardDescription>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div variants={staggerItem}>
                <Card interactive className="h-full">
                  <CardHeader>
                    <div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-success/10">
                      <TrendingUp className="size-6 text-success" />
                    </div>
                    <CardTitle className="text-xl">Real-Time Updates</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-base leading-relaxed">
                      Dashboard updates live with current seat counts and instructor info as data changes.
                    </CardDescription>
                  </CardContent>
                </Card>
              </motion.div>
            </motion.div>
          </motion.div>
        </section>

        {/* How It Works Section - Timeline Design */}
        <section className="px-6 py-20">
          <motion.div
            className="mx-auto max-w-4xl"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={staggerContainer}
          >
            <motion.div className="mb-16 text-center" variants={staggerItem}>
              <h2 className="mb-4 text-3xl font-bold text-foreground sm:text-4xl">
                How It Works
              </h2>
              <p className="text-lg text-muted-foreground">
                Three simple steps to never miss a class again
              </p>
            </motion.div>

            <div className="relative space-y-12">
              {/* Connecting Line */}
              <div className="absolute left-5 top-5 bottom-5 w-0.5 bg-linear-to-b from-primary via-accent to-success sm:left-6" />

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
                    We Monitor for You
                  </h3>
                  <p className="text-base text-muted-foreground sm:text-lg">
                    Our system checks ASU&apos;s class search every 30 minutes for seat availability and instructor changes.
                  </p>
                </div>
              </motion.div>

              {/* Step 3 */}
              <motion.div className="relative flex items-start gap-6" variants={staggerItem}>
                <div className="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full bg-success text-lg font-bold text-white shadow-lg sm:size-12">
                  3
                </div>
                <div className="flex-1 space-y-2 pt-1">
                  <h3 className="text-xl font-semibold text-foreground sm:text-2xl">
                    Get Notified Instantly
                  </h3>
                  <p className="text-base text-muted-foreground sm:text-lg">
                    Receive an email notification the moment a seat opens up or an instructor is assigned. Register before it&apos;s too late.
                  </p>
                </div>
              </motion.div>
            </div>

            <motion.div className="mt-16 text-center" variants={staggerItem}>
              <Link href="/register">
                <Button size="lg" variant="gradient" className="text-base">
                  <Sparkles className="size-5" />
                  Start Watching Your Classes
                </Button>
              </Link>
            </motion.div>
          </motion.div>
        </section>
      </main>
    </div>
  )
}
