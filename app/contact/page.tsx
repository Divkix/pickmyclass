import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';

export const metadata: Metadata = {
  title: 'Contact PickMyClass — Support Email & Bug Reports',
  description:
    'Reach the PickMyClass team: support@pickmyclass.app for account and alert questions, or open an issue on GitHub for bugs. Here is what to include so we can reproduce it fast.',
  alternates: {
    canonical: '/contact',
  },
  openGraph: {
    title: 'Contact PickMyClass — Support Email & Bug Reports',
    description:
      'Email support@pickmyclass.app or open a GitHub issue. What to include in a bug report, and how quickly a student-run project replies.',
    type: 'website',
    url: '/contact',
    images: ['/og-image.png'],
  },
  twitter: {
    title: 'Contact PickMyClass — Support Email & Bug Reports',
    description:
      'Email support@pickmyclass.app or open a GitHub issue. What to include in a bug report, and how quickly a student-run project replies.',
  },
};

export const dynamic = 'error';

export default function ContactPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 px-4 py-12 md:px-8">
        <article className="prose prose-neutral dark:prose-invert mx-auto max-w-3xl">
          <div className="not-prose mb-8">
            <h1 className="text-4xl font-semibold text-foreground sm:text-5xl leading-tight">
              Contact PickMyClass
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">
              PickMyClass is run by the same ASU students who built it, so support comes straight
              from the people who know the code.
            </p>
          </div>

          <p className="text-muted-foreground leading-relaxed">
            There is no phone line and no chat widget. Everything reaches us through email or
            GitHub, and both go to the same small team. Pick whichever fits what you need — the{' '}
            <Link href="/faq" className="text-primary hover:text-primary/80">
              FAQ
            </Link>{' '}
            answers most questions about how tracking, timing, and campuses work before you write
            in.
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Email support@pickmyclass.app
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Write to{' '}
            <a
              href="mailto:support@pickmyclass.app"
              className="text-primary hover:text-primary/80 font-mono text-sm"
            >
              support@pickmyclass.app
            </a>{' '}
            for anything tied to your account: a watch that will not save, alerts that stopped
            arriving, a change to the email address we notify, or a data export or deletion request.
            Support is the only channel for account changes, because we never ask for your MyASU
            password and we will not take account actions from a public issue thread.
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Report a bug on GitHub
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            PickMyClass is{' '}
            <a
              href="https://github.com/Divkix/pickmyclass"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary/80"
            >
              open source
            </a>
            , so reproducible bugs and feature ideas are welcome in the{' '}
            <a
              href="https://github.com/Divkix/pickmyclass/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary/80"
            >
              GitHub issue tracker
            </a>
            . Issues are public: include the technical details, but never paste confirmation links,
            tokens, or the email address on your account.
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">
            What to include in a bug report
          </h2>
          <ul className="space-y-3 text-muted-foreground list-disc list-inside">
            <li>
              <strong className="text-foreground">The class section number and term.</strong> The
              5-digit class number you searched for (for example 12345) and the term, such as Fall
              2026, plus the campus or ASU Online if it matters.
            </li>
            <li>
              <strong className="text-foreground">What you expected and what happened.</strong> One
              sentence each. &ldquo;Expected a seat alert when the section opened, got
              nothing&rdquo; beats &ldquo;alerts are broken&rdquo;.
            </li>
            <li>
              <strong className="text-foreground">When it happened.</strong> A date and time with
              your timezone. Checks run every 30 minutes, so the minute matters more than you would
              expect.
            </li>
            <li>
              <strong className="text-foreground">Where it happened.</strong> The page or email
              involved, whether you were signed in, and the browser and device if it looks like a
              display problem.
            </li>
            <li>
              <strong className="text-foreground">The exact error text or a screenshot.</strong>{' '}
              Copy the message as it appears instead of paraphrasing it.
            </li>
          </ul>

          <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">How fast we reply</h2>
          <p className="text-muted-foreground leading-relaxed">
            This is a student-run project, not a staffed support desk, so there is no 24/7 queue.
            Most emails get a reply within a couple of business days, and we read GitHub issues as
            they come in. Privacy and data-deletion requests are handled within the response window
            described in the{' '}
            <Link href="/legal/privacy" className="text-primary hover:text-primary/80">
              privacy policy
            </Link>
            . During add/drop week, when seat alerts spike, expect us to be slower and your alerts
            to keep working regardless.
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Alerts are email-only
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            PickMyClass notifies you by email. There is no SMS, no push notification, and no
            phone-based alerting, so support cannot text you when a seat opens. If a text message is
            the only thing that reaches you during a lecture, keep your inbox notifications on for
            the email address you registered with — that is the channel every alert travels through.
          </p>

          <div className="not-prose mt-12 rounded-lg border border-primary/20 bg-primary/5 p-8 text-center">
            <h2 className="mb-2 text-2xl font-semibold text-foreground">
              Watching a section that is already full?
            </h2>
            <p className="mb-6 text-muted-foreground">
              Add it once and let PickMyClass check ASU class search every 30 minutes for you.
            </p>
            <Link
              href="/sign-up"
              className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
            >
              Get Started Free
            </Link>
          </div>
        </article>
      </main>
    </div>
  );
}
