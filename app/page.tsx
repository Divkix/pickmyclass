'use client';

import { motion } from 'framer-motion';
import {
  CheckCircle2,
  Clock,
  Mail,
  RefreshCw,
  Sparkles,
  TrendingUp,
  User,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { scaleInSpring, staggerContainer, staggerItem } from '@/lib/animations';
import { useAuth } from '@/lib/contexts/AuthContext';

// Social proof stats component
function SocialProofBanner() {
  return (
    <section className="border-b border-border bg-muted/30 py-8">
      <motion.div
        className="mx-auto max-w-4xl px-6"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true }}
        variants={staggerContainer}
      >
        <motion.div
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
        </motion.div>
      </motion.div>
    </section>
  );
}

// Dashboard preview component
function DashboardPreview() {
  const sampleClasses = [
    {
      code: 'CSE 240',
      title: 'Intro to Programming Languages',
      section: '12345',
      instructor: 'Dr. Nakamura',
      seats: 3,
      status: 'available',
    },
    {
      code: 'MAT 265',
      title: 'Calculus for Engineers I',
      section: '23456',
      instructor: 'Staff',
      seats: 0,
      status: 'full',
    },
    {
      code: 'PHY 121',
      title: 'University Physics I',
      section: '34567',
      instructor: 'Dr. Chen',
      seats: 0,
      status: 'full',
    },
  ];

  return (
    <section className="border-b border-border bg-muted/20 px-6 py-20">
      <motion.div
        className="mx-auto max-w-5xl"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-100px' }}
        variants={staggerContainer}
      >
        <motion.div className="mb-12 text-center" variants={staggerItem}>
          <h2 className="mb-4 text-3xl font-bold text-foreground sm:text-4xl">
            Your Dashboard, <span className="text-gradient">Ready to Go</span>
          </h2>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            Here&apos;s what you get the moment you sign up. No learning curve.
          </p>
        </motion.div>

        <motion.div variants={staggerItem}>
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-lg">
            {/* Dashboard header preview */}
            <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-3 sm:px-6">
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium text-foreground">My Watched Classes</span>
                <div className="flex items-center gap-1.5">
                  <div className="size-2 animate-pulse rounded-full bg-green-500" />
                  <span className="text-xs text-muted-foreground">Live</span>
                </div>
              </div>
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span className="hidden sm:inline">
                  <strong className="text-foreground">5</strong> classes
                </span>
                <span className="text-green-600 dark:text-green-400">
                  <strong>2</strong> available
                </span>
                <span className="text-red-600 dark:text-red-400">
                  <strong>3</strong> full
                </span>
              </div>
            </div>

            {/* Sample class cards */}
            <div className="divide-y divide-border">
              {sampleClasses.map((cls) => (
                <div
                  key={cls.section}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                >
                  <div className="flex items-start gap-3 sm:items-center">
                    <div
                      className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${
                        cls.status === 'available'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      }`}
                    >
                      {cls.status === 'available' ? (
                        <CheckCircle2 className="size-5" />
                      ) : (
                        <Clock className="size-5" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{cls.code}</span>
                        <span className="text-xs text-muted-foreground">#{cls.section}</span>
                      </div>
                      <div className="text-sm text-muted-foreground">{cls.title}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 pl-13 sm:pl-0">
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <User className="size-3.5" />
                      <span className={cls.instructor === 'Staff' ? 'italic' : ''}>
                        {cls.instructor}
                      </span>
                    </div>
                    <Badge
                      variant={cls.status === 'available' ? 'default' : 'secondary'}
                      className={
                        cls.status === 'available'
                          ? 'bg-green-100 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-red-100 text-red-700 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400'
                      }
                    >
                      {cls.status === 'available' ? `${cls.seats} seats open` : 'Full'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>

            {/* Add more classes hint */}
            <div className="border-t border-dashed border-border bg-muted/30 px-4 py-3 text-center sm:px-6">
              <span className="text-sm text-muted-foreground">
                + Add more classes by section number
              </span>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </section>
  );
}

// Mobile sticky CTA component
function MobileStickyCTA() {
  const [showCTA, setShowCTA] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      // Show CTA after scrolling past hero (roughly 500px)
      setShowCTA(window.scrollY > 500);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  if (!showCTA) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 p-4 backdrop-blur sm:hidden">
      <Link href="/register" className="block">
        <Button variant="gradient" size="lg" className="w-full">
          Get Started Free
        </Button>
      </Link>
    </div>
  );
}

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Redirect authenticated users to dashboard (client-side for faster homepage loads)
  // Admin redirect is handled by middleware when they hit /dashboard → /admin
  useEffect(() => {
    if (!loading && user?.email_confirmed_at) {
      router.replace('/dashboard');
    }
  }, [user, loading, router]);

  // Show minimal loading state while checking auth to prevent FOUC
  // Only show if we might redirect (loading or authenticated)
  if (loading || user?.email_confirmed_at) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <Header />
        <div className="flex flex-1 items-center justify-center">
          <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />

      <main className="flex-1 pb-16 sm:pb-0">
        {/* Hero Section - ASU Student Focused */}
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
                Get instant email alerts when seats open up in full classes. We check every 30
                minutes so you don&apos;t have to.
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

        {/* Social Proof Stats Banner */}
        <SocialProofBanner />

        {/* Features Section - Pain Point Focused */}
        <section className="border-b border-border px-6 py-20">
          <motion.div
            className="mx-auto max-w-6xl"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-100px' }}
            variants={staggerContainer}
          >
            <motion.div className="mb-16 text-center" variants={staggerItem}>
              <h2 className="mb-4 text-3xl font-bold text-foreground sm:text-4xl">
                We Get It. <span className="text-gradient">Registration Sucks.</span>
              </h2>
              <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
                You&apos;ve got better things to do than stare at MyASU all day.
              </p>
            </motion.div>

            <motion.div
              className="grid gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3"
              variants={staggerContainer}
            >
              <motion.div variants={staggerItem}>
                <Card interactive className="h-full">
                  <CardHeader>
                    <div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-primary/10">
                      <RefreshCw className="size-6 text-primary" />
                    </div>
                    <CardTitle className="text-xl">Stop the Refresh Loop</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-base leading-relaxed">
                      You know that thing where you refresh MyASU 47 times during add/drop? We do
                      that for you. Every 30 minutes. Automatically.
                    </CardDescription>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div variants={staggerItem}>
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
              </motion.div>

              <motion.div variants={staggerItem}>
                <Card interactive className="h-full">
                  <CardHeader>
                    <div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-asu-maroon/10">
                      <TrendingUp className="size-6 text-asu-maroon" />
                    </div>
                    <CardTitle className="text-xl">Beat the Waitlist</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-base leading-relaxed">
                      Someone drops? You&apos;ll know within 30 minutes. Register before the 200
                      other people on the waitlist even check their email.
                    </CardDescription>
                  </CardContent>
                </Card>
              </motion.div>
            </motion.div>
          </motion.div>
        </section>

        {/* Dashboard Preview Section */}
        <DashboardPreview />

        {/* How It Works Section - Timeline Design */}
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
                    Our system checks ASU&apos;s class search every 30 minutes for seat availability
                    and instructor changes.
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
      </main>

      {/* Mobile Sticky CTA */}
      <MobileStickyCTA />
    </div>
  );
}
