import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BlogAuthor,
  BlogCTA,
  BlogFAQ,
  ComparisonTable,
  KeyTakeaways,
  RelatedArticles,
  ShortAnswer,
} from '@/components/blog';
import { Header } from '@/components/Header';
import { JsonLd } from '@/components/landing/JsonLd';

export const metadata: Metadata = {
  title: 'ASU Class Seat Tracker: How to Get Notified When Seats Open',
  description:
    'Stop refreshing MyASU. Learn how to automatically track ASU class seat availability and get email alerts the moment a seat opens in a full class.',
  alternates: {
    canonical: '/blog/asu-class-seat-tracker',
  },
  openGraph: {
    title: 'ASU Class Seat Tracker: How to Get Notified When Seats Open',
    description:
      'Stop refreshing MyASU. Automatically track ASU class seat availability and get email alerts when seats open.',
    type: 'article',
    publishedTime: '2026-03-27T00:00:00Z',
    images: ['/og-image.png'],
  },
};

export const dynamic = 'error';

const articleSchema = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'ASU Class Seat Tracker: How to Get Notified When Seats Open',
  description:
    'Stop refreshing MyASU. Learn how to automatically track ASU class seat availability and get email alerts the moment a seat opens in a full class.',
  datePublished: '2026-03-27T00:00:00Z',
  dateModified: '2026-06-18T00:00:00Z',
  author: { '@type': 'Person', name: 'PickMyClass Team', url: 'https://pickmyclass.app' },
  publisher: {
    '@type': 'Organization',
    name: 'PickMyClass',
    url: 'https://pickmyclass.app',
  },
  mainEntityOfPage: 'https://pickmyclass.app/blog/asu-class-seat-tracker',
};

const comparisonColumns = [
  { key: 'method', label: 'Method' },
  { key: 'frequency', label: 'Check Frequency' },
  { key: 'effort', label: 'Effort' },
  { key: 'cost', label: 'Cost' },
  { key: 'success', label: 'Success Rate' },
];

const comparisonRows = [
  {
    method: 'Manual MyASU',
    frequency: 'When you remember',
    effort: 'High',
    cost: 'Free',
    success: 'Low',
  },
  {
    method: 'ASUClassFinder',
    frequency: 'Unknown',
    effort: 'Low',
    cost: 'Paid tiers',
    success: 'Medium',
  },
  {
    method: 'PickMyClass',
    frequency: 'Every 30 min',
    effort: 'None',
    cost: '100% Free',
    success: 'High',
    highlight: true,
  },
];

const faqItems = [
  {
    question: 'Is PickMyClass affiliated with ASU?',
    answer:
      "Nope. PickMyClass was built by ASU students who got tired of the registration game. We're not officially connected to the university, but we pull from the same public class search data anyone can access.",
  },
  {
    question: 'How is this different from ASUClassFinder?',
    answer:
      'PickMyClass is completely free. No premium tiers, no upsells. We also notify you when "Staff" sections get assigned real professors, which is huge for avoiding bad surprises on day one.',
  },
  {
    question: 'Can international students use this?',
    answer:
      "Yeah, it works from anywhere. We just send you an email when something changes. Doesn't matter if you're in Tempe or Tokyo.",
  },
  {
    question: "What if a seat opens while I'm sleeping?",
    answer:
      "You'll get an email, but honestly? Hot classes can fill in minutes. Keep email notifications on, and have MyASU bookmarked so you can register right when you wake up. The 30-minute check interval helps, but you're still racing everyone else.",
  },
  {
    question: 'Do I need to give you my ASU password?',
    answer:
      'Absolutely not. We never ask for your MyASU login. We only look at public class data. Your password is yours.',
  },
  {
    question: 'How many classes can I track?',
    answer:
      "Multiple. We have fair-use limits so one person doesn't break the system for everyone, but most students can track every class they need without hitting a cap.",
  },
  {
    question: 'Does this work for ASU Online classes?',
    answer:
      'Yep. Tempe, Downtown Phoenix, Poly, West, and ASU Online. If it shows up in the ASU class search, we can track it.',
  },
  {
    question: 'What should I do after getting an alert?',
    answer:
      'Move fast. Have MyASU open in a tab, be logged in, and know exactly how to add the class. Practice the flow before you need it. Some seats vanish in under 5 minutes.',
  },
  {
    question: 'Can I track multiple sections of the same class?',
    answer:
      'Definitely. I always track every section of a required course. More sections tracked means more chances to get in.',
  },
  {
    question: 'What if I miss the notification?',
    answer:
      'It happens. Enable push notifications for your email, but if you miss a seat, just stay on the tracker. Students drop classes all semester, especially the first week. The next opening might be hours or days away.',
  },
];

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://pickmyclass.app/' },
    { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://pickmyclass.app/blog' },
    { '@type': 'ListItem', position: 3, name: 'ASU Class Seat Tracker' },
  ],
};

