import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BlogAuthor,
  BlogFAQ,
  ComparisonTable,
  FAQSchema,
  KeyTakeaways,
  TableOfContents,
} from '@/components/blog';
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
    images: ['/og-image.png'],
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
  dateModified: '2026-05-08T00:00:00Z',
  author: { '@type': 'Person', name: 'PickMyClass Team', url: 'https://pickmyclass.app' },
  publisher: {
    '@type': 'Organization',
    name: 'PickMyClass',
    url: 'https://pickmyclass.app',
  },
  mainEntityOfPage: 'https://pickmyclass.app/blog/asu-registration-tips',
};

const tocItems = [
  { id: 'preparation', text: 'Before Registration: Preparation Is Everything', level: 2 },
  { id: 'during-registration', text: 'During Registration: Speed Matters', level: 2 },
  { id: 'after-registration', text: "After Registration: Don't Give Up", level: 2 },
  { id: 'registration-calendar', text: 'Registration Calendar by Student Type', level: 2 },
  { id: 'prerequisites', text: 'Prerequisites and Holds', level: 2 },
  { id: 'shopping-cart', text: 'Shopping Cart Power Tips', level: 2 },
  { id: 'session-comparison', text: 'Session A vs B vs C', level: 2 },
  { id: 'faq', text: 'Frequently Asked Questions', level: 2 },
];

const calendarColumns = [
  { key: 'type', label: 'Student Type' },
  { key: 'credits', label: 'Credit Hours' },
  { key: 'date', label: 'Registration Opens' },
];

const calendarRows = [
  { type: 'Graduate/Professional', credits: 'N/A', date: 'March 23, 2026' },
  { type: 'Senior', credits: '90+', date: 'March 24, 2026' },
  { type: 'Junior', credits: '60-89', date: 'March 25, 2026' },
  { type: 'Sophomore', credits: '30-59', date: 'March 26, 2026' },
  { type: 'Freshman', credits: '0-29', date: 'March 27, 2026' },
  { type: 'Non-Degree', credits: 'N/A', date: 'April 6, 2026' },
];

const sessionColumns = [
  { key: 'session', label: 'Session' },
  { key: 'length', label: 'Length' },
  { key: 'start', label: 'Typical Start' },
  { key: 'bestFor', label: 'Best For' },
];

const sessionRows = [
  {
    session: 'Session A',
    length: '15 weeks',
    start: 'August / January',
    bestFor: 'Standard full-semester courses',
  },
  {
    session: 'Session B',
    length: '7.5 weeks',
    start: 'August / October / January / March',
    bestFor: 'Faster-paced, intensive courses',
  },
  {
    session: 'Session C',
    length: '7.5 weeks',
    start: 'August / October / January / March',
    bestFor: 'Flexible scheduling, work-friendly',
  },
];

