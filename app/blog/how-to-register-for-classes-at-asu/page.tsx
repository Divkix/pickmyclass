import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BlogAuthor,
  BlogCTA,
  BlogFAQ,
  FAQSchema,
  KeyTakeaways,
  ShortAnswer,
  TableOfContents,
} from '@/components/blog';
import { Header } from '@/components/Header';
import { JsonLd } from '@/components/landing/JsonLd';

export const metadata: Metadata = {
  title: 'How to Register for Classes at ASU: Step-by-Step (2026)',
  description:
    'A step-by-step guide to registering for classes at ASU. Find your enrollment date, clear holds, add classes in MyASU by section number, and fix the errors that block you.',
  alternates: {
    canonical: '/blog/how-to-register-for-classes-at-asu',
  },
  openGraph: {
    title: 'How to Register for Classes at ASU: Step-by-Step (2026)',
    description:
      'Find your enrollment date, clear holds, add classes in MyASU by section number, and fix the errors that block registration.',
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
  headline: 'How to Register for Classes at ASU: Step-by-Step (2026)',
  description:
    'A step-by-step guide to registering for classes at ASU. Find your enrollment date, clear holds, add classes in MyASU by section number, and fix the errors that block you.',
  datePublished: '2026-06-18T00:00:00Z',
  dateModified: '2026-06-18T00:00:00Z',
  author: { '@type': 'Person', name: 'PickMyClass Team', url: 'https://pickmyclass.app' },
  publisher: {
    '@type': 'Organization',
    name: 'PickMyClass',
    url: 'https://pickmyclass.app',
  },
  mainEntityOfPage: 'https://pickmyclass.app/blog/how-to-register-for-classes-at-asu',
};

const howToSchema = {
  '@context': 'https://schema.org',
  '@type': 'HowTo',
  name: 'How to Register for Classes at ASU',
  description: 'Register for ASU classes through MyASU once your enrollment appointment opens.',
  step: [
    {
      '@type': 'HowToStep',
      name: 'Find your enrollment appointment',
      text: 'Check MyASU under My Classes for the date and time your registration window opens. You cannot register before it.',
    },
    {
      '@type': 'HowToStep',
      name: 'Clear any holds',
      text: 'Resolve advising, financial, or immunization holds in MyASU before your window, since holds block registration.',
    },
    {
      '@type': 'HowToStep',
      name: 'Build your cart with section numbers',
      text: 'Use ASU Class Search to pick sections and copy each 5-digit class number, including backups.',
    },
    {
      '@type': 'HowToStep',
      name: 'Add classes when your window opens',
      text: 'In MyASU, enter the class numbers and submit. Register the moment your appointment starts for the best odds.',
    },
  ],
};

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://pickmyclass.app/' },
    { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://pickmyclass.app/blog' },
    { '@type': 'ListItem', position: 3, name: 'How to Register for Classes at ASU' },
  ],
};

const tocItems = [
  { id: 'enrollment-date', text: 'Step 1: Find Your Enrollment Date', level: 2 },
  { id: 'clear-holds', text: 'Step 2: Clear Your Holds Early', level: 2 },
  { id: 'build-cart', text: 'Step 3: Build Your Cart With Section Numbers', level: 2 },
  { id: 'register', text: 'Step 4: Register the Minute Your Window Opens', level: 2 },
  { id: 'errors', text: 'Common Registration Errors (and Fixes)', level: 2 },
  { id: 'full-classes', text: 'What If the Class You Need Is Full?', level: 2 },
  { id: 'faq', text: 'Frequently Asked Questions', level: 2 },
];