export default async function ASUClassSeatTrackerPost() {
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
              <span className="text-foreground">ASU Class Seat Tracker</span>
            </nav>
          </div>

          <div className="not-prose mb-8">
            <h1 className="text-4xl font-semibold text-foreground sm:text-5xl leading-tight">
              ASU Class Seat Tracker: How to Get Notified When Seats Open
            </h1>
            <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
              <time dateTime="2026-03-27">March 27, 2026</time>
              <span>·</span>
              <span>Updated June 18, 2026</span>
              <span>8 min read</span>
            </div>
          </div>

          <p className="text-lg text-muted-foreground leading-relaxed">
            Every ASU student knows the drill. You find the perfect class, click &ldquo;Add,&rdquo;
            and it's full. Every section. So you start the refresh cycle, checking MyASU every few
            minutes like it's a social media feed.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Look, there's a better way. Instead of manually checking the ASU class search all day,
            you can use an automated tracker to watch classes for you and send you an email the
            second a seat opens.
          </p>

          <ShortAnswer>
            An ASU class seat tracker watches a full section for you and emails you the moment a
            seat opens. PickMyClass checks ASU Class Search every 30 minutes, alerts you on open
            seats and instructor changes, and is free. Add the section number, then register in
            MyASU as soon as the alert hits.
          </ShortAnswer>

          <KeyTakeaways
            items={[
              { text: 'Manual refreshing is a losing game, seats open and close too fast' },
              {
                text: 'PickMyClass checks every 30 minutes and emails you instantly when seats appear',
              },
              {
                text: 'It also detects instructor changes so you know when "Staff" becomes a real professor',
              },
              {
                text: 'Set up tracking before registration starts, then act fast when you get the alert',
              },
            ]}
          />

          <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">
            The Problem: Refreshing MyASU Is a Full-Time Job
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            During registration and add/drop week, popular classes fill in minutes. If you need a
            specific class for your major, you're stuck refreshing the class search, praying someone
            drops.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Here's the thing. Seats appear and vanish quickly. If you're in lecture, at work, or
            asleep, you miss it. And hundreds of other students are doing the exact same thing.
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">
            The Solution: Let a Tracker Do the Work
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            <Link href="/" className="text-primary hover:text-primary/80 font-medium">
              PickMyClass
            </Link>{' '}
            is a free ASU class seat tracker that monitors your classes and emails you when a seat
            opens. We check every 30 minutes, 24/7, so you don't have to.
          </p>
          <p className="text-muted-foreground leading-relaxed">What it actually does:</p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Automatic monitoring</strong>. We check the ASU
              class search every 30 minutes for every class on your list.
            </li>
            <li>
              <strong className="text-foreground">Instant email alerts</strong>. The moment a seat
              opens, you get notified so you can jump on it.
            </li>
            <li>
              <strong className="text-foreground">Instructor change detection</strong>. When
              &ldquo;Staff&rdquo; becomes a real professor, we let you know so you can check
              RateMyProfessors before it's too late.
            </li>
            <li>
              <strong className="text-foreground">All ASU campuses</strong>. Tempe, Downtown
              Phoenix, Polytechnic, West, and ASU Online.
            </li>
          </ul>

          <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">
            How to Track ASU Class Seats in 3 Steps
          </h2>
          <div className="space-y-6 my-6">
            <div className="rounded-lg border border-border bg-card p-6">
              <h3 className="text-lg font-semibold text-foreground mb-2">
                Step 1: Create a Free Account
              </h3>
              <p className="text-muted-foreground">
                <Link href="/sign-up" className="text-primary hover:text-primary/80 font-medium">
                  Sign up for PickMyClass
                </Link>{' '}
                with your email. It takes like 30 seconds. No ASU credentials needed, we never ask
                for your MyASU login.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-6">
              <h3 className="text-lg font-semibold text-foreground mb-2">
                Step 2: Add Classes to Your Watchlist
              </h3>
              <p className="text-muted-foreground">
                Search by section number (the 5-digit code from ASU class search) and add them to
                your watchlist. Track as many as you want.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-6">
              <h3 className="text-lg font-semibold text-foreground mb-2">
                Step 3: Get Notified and Register
              </h3>
              <p className="text-muted-foreground">
                Go live your life. When a seat opens, you'll get an email. Open MyASU and register
                before everyone else on the waitlist even notices.
              </p>
            </div>
          </div>

          <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Seat Tracking Comparison: Your Options
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            A few ways to track ASU class seats exist. Here's how they actually compare:
          </p>
          <ComparisonTable columns={comparisonColumns} rows={comparisonRows} />
          <p className="text-muted-foreground leading-relaxed">
            PickMyClass checks frequently, costs nothing, and actually works. That's the difference.
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Why 2,400+ Sun Devils Use PickMyClass
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Since we launched, over 2,400 ASU students have tracked more than 15,000 classes. We've
            sent 8,500+ successful seat notifications, helping people get into classes they actually
            need to graduate.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            It's completely free. No premium tiers, no ads, no weird catches. Built by ASU students
            who were just as frustrated with registration as you are.
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">
            What to Do After Getting the Alert
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            When that email hits your inbox, speed matters. Here's what to do:
          </p>
          <ol className="space-y-3 text-muted-foreground list-decimal list-inside">
            <li>
              <strong className="text-foreground">Click immediately</strong>. Open the email and
              verify the seat is still open.
            </li>
            <li>
              <strong className="text-foreground">Log into MyASU</strong>. Have it bookmarked and be
              ready to sign in.
            </li>
            <li>
              <strong className="text-foreground">Navigate to registration</strong>. Go straight to
              the add classes page.
            </li>
            <li>
              <strong className="text-foreground">Enter the section number</strong>. Have it copied
              and ready to paste.
            </li>
            <li>
              <strong className="text-foreground">Add the class</strong>. Confirm and finish
              registration immediately.
            </li>
          </ol>
          <p className="text-muted-foreground leading-relaxed mt-4">
            <strong className="text-foreground">Pro tip:</strong> Practice this flow before you get
            a real alert. Time yourself. The students who get in are the ones who can register
            within 2-3 minutes of getting the notification.
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">
            When to Start Tracking
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            The best time to set up tracking is <strong className="text-foreground">before</strong>{' '}
            your enrollment appointment. Add every class you want to your watchlist ahead of time.
            If they fill during registration, you're already monitoring them and ready to pounce
            when someone drops.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            PickMyClass is especially useful during add/drop week when class rosters change
            constantly. Students are always swapping and dropping, which means seats open all the
            time if you're watching.
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Frequently Asked Questions
          </h2>
          <BlogFAQ items={faqItems} />

          <BlogCTA
            heading="Stop refreshing. Start tracking."
            description="Join 2,400+ Sun Devils who get notified when seats open in full ASU classes."
          />

          <BlogAuthor
            name="PickMyClass Team"
            title="PickMyClass Founder"
            bio="Built PickMyClass after missing registration for a required class. Now helping thousands of Sun Devils get the classes they need."
          />

          <RelatedArticles
            articles={[
              {
                href: '/blog/how-to-get-into-full-asu-classes',
                title: 'How to Get Into Full Classes at ASU: 7 Strategies That Work',
              },
              {
                href: '/blog/asu-registration-tips',
                title: 'ASU Registration Tips: Build Your Perfect Schedule',
              },
              {
                href: '/blog/best-asu-class-seat-tracker',
                title: 'Best ASU Class Seat Tracker in 2026 (Free vs Paid)',
              },
              {
                href: '/blog/asu-class-search',
                title: 'ASU Class Search: How to Find Open Classes Fast',
              },
            ]}
          />
        </article>
      </main>

      <JsonLd data={articleSchema} />
      <JsonLd data={breadcrumbSchema} />
    </div>
  );
}
