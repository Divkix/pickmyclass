import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { JsonLd } from '@/components/landing/JsonLd';

export const metadata: Metadata = {
  title: 'ASU Registration Tips: Build Your Perfect Schedule',
  description:
    'Everything you need to know about ASU class registration. Enrollment appointment tips, class search strategies, and tools to help you get the schedule you want.',
  alternates: {
    canonical: '/blog/asu-registration-tips',
  },
  openGraph: {
    title: 'ASU Registration Tips: Build Your Perfect Schedule',
    description:
      'Everything you need to know about ASU class registration. Enrollment tips and strategies.',
    type: 'article',
    publishedTime: '2026-03-27T00:00:00Z',
  },
};

export const dynamic = 'error';

const articleSchema = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'ASU Registration Tips: Build Your Perfect Schedule',
  description:
    'Everything you need to know about ASU class registration. Enrollment appointment tips, class search strategies, and tools to help you get the schedule you want.',
  datePublished: '2026-03-27T00:00:00Z',
  author: { '@type': 'Organization', name: 'PickMyClass' },
  publisher: {
    '@type': 'Organization',
    name: 'PickMyClass',
    url: 'https://pickmyclass.app',
  },
  mainEntityOfPage: 'https://pickmyclass.app/blog/asu-registration-tips',
};

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://pickmyclass.app/' },
    { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://pickmyclass.app/blog' },
    { '@type': 'ListItem', position: 3, name: 'ASU Registration Tips' },
  ],
};