const faqItems = [
  {
    question: 'When can I register for classes at ASU?',
    answer:
      'You register during your assigned enrollment appointment, a specific date and time shown in MyASU. Appointments are staggered, usually giving priority to students with more earned credit hours. You cannot register before your window opens.',
  },
  {
    question: 'Where do I actually register for ASU classes?',
    answer:
      'Inside MyASU, under My Classes. ASU Class Search lets you browse and plan without logging in, but adding a class to your schedule happens in MyASU once your appointment starts.',
  },
  {
    question: 'Why can I not register even though my appointment started?',
    answer:
      'A hold is the usual cause. Advising, financial, immunization, and other holds block registration until you resolve them. Check the Holds section of MyASU and clear everything before your window opens.',
  },
  {
    question: 'How do I add a class by section number?',
    answer:
      'Copy the 5-digit class number from ASU Class Search, then enter it in the add-class field in MyASU. This is faster and more accurate than searching for the class again inside MyASU.',
  },
  {
    question: 'What does a closed or full class mean during registration?',
    answer:
      'It means every seat in that section is taken. You cannot add it until a seat opens or, for the few classes that offer it, until you move up a waitlist. Tracking the section lets you jump on an opening fast.',
  },
  {
    question: 'Can I change my schedule after I register?',
    answer:
      'Yes. During the add/drop period at the start of the term you can swap, add, and drop classes. This is also when the most seats open up as other students adjust their schedules.',
  },
];

