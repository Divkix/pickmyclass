import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BlogAuthor,
  BlogCTA,
  BlogFAQ,
  BlogPostHeader,
  KeyTakeaways,
  RelatedArticles,
  ShortAnswer,
  TableOfContents,
} from '@/components/blog';
import { Header } from '@/components/Header';
import { JsonLd } from '@/components/landing/JsonLd';

export const metadata: Metadata = {
  title: 'Find Open ASU Classes & Track Full Courses',
  description:
    "Use ASU Class Search to review sections and availability. If a section is full, check ASU's options or track it for seat-opening email alerts.",
  alternates: {
    canonical: '/blog/asu-class-search',
  },
  openGraph: {
    title: 'Find Open ASU Classes: Search Sections and Track Full Courses',
    description:
      "Use ASU Class Search to review sections and availability. If a section is full, check ASU's options or track it for seat-opening email alerts.",
    type: 'article',
    publishedTime: '2026-06-18T00:00:00Z',
    modifiedTime: '2026-09-28T00:00:00Z',
    images: ['/og-image.png'],
  },
};

export const dynamic = 'error';

const articleSchema = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Find Open ASU Classes: Search Sections and Track Full Courses',
  description:
    "Use ASU Class Search to review sections and availability. If a section is full, check ASU's options or track it for seat-opening email alerts.",
  datePublished: '2026-06-18T00:00:00Z',
  dateModified: '2026-09-28T00:00:00Z',
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
  { id: 'where', text: 'Start With ASU Class Search', level: 2 },
  { id: 'full-classes', text: 'If a Section Is Full', level: 2 },
  { id: 'monitoring', text: 'Track a Section for Seat Updates', level: 2 },
  { id: 'faq', text: 'Frequently Asked Questions', level: 2 },
];

const faqItems = [
  {
    question: 'Where can I review ASU class sections?',
    answer: 'Use ASU Class Search to review section information and current availability.',
  },
  {
    question: 'What should I do if a section is full?',
    answer:
      'Confirm with ASU or your advisor which enrollment options, if any, apply to that section.',
  },
  {
    question: 'Does PickMyClass register me for a class?',
    answer:
      'No. PickMyClass checks watched sections every 30 minutes and emails when it detects an opening; you still register through ASU.',
  },
  {
    question: 'Does an alert guarantee a seat?',
    answer:
      'No. Seat availability can change, and an alert does not reserve a seat or guarantee enrollment.',
  },
];

export default async function ASUClassSearchPost() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 px-4 py-12 md:px-8">
        <article className="prose prose-neutral dark:prose-invert mx-auto max-w-3xl">
          <BlogPostHeader
            breadcrumb="ASU Class Search"
            title="Find Open ASU Classes: Search Sections and Track Full Courses"
            dateTime="2026-06-18"
            date="June 18, 2026"
            readTime="4 min read"
          />

          <ShortAnswer>
            To find an ASU class section, start with the official{' '}
            <a
              href="https://catalog.apps.asu.edu/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary/80"
            >
              ASU Class Search
            </a>{' '}
            and review the current availability there. If the section you need is full, confirm with
            ASU which options apply. PickMyClass checks watched sections every 30 minutes and emails
            when it detects an opening; it does not register you or guarantee a seat.
          </ShortAnswer>

          <KeyTakeaways
            items={[
              { text: 'Use ASU Class Search to review official section information.' },
              { text: 'Confirm availability with ASU before registering; seat status can change.' },
              { text: 'Check with ASU which options, if any, apply when a section is full.' },
              {
                text: 'PickMyClass checks watched sections every 30 minutes and emails on detected openings.',
              },
              { text: 'An alert does not reserve a seat or guarantee enrollment.' },
            ]}
          />

          <TableOfContents items={tocItems} />

          <h2 id="where" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Start With ASU Class Search
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Use the official ASU catalog to review the sections offered and their current
            availability. Check the latest information with ASU before making a registration
            decision; availability can change.
          </p>

          <h2 id="full-classes" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            If a Section Is Full
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Enrollment options depend on the specific section and ASU rules. Confirm with ASU or
            your advisor whether a waitlist or another option applies. Our{' '}
            <Link
              href="/blog/asu-waitlist-guide"
              className="text-primary hover:text-primary/80 font-medium"
            >
              ASU waitlist guide
            </Link>{' '}
            explains what to check when a class is full.
          </p>

          <h2 id="monitoring" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Track a Section for Seat Updates
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            If you are waiting for a specific section, PickMyClass checks watched sections every 30
            minutes and emails when a check detects an opening. You still complete registration
            through ASU, and a notification does not guarantee that a seat remains available.
            Compare tools in our{' '}
            <Link
              href="/blog/best-asu-class-seat-tracker"
              className="text-primary hover:text-primary/80 font-medium"
            >
              ASU class seat tracker comparison
            </Link>
            .
          </p>

          <BlogCTA
            heading="Waiting for a full class?"
            description="PickMyClass checks watched ASU sections every 30 minutes and emails when it detects an opening. Alerts do not enroll you or guarantee a seat."
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
                href: '/blog/asu-waitlist-guide',
                title: 'ASU Waitlist Guide: Full Classes and Next Steps',
              },
              {
                href: '/blog/best-asu-class-seat-tracker',
                title: 'Best ASU Class Seat Tracker: Compare Your Options',
              },
              {
                href: '/blog/how-to-get-into-full-asu-classes',
                title: 'How to Get Into Full Classes at ASU',
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
