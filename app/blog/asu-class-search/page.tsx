import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BlogAuthor,
  BlogCTA,
  BlogFAQ,
  KeyTakeaways,
  RelatedArticles,
  ShortAnswer,
  TableOfContents,
} from '@/components/blog';
import { Header } from '@/components/Header';
import { JsonLd } from '@/components/landing/JsonLd';

export const metadata: Metadata = {
  title: 'ASU Class Search: How to Find Open Classes Fast (2026 Guide)',
  description:
    'A student guide to ASU Class Search. Find open sections, filter by campus and seats, decode the section number, and get alerted the second a full class opens up.',
  alternates: {
    canonical: '/blog/asu-class-search',
  },
  openGraph: {
    title: 'ASU Class Search: How to Find Open Classes Fast (2026 Guide)',
    description:
      'Find open ASU sections fast. Filter by campus and seats, decode the section number, and get alerted when a full class opens.',
    type: 'article',
    publishedTime: '2026-06-18T00:00:00Z',
    modifiedTime: '2026-06-18T00:00:00Z',
    images: ['/og-image.png'],
  },
};

export const dynamic = 'error';

const articleSchema = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'ASU Class Search: How to Find Open Classes Fast (2026 Guide)',
  description:
    'A student guide to ASU Class Search. Find open sections, filter by campus and seats, decode the section number, and get alerted the second a full class opens up.',
  datePublished: '2026-06-18T00:00:00Z',
  dateModified: '2026-06-18T00:00:00Z',
  author: { '@type': 'Person', name: 'PickMyClass Team', url: 'https://pickmyclass.app' },
  publisher: {
    '@type': 'Organization',
    name: 'PickMyClass',
    url: 'https://pickmyclass.app',
  },
  mainEntityOfPage: 'https://pickmyclass.app/blog/asu-class-search',
};

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://pickmyclass.app/' },
    { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://pickmyclass.app/blog' },
    { '@type': 'ListItem', position: 3, name: 'ASU Class Search' },
  ],
};

const tocItems = [
  { id: 'where', text: 'Where to Find ASU Class Search', level: 2 },
  { id: 'filters', text: 'The Filters That Actually Matter', level: 2 },
  { id: 'open-only', text: 'How to Show Only Open Classes', level: 2 },
  { id: 'section-number', text: 'What the 5-Digit Section Number Means', level: 2 },
  { id: 'full-classes', text: 'What to Do When Every Section Is Full', level: 2 },
  { id: 'faq', text: 'Frequently Asked Questions', level: 2 },
];

const faqItems = [
  {
    question: 'What is the ASU class search website?',
    answer:
      'The official ASU Class Search lives at catalog.apps.asu.edu/catalog/classes. It is open to everyone, no login required, and it lists every class section ASU offers each term, including seat counts, instructors, meeting times, and campus.',
  },
  {
    question: 'Do I need to log into MyASU to search for classes?',
    answer:
      'No. You can browse the public ASU Class Search without logging in. You only need MyASU when you actually register, which requires your enrollment appointment to have started.',
  },
  {
    question: 'How do I see only classes with open seats?',
    answer:
      'Set the "Open" filter (sometimes labeled "Open seats") before you search. ASU then hides full and reserved sections. Keep in mind a class can fill again between page loads, so refresh before you commit.',
  },
  {
    question: 'What does the 5-digit number next to a class mean?',
    answer:
      'That is the class number (section number). It uniquely identifies one specific section of a course, including its time, instructor, and campus. You enter it directly into MyASU to register, which is faster than searching again.',
  },
  {
    question: 'Why does ASU Class Search show a class as open when it is actually full?',
    answer:
      'Seat counts update on a delay and other students register at the same time you do. A section can read "3 open" and be full by the time you hit register. Acting quickly and tracking the section both help.',
  },
  {
    question: 'Can I get notified when a full class opens up in ASU Class Search?',
    answer:
      'Yes. PickMyClass watches the ASU Class Search for you and emails you the moment a seat opens in a section you are tracking, so you do not have to keep searching manually.',
  },
];

