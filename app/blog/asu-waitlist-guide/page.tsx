import type { Metadata } from 'next';
import Link from 'next/link';
import { BlogAuthor, BlogFAQ, FAQSchema, KeyTakeaways, TableOfContents } from '@/components/blog';
import { Header } from '@/components/Header';
import { JsonLd } from '@/components/landing/JsonLd';

export const metadata: Metadata = {
  title: "ASU Waitlist Guide: How It Actually Works (And Why Most Classes Don't Have One)",
  description:
    "Confused about ASU waitlists? Learn how ASU's waitlist system actually works, which classes have them, and what to do when there's no waitlist available.",
  alternates: {
    canonical: '/blog/asu-waitlist-guide',
  },
  openGraph: {
    title: "ASU Waitlist Guide: How It Actually Works (And Why Most Classes Don't Have One)",
    description:
      "Learn how ASU's waitlist system actually works, which classes have them, and what to do when there's no waitlist.",
    type: 'article',
    publishedTime: '2026-04-26T00:00:00Z',
    images: ['/og-image.png'],
  },
};

export const dynamic = 'error';

const articleSchema = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: "ASU Waitlist Guide: How It Actually Works (And Why Most Classes Don't Have One)",
  description:
    "Confused about ASU waitlists? Learn how ASU's waitlist system actually works, which classes have them, and what to do when there's no waitlist available.",
  datePublished: '2026-04-26T00:00:00Z',
  dateModified: '2026-05-08T00:00:00Z',
  author: { '@type': 'Person', name: 'PickMyClass Team', url: 'https://pickmyclass.app' },
  publisher: {
    '@type': 'Organization',
    name: 'PickMyClass',
    url: 'https://pickmyclass.app',
  },
  mainEntityOfPage: 'https://pickmyclass.app/blog/asu-waitlist-guide',
};

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://pickmyclass.app/' },
    { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://pickmyclass.app/blog' },
    { '@type': 'ListItem', position: 3, name: 'ASU Waitlist Guide' },
  ],
};

const tocItems = [
  { id: 'how-waitlists-work', text: 'How ASU "Waitlists" Actually Work', level: 2 },
  { id: 'check-waitlist', text: 'How to Check if Your Class Has a Waitlist', level: 2 },
  { id: 'no-waitlist', text: "What to Do If There's No Waitlist", level: 2 },
  { id: 'faq', text: 'Frequently Asked Questions', level: 2 },
];

const faqItems = [
  {
    question: 'What does waitlist position 1 mean?',
    answer:
      "If you're in position 1 on a waitlist, you're first in line to get a seat when one opens up. However, most ASU classes don't have waitlists at all. This only applies to the specific departments that use them, like some W. P. Carey courses.",
  },
  {
    question: "How long do I have to register if I'm waitlisted?",
    answer:
      "If you get off a waitlist, ASU typically gives you 24 hours to register for the class. You'll receive an email notification, and the seat is held for you during this window. After 24 hours, the offer expires and moves to the next person on the list.",
  },
  {
    question: 'Can I be on multiple waitlists?',
    answer:
      "For classes that offer waitlists, yes. You can typically join multiple waitlists. However, remember that most ASU classes don't have waitlists at all, so you'll need alternative strategies for those.",
  },
  {
    question: 'Do waitlists carry over to next semester?',
    answer:
      "No. Waitlists are semester-specific. If you don't get into a class this semester, you'll need to try again next semester from scratch.",
  },
  {
    question: "Why doesn't ASU have waitlists for all classes?",
    answer:
      'ASU is a huge university with complex registration needs. Setting up a universal waitlist across all colleges and departments would take a lot of technical and administrative work. Some departments have built their own solutions, while others just rely on manual monitoring.',
  },
  {
    question: "Does being on a waitlist guarantee I'll get in?",
    answer:
      "No. Being on a waitlist only means you'll be notified if a seat opens. There's no guarantee seats will become available, especially in high-demand classes where many students want in.",
  },
  {
    question: 'Can I see my waitlist position in MyASU?',
    answer:
      "For classes that have waitlists, yes. MyASU will show your position number. If you don't see a waitlist option or position, that class likely doesn't offer waitlist functionality.",
  },
  {
    question: "What's the 24-hour waitlist rule?",
    answer:
      "When you're notified that a seat is available from a waitlist, you have 24 hours to register. If you don't act within that window, your spot is forfeited and offered to the next person in line.",
  },
];

