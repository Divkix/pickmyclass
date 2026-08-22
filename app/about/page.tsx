import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { JsonLd } from '@/components/landing/JsonLd';

export const metadata: Metadata = {
  title: 'About PickMyClass — Built by ASU Students, for ASU Students',
  description:
    "PickMyClass is a free ASU class seat tracker built by students who've been there. Learn about our story, mission, and why 2,400+ Sun Devils trust us.",
  alternates: {
    canonical: '/about',
  },
  openGraph: {
    title: 'About PickMyClass — Built by ASU Students, for ASU Students',
    description:
      "Learn about PickMyClass's story, mission, and the students behind the free ASU class seat tracker.",
    type: 'website',
    url: 'https://pickmyclass.app/about',
    images: ['/og-image.png'],
  },
};

export const dynamic = 'error';

const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'PickMyClass',
  alternateName: ['Pick My Class', 'Pick A Class', 'PickAClass', 'PickaClass'],
  url: 'https://pickmyclass.app',
  logo: 'https://pickmyclass.app/apple-touch-icon.png',
  description: 'Free ASU class seat notification service built by ASU students',
  contactPoint: {
    '@type': 'ContactPoint',
    email: 'support@pickmyclass.app',
    contactType: 'customer service',
  },
  sameAs: ['https://github.com/Divkix/pickmyclass'],
};

export default async function AboutPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="flex-1 px-4 py-12 md:px-8">
        <article className="prose prose-neutral dark:prose-invert mx-auto max-w-3xl">
          <div className="not-prose mb-8">
            <h1 className="text-4xl font-semibold text-foreground sm:text-5xl leading-tight">
              About PickMyClass
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">
              Built by ASU students who got tired of refreshing MyASU every five minutes.
            </p>
          </div>

          <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">
            The Problem We Faced
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            It was add/drop week. I needed CSE 240 to stay on track for graduation, but every single
            section was full. So I did what every ASU student does: I opened MyASU in one tab, set a
            timer, and started refreshing.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Two days later, I was still refreshing. I missed a seat opening because I was in a
            meeting. Someone else got it in under three minutes. That was the moment I thought,
            &ldquo;There has to be a better way.&rdquo;
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">What We Built</h2>
          <p className="text-muted-foreground leading-relaxed">
            PickMyClass (some students search for it as &ldquo;Pick My Class&rdquo; or &ldquo;Pick A
            Class&rdquo;) is a free class seat tracker for ASU students. You add the classes you
            want, and we check the ASU class search every 30 minutes. When a seat opens up, you get
            an email immediately.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            It sounds simple because it is. No premium tiers. No ads. No tricks. Just a tool that
            does one thing well: making sure you never miss an open seat again.
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">Who We Are</h2>
          <p className="text-muted-foreground leading-relaxed">
            PickMyClass was built by current and former ASU students who understand the registration
            struggle firsthand. We are not a company. We are not affiliated with Arizona State
            University. We are just students who decided to build something useful instead of
            complaining about the system.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            The project is{' '}
            <a
              href="https://github.com/Divkix/pickmyclass"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary/80"
            >
              open source on GitHub
            </a>
            . That means anyone can see how it works, suggest improvements, or even contribute code.
            We believe transparency builds trust.
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">The Numbers So Far</h2>
          <div className="not-prose grid grid-cols-1 sm:grid-cols-3 gap-4 my-6">
            <div className="rounded-lg border border-border bg-card p-5 text-center">
              <div className="text-3xl font-bold text-foreground">2,400+</div>
              <div className="text-sm text-muted-foreground mt-1">Active Sun Devils</div>
            </div>
            <div className="rounded-lg border border-border bg-card p-5 text-center">
              <div className="text-3xl font-bold text-foreground">15,000+</div>
              <div className="text-sm text-muted-foreground mt-1">Classes Monitored</div>
            </div>
            <div className="rounded-lg border border-border bg-card p-5 text-center">
              <div className="text-3xl font-bold text-foreground">8,500+</div>
              <div className="text-sm text-muted-foreground mt-1">Seats Secured</div>
            </div>
          </div>

          <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">Our Philosophy</h2>
          <p className="text-muted-foreground leading-relaxed">We have three rules:</p>
          <ol className="space-y-3 text-muted-foreground list-decimal list-inside">
            <li>
              <strong className="text-foreground">Stay free.</strong> PickMyClass will never charge
              students. Registration is already stressful enough without adding another
              subscription.
            </li>
            <li>
              <strong className="text-foreground">Stay simple.</strong> No unnecessary features, no
              confusing interfaces. One button to add a class, one email when it opens.
            </li>
            <li>
              <strong className="text-foreground">Stay honest.</strong> We tell you exactly what we
              do and how we do it. No hidden data collection, no selling your email to advertisers.
            </li>
          </ol>

          <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Not Affiliated With ASU
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            PickMyClass is an independent project. We are not endorsed by, sponsored by, or
            affiliated with Arizona State University. We use publicly available class search data to
            monitor seat availability — the same data any student can access by visiting the ASU
            class search page.
          </p>

          <div className="not-prose mt-12 rounded-lg border border-primary/20 bg-primary/5 p-8 text-center">
            <h2 className="mb-2 text-2xl font-semibold text-foreground">
              Stop refreshing. Start tracking.
            </h2>
            <p className="mb-6 text-muted-foreground">
              Join 2,400+ Sun Devils who never miss an open seat.
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

      <JsonLd data={organizationSchema} />
    </div>
  );
}