export default async function ASUClassSearchPost() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 px-4 py-12 md:px-8">
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
              <span className="text-foreground">ASU Class Search</span>
            </nav>
          </div>

          <div className="not-prose mb-8">
            <h1 className="text-4xl font-semibold text-foreground sm:text-5xl leading-tight">
              ASU Class Search: How to Find Open Classes Fast
            </h1>
            <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
              <time dateTime="2026-06-18">June 18, 2026</time>
              <span>7 min read</span>
            </div>
          </div>

          <p className="text-lg text-muted-foreground leading-relaxed">
            ASU Class Search holds every section the university offers, but the default view buries
            the one thing you care about: which classes still have open seats. Here is how to cut
            through it and find the sections you can actually register for.
          </p>

          <ShortAnswer>
            Go to{' '}
            <a
              href="https://catalog.apps.asu.edu/catalog/classes"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary/80"
            >
              ASU Class Search
            </a>
            , pick your term, type the subject and course number, then turn on the
            &ldquo;Open&rdquo; filter so only sections with seats show up. Each result has a 5-digit
            class number you paste straight into MyASU to register.
          </ShortAnswer>

          <KeyTakeaways
            items={[
              { text: 'ASU Class Search is public, no MyASU login needed to browse' },
              { text: 'Set the term first, then filter by Open seats to hide full sections' },
              {
                text: 'The 5-digit class number is the fastest way to register in MyASU',
              },
              {
                text: 'Seat counts lag, so a class marked open can fill before you register',
              },
              {
                text: 'When every section is full, track it and let an alert catch the opening',
              },
            ]}
          />

          <TableOfContents items={tocItems} />

          <h2 id="where" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Where to Find ASU Class Search
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            There are two doors to the same room. The public one is{' '}
            <a
              href="https://catalog.apps.asu.edu/catalog/classes"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary/80"
            >
              catalog.apps.asu.edu/catalog/classes
            </a>
            . Anyone can use it, no sign-in required, and it has the same class data you see inside
            MyASU. Use it to plan before your enrollment window opens.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            The second door is the class search inside MyASU. It looks a little different, but it
            pulls from the same source. The only thing MyASU adds is the ability to register, which
            you can only do once your appointment time arrives.
          </p>

          <h2 id="filters" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            The Filters That Actually Matter
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Most students type a course name and scroll. You will move faster if you set these
            first:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Term.</strong> Pick the right semester before
              anything else. Searching the wrong term is the most common reason a class &ldquo;does
              not exist.&rdquo;
            </li>
            <li>
              <strong className="text-foreground">Subject and catalog number.</strong> Search
              &ldquo;CSE 240&rdquo; instead of the full course title. It is more reliable.
            </li>
            <li>
              <strong className="text-foreground">Campus or location.</strong> Filter to Tempe,
              Downtown Phoenix, Polytechnic, West, or ASU Online so you are not scrolling past
              sections you cannot attend.
            </li>
            <li>
              <strong className="text-foreground">Session.</strong> Fall and Spring have A, B, and C
              sessions. If you only want full-semester classes, set it to C.
            </li>
          </ul>

          <h2 id="open-only" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            How to Show Only Open Classes
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            This is the filter that saves the most time. Turn on{' '}
            <strong className="text-foreground">&ldquo;Open&rdquo;</strong> (sometimes shown as
            &ldquo;Open seats&rdquo;) before you run the search. ASU then drops every full and
            reserved section, so you only see sections you can register for right now.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            One catch: seat data is a snapshot, not a live feed. A section can read open and be gone
            by the time you click into MyASU. Refresh the page right before you register, and have
            the class number ready to paste.
          </p>

          <h2 id="section-number" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            What the 5-Digit Section Number Means
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Every section has a 5-digit class number, like 12345. It points to one exact section:
            this instructor, this time, this campus. When you register in MyASU, typing that number
            is faster than searching again, and it removes any chance of adding the wrong section.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Copy the class number for every section you are considering, including backups. If you
            are tracking a full class, this is also the number you will hand to a seat tracker so it
            watches the right one.
          </p>

          <h2 id="full-classes" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            What to Do When Every Section Is Full
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Sooner or later the &ldquo;Open&rdquo; filter returns nothing. Every section of the
            class you need is full. Searching again every hour is a losing game, because seats open
            and close in minutes and you cannot watch all day.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            This is where{' '}
            <Link href="/" className="text-primary hover:text-primary/80 font-medium">
              PickMyClass
            </Link>{' '}
            helps. Add the full section to your watchlist and it checks ASU Class Search every 30
            minutes, then emails you the second a seat opens. You stop searching and just wait for
            the alert. For the bigger playbook, read our guide on{' '}
            <Link
              href="/blog/how-to-get-into-full-asu-classes"
              className="text-primary hover:text-primary/80 font-medium"
            >
              getting into full ASU classes
            </Link>{' '}
            and how the{' '}
            <Link
              href="/blog/asu-waitlist-guide"
              className="text-primary hover:text-primary/80 font-medium"
            >
              ASU waitlist actually works
            </Link>
            .
          </p>

          <BlogCTA
            heading="Found a full class you need?"
            description="PickMyClass watches ASU Class Search and emails you the moment a seat opens. Free for every Sun Devil."
          />

          <h2 id="faq" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Frequently Asked Questions
          </h2>
          <BlogFAQ items={faqItems} />

          <BlogAuthor
            name="PickMyClass Team"
            title="PickMyClass Founder"
            bio="Built PickMyClass after missing registration for a required class. Now helping thousands of Sun Devils find and get the classes they need."
          />

          <RelatedArticles
            articles={[
              {
                href: '/blog/myasu-search-tips',
                title: "MyASU Class Search: 10 Hidden Features Most Students Don't Know",
              },
              {
                href: '/blog/asu-class-seat-tracker',
                title: 'ASU Class Seat Tracker: How to Get Notified When Seats Open',
              },
              {
                href: '/blog/how-to-register-for-classes-at-asu',
                title: 'How to Register for Classes at ASU: Step-by-Step',
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