export default async function HowToRegisterAtASUPost() {
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
              <span className="text-foreground">How to Register for Classes at ASU</span>
            </nav>
          </div>

          <div className="not-prose mb-8">
            <h1 className="text-4xl font-semibold text-foreground sm:text-5xl leading-tight">
              How to Register for Classes at ASU: Step-by-Step
            </h1>
            <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
              <time dateTime="2026-06-18">June 18, 2026</time>
              <span>8 min read</span>
            </div>
          </div>

          <p className="text-lg text-muted-foreground leading-relaxed">
            ASU registration is mostly waiting, then a 90-second sprint. The students who get the
            schedule they want are the ones who did the prep before their window opened. Here is the
            whole process, in order, plus the errors that trip people up.
          </p>

          <ShortAnswer>
            To register for classes at ASU: find your enrollment appointment in MyASU, clear any
            holds, copy the 5-digit class numbers for the sections you want from ASU Class Search,
            then add them in MyASU the minute your window opens. Register early, because seats in
            popular classes go fast.
          </ShortAnswer>

          <KeyTakeaways
            items={[
              { text: 'Your enrollment appointment is a fixed date and time in MyASU' },
              { text: 'Holds block registration, so clear them days before your window' },
              { text: 'Prep your cart with 5-digit class numbers, including backups' },
              { text: 'Register the exact minute your appointment opens for the best odds' },
              { text: 'If a class is full, track it and get an alert when a seat opens' },
            ]}
          />

          <TableOfContents items={tocItems} />

          <h2 id="enrollment-date" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Step 1: Find Your Enrollment Date
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            ASU does not open registration to everyone at once. You get an{' '}
            <strong className="text-foreground">enrollment appointment</strong>, a specific date and
            time, shown in MyASU under My Classes. Appointments are staggered, and students with
            more earned credits usually go earlier. Find yours and put it in your calendar with a
            reminder.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            You cannot register one second before this window. So the goal is simple: be fully
            prepared and logged in when the clock hits your time.
          </p>

          <h2 id="clear-holds" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Step 2: Clear Your Holds Early
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            A hold is the single most common reason a student watches their window open and still
            cannot register. Check the Holds section of MyASU now, not the night before. Common ones
            include:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>Advising holds (you need to meet with your advisor)</li>
            <li>Financial holds (an unpaid balance)</li>
            <li>Immunization or health holds</li>
            <li>New-student or orientation holds</li>
          </ul>
          <p className="text-muted-foreground leading-relaxed mt-4">
            Some of these take days to resolve. An advising hold can mean booking an appointment
            that is not available until next week. Clear them with time to spare.
          </p>

          <h2 id="build-cart" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Step 3: Build Your Cart With Section Numbers
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Do not go hunting for classes during your window. Use{' '}
            <Link
              href="/blog/asu-class-search"
              className="text-primary hover:text-primary/80 font-medium"
            >
              ASU Class Search
            </Link>{' '}
            ahead of time to pick your sections and copy each 5-digit class number. Build a plan
            that includes:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>Your first-choice section for each class</li>
            <li>A backup section (different time or instructor) for each</li>
            <li>One alternate class in case a requirement is completely full</li>
          </ul>
          <p className="text-muted-foreground leading-relaxed mt-4">
            We go deeper on building a bulletproof plan in our{' '}
            <Link
              href="/blog/asu-registration-tips"
              className="text-primary hover:text-primary/80 font-medium"
            >
              ASU registration tips
            </Link>{' '}
            guide.
          </p>

          <h2 id="register" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Step 4: Register the Minute Your Window Opens
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            When your appointment starts, log into MyASU, go to the add-class screen, enter your
            class numbers, and submit. Add your most competitive class first, because those seats
            disappear quickest. Every minute you wait, more students with the same window are
            grabbing the same seats.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Be logged in and on the registration page a couple of minutes early. Refresh right at
            your start time. The difference between getting a class and missing it is often under
            five minutes.
          </p>

          <h2 id="errors" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Common Registration Errors (and Fixes)
          </h2>
          <ul className="space-y-3 text-muted-foreground">
            <li>
              <strong className="text-foreground">&ldquo;Hold on your record.&rdquo;</strong> Go
              clear the hold in MyASU, then try again.
            </li>
            <li>
              <strong className="text-foreground">&ldquo;Requisites not met.&rdquo;</strong> You are
              missing a prerequisite. Contact the department or your advisor for an override.
            </li>
            <li>
              <strong className="text-foreground">&ldquo;Time conflict.&rdquo;</strong> Two sections
              overlap. Swap one for a different meeting time.
            </li>
            <li>
              <strong className="text-foreground">&ldquo;Class is full / closed.&rdquo;</strong> No
              seats left. Track the section so you know the moment one opens (more below).
            </li>
            <li>
              <strong className="text-foreground">
                &ldquo;Department consent required.&rdquo;
              </strong>{' '}
              Email the department for permission to add the class.
            </li>
          </ul>

          <h2 id="full-classes" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            What If the Class You Need Is Full?
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            This is the moment registration falls apart for a lot of students. The required class is
            full, every section, and you are stuck refreshing ASU Class Search hoping someone drops.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Instead, hand that section to{' '}
            <Link href="/" className="text-primary hover:text-primary/80 font-medium">
              PickMyClass
            </Link>
            . It checks the class every 30 minutes and emails you the second a seat opens, so you
            can register before the rest of the waitlist even notices. It is free, and it is the
            difference between graduating on time and pushing a class to next semester.
          </p>

          <BlogCTA
            heading="Required class already full?"
            description="PickMyClass emails you the moment a seat opens, so you register before everyone else. Free for every Sun Devil."
          />

          <h2 id="faq" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Frequently Asked Questions
          </h2>
          <BlogFAQ items={faqItems} />
          <FAQSchema items={faqItems} />

          <BlogAuthor
            name="PickMyClass Team"
            title="PickMyClass Founder"
            bio="Built PickMyClass after missing registration for a required class. Now helping thousands of Sun Devils get the classes they need."
          />

          <div className="not-prose mt-8 border-t border-border pt-6">
            <h3 className="text-sm font-semibold text-foreground mb-3">Related Articles</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link
                  href="/blog/asu-registration-tips"
                  className="text-primary hover:text-primary/80 transition-colors"
                >
                  ASU Registration Tips: Build Your Perfect Schedule
                </Link>
              </li>
              <li>
                <Link
                  href="/blog/asu-class-search"
                  className="text-primary hover:text-primary/80 transition-colors"
                >
                  ASU Class Search: How to Find Open Classes Fast
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
      <JsonLd data={howToSchema} />
      <JsonLd data={breadcrumbSchema} />
    </div>
  );
}