export default async function ASURegistrationTipsPost() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="flex-1 px-4 py-12 md:px-8">
        <article className="prose prose-neutral dark:prose-invert mx-auto max-w-3xl">
          <div className="not-prose mb-4">
            <nav className="text-sm text-muted-foreground">
              <Link href="/" className="hover:text-foreground transition-colors">
                Home
              </Link>
              <span className="mx-2">/</span>
              <Link href="/blog" className="hover:text-foreground transition-colors">
                Blog
              </Link>
              <span className="mx-2">/</span>
              <span className="text-foreground">ASU Registration Tips</span>
            </nav>
          </div>

          <div className="not-prose mb-8">
            <h1 className="text-4xl font-bold text-foreground sm:text-5xl leading-tight">
              ASU Registration Tips: Build Your Perfect Schedule
            </h1>
            <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
              <time dateTime="2026-03-27">March 27, 2026</time>
              <span>6 min read</span>
            </div>
          </div>

          <p className="text-lg text-muted-foreground leading-relaxed">
            ASU class registration can feel like a high-stakes game. Between limited enrollment
            windows, popular classes filling instantly, and the complexity of building a balanced
            schedule, it&apos;s easy to feel overwhelmed. Here&apos;s everything you need to know to
            approach registration day with confidence.
          </p>

          <h2 className="text-2xl font-bold text-foreground mt-10 mb-4">
            Before Registration: Preparation Is Everything
          </h2>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Know Your Enrollment Appointment
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            ASU assigns enrollment appointments based on your class standing (credit hours). Check
            MyASU for your specific date and time &mdash; it&apos;s different for every student.
            Seniors register first, then juniors, sophomores, and freshmen. Barrett Honors students
            and athletes may have earlier priority windows.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Use the ASU Class Search Strategically
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            The{' '}
            <a
              href="https://catalog.apps.asu.edu/catalog/classes"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary/80"
            >
              ASU class search
            </a>{' '}
            is your primary tool for finding classes. Before registration opens, use it to:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>Find all available sections for each class you need</li>
            <li>Note section numbers (you&apos;ll need these for fast registration)</li>
            <li>Check instructor assignments and cross-reference with RateMyProfessors</li>
            <li>Identify time conflicts between your desired classes</li>
            <li>Find backup sections at different times or campuses</li>
          </ul>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Plan Multiple Schedule Options
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Don&apos;t go into registration with just one ideal schedule. Build 2-3 complete
            schedule options so you can pivot quickly if your first choices are full. Consider
            variables like:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>Different professors for the same course</li>
            <li>Session A, B, or C options for shorter-term classes</li>
            <li>Online vs. in-person alternatives</li>
            <li>Different campus locations (Tempe, Downtown, Polytechnic, West)</li>
          </ul>

          <h2 className="text-2xl font-bold text-foreground mt-10 mb-4">
            During Registration: Speed Matters
          </h2>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Use the Shopping Cart Feature
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            MyASU lets you add classes to a shopping cart before your enrollment window opens. Load
            your cart with your preferred classes and backups so that when your window activates,
            you can enroll with just a few clicks instead of searching for classes in real-time.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Register the Moment Your Window Opens
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Set an alarm. Have MyASU open and ready. The difference between registering at 9:00 AM
            and 9:05 AM can be the difference between getting your preferred section and being
            locked out. Popular classes with popular professors fill in minutes.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Check Prerequisite and Restriction Requirements
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Nothing is more frustrating than trying to add a class during your enrollment window
            only to discover you don&apos;t meet a prerequisite or there&apos;s a major restriction.
            Verify all prerequisites are met well before registration day. If you need a permission
            override, contact the department ahead of time.
          </p>

          <h2 className="text-2xl font-bold text-foreground mt-10 mb-4">
            After Registration: Don&apos;t Give Up on Full Classes
          </h2>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Set Up Automated Seat Tracking
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            If a class you want is full, don&apos;t just accept it. Use{' '}
            <Link href="/" className="text-primary hover:text-primary/80 font-medium">
              PickMyClass
            </Link>{' '}
            to automatically monitor the class for open seats. Our system checks every 30 minutes
            and emails you immediately when a seat opens up. Over 8,500 students have gotten their
            seat this way.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Watch for Section Additions
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            ASU departments sometimes add new sections after the initial schedule is published,
            especially for high-demand courses. Keep monitoring the class search throughout the
            registration period. Setting up{' '}
            <Link
              href="/blog/asu-class-seat-tracker"
              className="text-primary hover:text-primary/80 font-medium"
            >
              automated class tracking
            </Link>{' '}
            ensures you won&apos;t miss these additions.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Leverage Add/Drop Week
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            The first week of classes is when the most schedule changes happen. Students drop
            classes, swap sections, and adjust their schedules based on first impressions. This
            creates a steady stream of openings in previously full classes. Have{' '}
            <Link
              href="/blog/how-to-get-into-full-asu-classes"
              className="text-primary hover:text-primary/80 font-medium"
            >
              your strategies
            </Link>{' '}
            ready to capitalize on this period.
          </p>

          <h2 className="text-2xl font-bold text-foreground mt-10 mb-4">
            Tools That Give You an Edge
          </h2>
          <div className="space-y-4 my-6">
            <div className="rounded-lg border border-border bg-card p-5">
              <h3 className="font-semibold text-foreground mb-1">
                PickMyClass (Free ASU Class Seat Tracker)
              </h3>
              <p className="text-sm text-muted-foreground">
                Automatically monitors ASU classes and emails you when seats open. Trusted by 2,400+
                Sun Devils.{' '}
                <Link href="/" className="text-primary hover:text-primary/80">
                  pickmyclass.app
                </Link>
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-5">
              <h3 className="font-semibold text-foreground mb-1">RateMyProfessors</h3>
              <p className="text-sm text-muted-foreground">
                Research professor ratings and reviews before committing to a section. Especially
                useful when sections have different instructors.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-5">
              <h3 className="font-semibold text-foreground mb-1">ASU Degree Audit (DARS)</h3>
              <p className="text-sm text-muted-foreground">
                Use your DARS report to verify which classes count toward your degree requirements
                before registering.
              </p>
            </div>
          </div>

          <h2 className="text-2xl font-bold text-foreground mt-10 mb-4">
            Quick Registration Checklist
          </h2>
          <ul className="space-y-2 text-muted-foreground">
            <li>Know your enrollment appointment date and time</li>
            <li>Research and note section numbers for all desired classes</li>
            <li>Build 2-3 complete backup schedules</li>
            <li>Pre-load your MyASU shopping cart</li>
            <li>Verify all prerequisites are met</li>
            <li>
              Set up{' '}
              <Link href="/" className="text-primary hover:text-primary/80 font-medium">
                PickMyClass
              </Link>{' '}
              for classes you expect to fill up
            </li>
            <li>Set an alarm for your enrollment window</li>
            <li>Have a device with reliable internet ready</li>
          </ul>

          <div className="not-prose mt-12 rounded-lg border border-primary/20 bg-primary/5 p-8 text-center">
            <h2 className="mb-2 text-2xl font-bold text-foreground">
              Don&apos;t let full classes ruin your schedule
            </h2>
            <p className="mb-6 text-muted-foreground">
              Track ASU class seats automatically and get notified when spots open. Free for all Sun
              Devils.
            </p>
            <Link
              href="/register"
              className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
            >
              Get Started Free
            </Link>
          </div>

          <div className="not-prose mt-8 border-t border-border pt-6">
            <h3 className="text-sm font-semibold text-foreground mb-3">Related Articles</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link
                  href="/blog/asu-class-seat-tracker"
                  className="text-primary hover:text-primary/80 transition-colors"
                >
                  ASU Class Seat Tracker: How to Get Notified When Seats Open
                </Link>
              </li>
              <li>
                <Link
                  href="/blog/how-to-get-into-full-asu-classes"
                  className="text-primary hover:text-primary/80 transition-colors"
                >
                  How to Get Into Full Classes at ASU: 7 Strategies That Work
                </Link>
              </li>
            </ul>
          </div>
        </article>
      </main>

      <JsonLd data={articleSchema} />
      <JsonLd data={breadcrumbSchema} />
    </div>
  );
}