export default async function ASUWaitlistGuidePost() {
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
              <span className="text-foreground">ASU Waitlist Guide</span>
            </nav>
          </div>

          <div className="not-prose mb-8">
            <h1 className="text-4xl font-semibold text-foreground sm:text-5xl leading-tight">
              ASU Waitlist Guide: How It Actually Works (And Why Most Classes Don&apos;t Have One)
            </h1>
            <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
              <time dateTime="2026-04-26">April 26, 2026</time>
              <span>6 min read</span>
            </div>
          </div>

          <p className="text-lg text-muted-foreground leading-relaxed">
            You keep hearing other students talk about their &ldquo;waitlist position&rdquo; and
            wondering why your full class does not have one. You are not alone. This is one of the
            most confusing parts of ASU registration. Here is the deal.
          </p>

          <KeyTakeaways
            items={[
              {
                text: 'ASU does not have a university-wide waitlist. Only specific departments use them',
              },
              {
                text: 'Most engineering, science, and general education classes have no waitlist at all',
              },
              {
                text: 'If a class does have a waitlist, you get 24 hours to register once a seat opens',
              },
              { text: 'For classes without waitlists, automated seat tracking is your best bet' },
              {
                text: 'Attending the first class and talking to the professor can still get you in',
              },
            ]}
          />

          <TableOfContents items={tocItems} />

          <h2 id="how-waitlists-work" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            How ASU &ldquo;Waitlists&rdquo; Actually Work
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Most students are surprised to learn this:{' '}
            <strong className="text-foreground">
              ASU does not have a traditional, university-wide waitlist system
            </strong>{' '}
            like many other colleges. Individual departments can choose to implement their own
            waitlist functionality on a case-by-case basis.
          </p>
          <p className="text-muted-foreground leading-relaxed">This means:</p>
          <ul className="space-y-2 text-muted-foreground">
            <li>Some W. P. Carey business courses have waitlists</li>
            <li>Some Barrett Honors College seminars have waitlists</li>
            <li>Most engineering, science, and liberal arts classes do NOT have waitlists</li>
            <li>Most general education classes do NOT have waitlists</li>
          </ul>
          <p className="text-muted-foreground leading-relaxed">
            For the classes that do have waitlists, here is how they work. When a class is full, you
            can join the waitlist. If someone drops, the first person on the waitlist gets an email
            notification and has 24 hours to register for the open seat. If they do not act, the
            offer moves to the next person.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            <strong className="text-foreground">The catch:</strong> Most classes simply do not offer
            this option. When a class fills, you are on your own to manually check for openings or
            use an automated tracking tool.
          </p>

          <h2 id="check-waitlist" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            How to Check if Your Class Has a Waitlist
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            To see if a specific class offers waitlist functionality:
          </p>
          <ol className="space-y-3 text-muted-foreground list-decimal list-inside">
            <li>
              Go to the{' '}
              <a
                href="https://catalog.apps.asu.edu/catalog/classes"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-primary/80"
              >
                ASU Class Search
              </a>
            </li>
            <li>Find the specific class section you want</li>
            <li>Click on the section for details</li>
            <li>Look for a &ldquo;Waitlist&rdquo; option or indicator</li>
          </ol>
          <p className="text-muted-foreground leading-relaxed mt-4">
            If you see a waitlist option, you can join it. If not, that class does not offer
            waitlist functionality, and you will need to use alternative strategies.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Quick tip:</strong> In MyASU during registration, if
            a class shows as full but has a waitlist available, you will typically see a
            &ldquo;Waitlist&rdquo; button or option next to the class. If you only see
            &ldquo;Closed&rdquo; with no waitlist option, you are out of luck for that feature.
          </p>

          <h2 id="no-waitlist" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            What to Do If There&apos;s No Waitlist
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Since most ASU classes do not have waitlists, you need a backup plan. These are the
            strategies that actually work:
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Option 1: Automated Seat Tracking (Recommended)
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Use{' '}
            <Link href="/" className="text-primary hover:text-primary/80 font-medium">
              PickMyClass
            </Link>{' '}
            to automatically monitor the class for open seats. It checks every 30 minutes and emails
            you when a seat opens. It is basically a personal waitlist that works for every class,
            not just the few that have official ones.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            While other students are manually refreshing MyASU, you get instant notifications and
            can register before anyone else notices the opening. It saves a lot of stress.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Option 2: Manual Monitoring During Add/Drop Week
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            The first week of classes sees the most schedule changes. Students drop classes
            constantly as they adjust their schedules. Check the class search multiple times per day
            during this period, especially:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>Sunday evenings (when students finalize their schedules)</li>
            <li>Monday and Tuesday of the first week</li>
            <li>
              Any day after the first class meeting (students drop if they do not like the
              professor)
            </li>
          </ul>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Option 3: Contact the Professor
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Attend the first class meeting even if you are not enrolled. Introduce yourself to the
            professor after class and explain your situation professionally. Some professors can
            issue capacity overrides, especially if:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>You need the class to graduate this semester</li>
            <li>It is a required course for your major with no other sections</li>
            <li>You have a compelling academic reason</li>
          </ul>
          <p className="text-muted-foreground leading-relaxed">
            Honestly, bring an add form and be respectful. Professors are more likely to help
            students who come prepared and show genuine need. It works more often than you would
            think.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Option 4: Use the Other Strategies
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            We cover seven strategies in our guide to{' '}
            <Link
              href="/blog/how-to-get-into-full-asu-classes"
              className="text-primary hover:text-primary/80 font-medium"
            >
              getting into full ASU classes
            </Link>
            . From backup schedules to advisor help, there are multiple approaches that work when
            waitlists are not available.
          </p>

          <div className="not-prose mt-10 rounded-lg border border-primary/20 bg-primary/5 p-8 text-center">
            <h2 className="mb-2 text-2xl font-semibold text-foreground">
              Most classes do not have waitlists
            </h2>
            <p className="mb-6 text-muted-foreground">
              PickMyClass monitors ASU classes 24/7 and emails you when seats open. The waitlist
              alternative that actually works.
            </p>
            <Link
              href="/register"
              className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
            >
              Start Tracking Free
            </Link>
          </div>

          <h2 id="faq" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Frequently Asked Questions
          </h2>
          <BlogFAQ items={faqItems} />
          <FAQSchema items={faqItems} />

          <BlogAuthor
            name="PickMyClass Team"
            title="PickMyClass Founder"
            bio="Built PickMyClass after experiencing the frustration of missing registration for a required class. Now helping thousands of Sun Devils get the classes they need."
          />

          <div className="not-prose mt-8 border-t border-border pt-6">
            <h3 className="text-sm font-semibold text-foreground mb-3">Related Articles</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link
                  href="/blog/how-to-get-into-full-asu-classes"
                  className="text-primary hover:text-primary/80 transition-colors"
                >
                  How to Get Into Full Classes at ASU: 7 Strategies That Work
                </Link>
              </li>
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
                  href="/blog/asu-registration-tips"
                  className="text-primary hover:text-primary/80 transition-colors"
                >
                  ASU Registration Tips: Build Your Perfect Schedule
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