const faqItems = [
  {
    question: 'How do I check my registration date?',
    answer:
      'Log into MyASU and look for your "Enrollment Appointment" in the Registration section. It will show the exact date and time when your registration window opens. You can also find this in the ASU mobile app.',
  },
  {
    question: "Why is my friend's registration date earlier?",
    answer:
      'ASU assigns registration dates based on earned credit hours. Students with more credits (seniors) register before those with fewer credits (freshmen). Athletes, honors students, and some special programs may also have priority registration.',
  },
  {
    question: 'Can I register for classes at different campuses?',
    answer:
      "Yes! You can register for classes at any ASU campus (Tempe, Downtown Phoenix, Polytechnic, West) as well as ASU Online sections. Just be mindful of travel time between physical campuses if you're taking in-person classes.",
  },
  {
    question: "What's the difference between Session A, B, and C?",
    answer:
      'Session A is the traditional 15-week semester. Sessions B and C are 7.5-week accelerated sessions. Session B typically starts at the beginning of the semester, while Session C starts mid-semester. They allow you to take more classes per semester by splitting them across sessions.',
  },
  {
    question: 'How do online classes affect my registration?',
    answer:
      'ASU Online sections are treated like any other class for registration purposes. They often have different capacity limits than in-person sections and can be a good backup option when campus sections fill up.',
  },
  {
    question: 'What are the most common holds that prevent registration?',
    answer:
      'The most common are: Financial holds (unpaid tuition/fees), Immunization holds (missing vaccination records), Advising holds (need to meet with advisor first), and Academic holds (probation or other academic issues). Check MyASU well before your registration date to clear any holds.',
  },
  {
    question: 'Can I register before my transcript is evaluated?',
    answer:
      "If you're a new transfer student, your registration date is based on your projected/earned credits. However, your official evaluation may affect your standing. Contact your advisor if there's a discrepancy between projected and actual credits.",
  },
];

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
            schedule, it is easy to feel overwhelmed. Honestly, I have been there. This is what I
            wish I knew before my first registration day.
          </p>

          <KeyTakeaways
            items={[
              {
                text: 'Check MyASU for your exact enrollment appointment and clear any holds at least a week early',
              },
              { text: 'Build 2-3 complete backup schedules before registration opens' },
              { text: 'Pre-load your shopping cart and enroll the moment your window opens' },
              {
                text: 'Use automated seat tracking for full classes instead of manually refreshing',
              },
              { text: 'Mix Session A, B, and C classes to fit more credits into your semester' },
            ]}
          />

          <TableOfContents items={tocItems} />

          <h2 id="preparation" className="text-2xl font-bold text-foreground mt-10 mb-4">
            Before Registration: Preparation Is Everything
          </h2>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Know Your Enrollment Appointment
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            ASU assigns enrollment appointments based on your class standing, which is just your
            earned credit hours. Check MyASU for your specific date and time. It is different for
            every student. Seniors register first, then juniors, sophomores, and freshmen. Barrett
            Honors students and athletes usually get earlier priority windows.
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
            <li>Note section numbers (you will need these for fast registration)</li>
            <li>Check instructor assignments and cross-reference with RateMyProfessors</li>
            <li>Identify time conflicts between your desired classes</li>
            <li>Find backup sections at different times or campuses</li>
          </ul>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Plan Multiple Schedule Options
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Real talk: do not go into registration with just one ideal schedule. Build 2-3 complete
            schedule options so you can pivot quickly if your first choices are full. Consider
            things like:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>Different professors for the same course</li>
            <li>Session A, B, or C options for shorter-term classes</li>
            <li>Online vs. in-person alternatives</li>
            <li>Different campus locations (Tempe, Downtown, Polytechnic, West)</li>
          </ul>

          <h2 id="during-registration" className="text-2xl font-bold text-foreground mt-10 mb-4">
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
            locked out. Popular classes with popular professors fill in minutes. I learned this the
            hard way with CSE 310.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Check Prerequisite and Restriction Requirements
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Nothing ruins your enrollment window like finding out you do not meet a prerequisite or
            there is a major restriction blocking you. Verify all prerequisites are met well before
            registration day. If you need a permission override, contact the department ahead of
            time. Do not wait until the last minute.
          </p>

          <h2 id="after-registration" className="text-2xl font-bold text-foreground mt-10 mb-4">
            After Registration: Do not Give Up on Full Classes
          </h2>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Set Up Automated Seat Tracking
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            If a class you want is full, do not just accept it. Use{' '}
            <Link href="/" className="text-primary hover:text-primary/80 font-medium">
              PickMyClass
            </Link>{' '}
            to automatically monitor the class for open seats. It checks every 30 minutes and emails
            you when a seat opens up. Over 8,500 students have gotten their seat this way.
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
            helps you catch these additions without checking manually every day.
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
            ready so you can grab a spot when someone else bails.
          </p>

          <h2 id="registration-calendar" className="text-2xl font-bold text-foreground mt-10 mb-4">
            Registration Calendar by Student Type
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Your registration date depends on your class standing. Here is the typical schedule for
            Fall 2026 (check MyASU for your exact date):
          </p>
          <ComparisonTable columns={calendarColumns} rows={calendarRows} />
          <p className="text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Note:</strong> Dates are for Fall 2026 registration.
            Spring and Summer registration follow similar patterns but with different dates.
            Priority groups (Barrett Honors, athletes) may have earlier access.
          </p>

          <h2 id="prerequisites" className="text-2xl font-bold text-foreground mt-10 mb-4">
            Prerequisites and Holds: The Pre-Registration Checklist
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Nothing kills a registration plan faster than discovering a hold on your account or
            missing a prerequisite. Check these at least a week before your appointment:
          </p>
          <div className="space-y-4 my-6">
            <div className="rounded-lg border border-border bg-card p-5">
              <h3 className="font-semibold text-foreground mb-2">1. Financial Holds</h3>
              <p className="text-sm text-muted-foreground">
                Unpaid tuition, fees, or parking tickets can block registration. Check your account
                balance in MyASU and clear any outstanding charges.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-5">
              <h3 className="font-semibold text-foreground mb-2">2. Immunization Holds</h3>
              <p className="text-sm text-muted-foreground">
                ASU requires proof of certain vaccinations. Upload your records to the student
                health portal well in advance. Processing can take several days.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-5">
              <h3 className="font-semibold text-foreground mb-2">3. Advising Holds</h3>
              <p className="text-sm text-muted-foreground">
                Some majors require advisor clearance before registration. Schedule your appointment
                early. Advisor slots fill up fast during registration season.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-5">
              <h3 className="font-semibold text-foreground mb-2">4. Academic Holds</h3>
              <p className="text-sm text-muted-foreground">
                Academic probation or other standing issues may prevent registration. Contact your
                academic advisor immediately if you see this hold.
              </p>
            </div>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            <strong className="text-foreground">How to check:</strong> Log into MyASU, go to
            Registration, then click Check for Holds. Address any issues immediately. Do not wait
            until the day before your registration window.
          </p>

          <h2 id="shopping-cart" className="text-2xl font-bold text-foreground mt-10 mb-4">
            Shopping Cart Power Tips
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            The shopping cart is your secret weapon for fast registration. This is how to use it
            like a pro:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Pre-load everything</strong>. Add all desired
              classes and backup sections to your cart before your window opens.
            </li>
            <li>
              <strong className="text-foreground">Validate early</strong>. Use the validate feature
              to catch prerequisite issues before registration day.
            </li>
            <li>
              <strong className="text-foreground">Organize by priority</strong>. Put your most
              important classes first so you can enroll in order if some fill up.
            </li>
            <li>
              <strong className="text-foreground">Have backup plans ready</strong>. Load alternative
              sections for every class you need.
            </li>
            <li>
              <strong className="text-foreground">Do not wait to enroll</strong>. Items in your cart
              are not reserved. Enroll immediately when your window opens.
            </li>
          </ul>

          <h2 id="session-comparison" className="text-2xl font-bold text-foreground mt-10 mb-4">
            Session A vs B vs C: Which Should You Choose?
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Understanding ASU's session system helps you build a more flexible schedule:
          </p>
          <ComparisonTable columns={sessionColumns} rows={sessionRows} />
          <p className="text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Strategy tip:</strong> Mixing sessions can help you
            take more credits per semester. For example, take 2 Session A classes (full semester)
            plus 1 Session B and 1 Session C class (sequential half-semester courses) for a total of
            4 classes while managing workload.
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
                Automatically monitors ASU classes and emails you when seats open. Used by 2,400+
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

          <h2 id="faq" className="text-2xl font-bold text-foreground mt-10 mb-4">
            Frequently Asked Questions
          </h2>
          <BlogFAQ items={faqItems} />
          <FAQSchema items={faqItems} />

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
              Full classes do not have to ruin your schedule
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
              <li>
                <Link
                  href="/blog/asu-transfer-registration"
                  className="text-primary hover:text-primary/80 transition-colors"
                >
                  ASU Transfer Student Registration: Complete Guide
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
