import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BlogAuthor,
  BlogFAQ,
  ComparisonTable,
  FAQSchema,
  TableOfContents,
} from '@/components/blog';
import { Header } from '@/components/Header';
import { JsonLd } from '@/components/landing/JsonLd';

export const metadata: Metadata = {
  title: 'How to Get Into Full Classes at ASU: 7 Strategies That Work',
  description:
    'Practical strategies to get into full ASU classes during registration and add/drop period. From waitlist tips to automated seat tracking tools.',
  alternates: {
    canonical: '/blog/how-to-get-into-full-asu-classes',
  },
  openGraph: {
    title: 'How to Get Into Full Classes at ASU: 7 Strategies That Work',
    description:
      'Practical strategies to get into full ASU classes during registration and add/drop period.',
    type: 'article',
    publishedTime: '2026-03-27T00:00:00Z',
    images: ['/og-image.png'],
  },
};

export const dynamic = 'error';

const articleSchema = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'How to Get Into Full Classes at ASU: 7 Strategies That Work',
  description:
    'Practical strategies to get into full ASU classes during registration and add/drop period. From waitlist tips to automated seat tracking tools.',
  datePublished: '2026-03-27T00:00:00Z',
  dateModified: '2026-04-26T00:00:00Z',
  author: { '@type': 'Person', name: 'PickMyClass Team', url: 'https://pickmyclass.app' },
  publisher: {
    '@type': 'Organization',
    name: 'PickMyClass',
    url: 'https://pickmyclass.app',
  },
  mainEntityOfPage: 'https://pickmyclass.app/blog/how-to-get-into-full-asu-classes',
};

const tocItems = [
  {
    id: 'register-exact-minute',
    text: '1. Register at the Exact Minute Your Window Opens',
    level: 2,
  },
  { id: 'backup-schedule', text: '2. Build a Complete Backup Schedule', level: 2 },
  { id: 'auto-tracker', text: '3. Monitor Seats Automatically', level: 2 },
  { id: 'add-drop-week', text: '4. Check During Add/Drop Week', level: 2 },
  { id: 'talk-professor', text: '5. Talk to the Professor Directly', level: 2 },
  { id: 'advisor', text: '6. Contact Your Academic Advisor', level: 2 },
  { id: 'late-sections', text: '7. Look for Late-Added Sections', level: 2 },
  { id: 'strategy-comparison', text: 'Strategy Comparison Table', level: 2 },
  { id: 'common-mistakes', text: 'Common Mistakes to Avoid', level: 2 },
  { id: 'timeline', text: 'When Each Strategy Works Best', level: 2 },
  { id: 'faq', text: 'Frequently Asked Questions', level: 2 },
];

const strategyColumns = [
  { key: 'strategy', label: 'Strategy' },
  { key: 'when', label: 'When to Use' },
  { key: 'effort', label: 'Effort Level' },
  { key: 'success', label: 'Success Rate' },
];

const strategyRows = [
  {
    strategy: 'Register at window open',
    when: 'Registration day',
    effort: 'High (one-time)',
    success: 'High',
  },
  { strategy: 'Backup schedule', when: 'Before registration', effort: 'Medium', success: 'High' },
  {
    strategy: 'Auto seat tracking',
    when: 'Anytime',
    effort: 'Low',
    success: 'High',
    highlight: true,
  },
  {
    strategy: 'Add/drop monitoring',
    when: 'First week of classes',
    effort: 'High',
    success: 'Medium',
  },
  {
    strategy: 'Professor outreach',
    when: 'After classes start',
    effort: 'Medium',
    success: 'Medium',
  },
  { strategy: 'Advisor help', when: 'When desperate', effort: 'Medium', success: 'Low-Medium' },
  { strategy: 'Late section hunting', when: 'Ongoing', effort: 'High', success: 'Low' },
];

const faqItems = [
  {
    question: 'Can professors add me to a full class?',
    answer:
      'Sometimes. Professors can issue capacity overrides in some cases, especially if you need the class to graduate. Attend the first day, introduce yourself professionally, and explain your situation. Be specific about why you need the class.',
  },
  {
    question: 'Does ASU have a waitlist system?',
    answer:
      "For most classes, no. ASU does not have a traditional waitlist system like some other universities. Only specific departments (like W. P. Carey business courses) offer waitlists. For most classes, you'll need to manually check for open seats or use an automated tracker.",
  },
  {
    question: 'What are my chances of getting into a 200-person lecture?',
    answer:
      'Better than small seminars, but still competitive. Large lectures see more drops during add/drop week because students are shopping around. Set up tracking and be ready to act during the first week of classes.',
  },
  {
    question: 'Do online classes open up more often?',
    answer:
      'ASU Online sections sometimes have different capacity limits than in-person sections. They can be a good backup option when campus sections fill up. Check both modalities when building your backup schedule.',
  },
  {
    question: 'How fast do I need to register when I get an alert?',
    answer:
      'As fast as possible. Popular classes can fill within 5-10 minutes of a seat opening. Have MyASU bookmarked, be logged in, and know the exact section number. Practice the registration flow beforehand.',
  },
  {
    question: 'Can I track multiple sections of the same class?',
    answer:
      "Yes, and you should! Many students track all available sections of a required course. This significantly increases your odds of getting in since you'll be notified when any section opens.",
  },
  {
    question: 'What if I miss the notification?',
    answer:
      'If you miss an alert and the seat gets taken, stay on the tracker. Students drop classes throughout the semester, especially during the first week. The next opportunity could be hours or days away.',
  },
  {
    question: 'Is it worth showing up to a full class on day one?',
    answer:
      "Yes, especially if it's a required class for your major. Professors sometimes accommodate students who show up prepared and explain their situation professionally. Bring an add form just in case.",
  },
];

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://pickmyclass.app/' },
    { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://pickmyclass.app/blog' },
    { '@type': 'ListItem', position: 3, name: 'How to Get Into Full Classes at ASU' },
  ],
};

export default async function HowToGetIntoFullClassesPost() {
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
              <span className="text-foreground">How to Get Into Full Classes</span>
            </nav>
          </div>

          <div className="not-prose mb-8">
            <h1 className="text-4xl font-bold text-foreground sm:text-5xl leading-tight">
              How to Get Into Full Classes at ASU: 7 Strategies That Work
            </h1>
            <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
              <time dateTime="2026-03-27">March 27, 2026</time>
              <span>7 min read</span>
            </div>
          </div>

          <p className="text-lg text-muted-foreground leading-relaxed">
            That class you need for graduation? Full. The section with the good professor? Full. The
            time slot that works with your schedule? You guessed it. If you&apos;re an ASU student
            dealing with full classes, here are seven strategies that actually work to get you in.
          </p>

          <TableOfContents items={tocItems} />

          <h2 id="register-exact-minute" className="text-2xl font-bold text-foreground mt-10 mb-4">
            1. Register at the Exact Minute Your Enrollment Window Opens
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            ASU assigns enrollment appointments based on credit hours &mdash; seniors register
            first, freshmen last. Know exactly when your window opens by checking your enrollment
            appointment in MyASU. Set an alarm, have your class cart pre-loaded, and register the
            second your window activates.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Pro tip:</strong> Use the ASU class search to find
            section numbers ahead of time. Have backup sections ready in case your first choice
            fills during the minutes before your appointment.
          </p>

          <h2 id="backup-schedule" className="text-2xl font-bold text-foreground mt-10 mb-4">
            2. Build a Complete Backup Schedule
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Don&apos;t put all your eggs in one basket. For every class you want, identify 2-3
            alternative sections (different times, different professors, different campuses). If you
            need CSE 240 and the Tuesday/Thursday section is full, have the Monday/Wednesday/Friday
            section ready to go.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Consider ASU Online sections as well &mdash; they often have different capacity limits
            and can be a lifesaver when in-person sections fill up.
          </p>

          <h2 id="auto-tracker" className="text-2xl font-bold text-foreground mt-10 mb-4">
            3. Monitor Seats Automatically with a Class Tracker
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            This is the single most effective strategy for getting into a full class after
            registration day. Instead of manually refreshing MyASU hoping to catch a dropped seat,
            use an automated tracker like{' '}
            <Link href="/" className="text-primary hover:text-primary/80 font-medium">
              PickMyClass
            </Link>{' '}
            to monitor classes for you.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            PickMyClass checks the ASU class search every 30 minutes and sends you an email the
            moment a seat opens. It&apos;s free, and over 2,400 Sun Devils are already using it.
            This way, you don&apos;t have to be glued to your computer &mdash; you can go about your
            day and act fast when you get the notification.
          </p>

          <h2 id="add-drop-week" className="text-2xl font-bold text-foreground mt-10 mb-4">
            4. Check During Add/Drop Week
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            The first week of classes (add/drop period) is the most volatile time for class rosters.
            Students are constantly swapping, dropping, and adjusting their schedules. This creates
            a steady stream of openings in previously full classes.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            If you can&apos;t find a seat during regular registration, don&apos;t panic. Set up{' '}
            <Link
              href="/blog/asu-class-seat-tracker"
              className="text-primary hover:text-primary/80 font-medium"
            >
              automated seat tracking
            </Link>{' '}
            and be ready to act fast during add/drop week. Many students report getting their
            preferred classes during this period.
          </p>

          <h2 id="talk-professor" className="text-2xl font-bold text-foreground mt-10 mb-4">
            5. Talk to the Professor Directly
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Professors sometimes have the ability to issue overrides for full classes, especially if
            you&apos;re a senior who needs the class to graduate. Attend the first day of class even
            if you&apos;re not enrolled, introduce yourself, and explain your situation.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Be professional and specific: &ldquo;I need this class to graduate this semester and all
            sections are full&rdquo; is much more compelling than &ldquo;I just really want this
            time slot.&rdquo; Some professors maintain their own waitlists for situations like this.
          </p>

          <h2 id="advisor" className="text-2xl font-bold text-foreground mt-10 mb-4">
            6. Contact Your Academic Advisor
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Academic advisors can sometimes facilitate enrollment overrides, especially for students
            who need specific classes for degree progress. If a class is required for your major and
            you can&apos;t get into any section, schedule an advising appointment and explain your
            situation.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Advisors have access to enrollment tools and information that students don&apos;t, and
            they may know about upcoming section additions or capacity increases.
          </p>

          <h2 id="late-sections" className="text-2xl font-bold text-foreground mt-10 mb-4">
            7. Look for Late-Added Sections
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            ASU departments sometimes add new sections after the initial schedule is published,
            particularly for high-demand courses. These sections often appear with little fanfare,
            and students who are actively monitoring the class search are the first to grab them.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Keep an eye on the ASU class search throughout the registration period, or set up{' '}
            <Link href="/" className="text-primary hover:text-primary/80 font-medium">
              automated monitoring
            </Link>{' '}
            so you don&apos;t miss new sections as they appear.
          </p>

          <h2 id="strategy-comparison" className="text-2xl font-bold text-foreground mt-10 mb-4">
            Strategy Comparison: At a Glance
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Here&apos;s how all seven strategies compare on effort, timing, and success rate:
          </p>
          <ComparisonTable columns={strategyColumns} rows={strategyRows} />
          <p className="text-muted-foreground leading-relaxed">
            The sweet spot is combining low-effort, high-success strategies: automated seat tracking
            plus having backup schedules ready. This gives you the best odds with minimal stress.
          </p>

          <h2 id="common-mistakes" className="text-2xl font-bold text-foreground mt-10 mb-4">
            Common Mistakes to Avoid
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Learn from others&apos; failures. Here are the mistakes that cost students their
            preferred classes:
          </p>
          <ul className="space-y-3 text-muted-foreground">
            <li>
              <strong className="text-foreground">Checking at wrong times</strong> — Don&apos;t
              expect seats to open at 2 AM on a Tuesday. Peak drop times are Sunday evenings and
              during the first week of classes.
            </li>
            <li>
              <strong className="text-foreground">Relying on refresh spam</strong> — Manually
              refreshing MyASU every minute burns you out and often misses brief openings. Use
              automated tracking instead.
            </li>
            <li>
              <strong className="text-foreground">Not having backup classes ready</strong> — If your
              top choice fills, you need alternatives ready to go immediately. Don&apos;t waste time
              searching during your enrollment window.
            </li>
            <li>
              <strong className="text-foreground">Giving up after registration day</strong> — The
              real action happens during add/drop week. Stay persistent.
            </li>
            <li>
              <strong className="text-foreground">Ignoring prerequisites</strong> — Nothing worse
              than finding an open seat but being unable to register due to a hold or missing
              prereq. Check these before your appointment.
            </li>
          </ul>

          <h2 id="timeline" className="text-2xl font-bold text-foreground mt-10 mb-4">
            When Each Strategy Works Best
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Timing matters. Here&apos;s when to deploy each strategy for maximum impact:
          </p>
          <div className="space-y-4 my-6">
            <div className="rounded-lg border border-border bg-card p-5">
              <h3 className="font-semibold text-foreground mb-2">
                Pre-Registration (2+ weeks before)
              </h3>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                <li>Set up automated seat tracking for expected full classes</li>
                <li>Research and build 2-3 complete backup schedules</li>
                <li>Verify prerequisites and clear any holds</li>
                <li>Note section numbers for fast registration</li>
              </ul>
            </div>
            <div className="rounded-lg border border-border bg-card p-5">
              <h3 className="font-semibold text-foreground mb-2">Registration Day</h3>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                <li>Register the exact minute your window opens</li>
                <li>Use pre-loaded shopping cart for speed</li>
                <li>Have backup sections ready if first choices fill</li>
              </ul>
            </div>
            <div className="rounded-lg border border-border bg-card p-5">
              <h3 className="font-semibold text-foreground mb-2">
                Add/Drop Week (First week of classes)
              </h3>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                <li>Monitor tracked classes aggressively — most drops happen here</li>
                <li>Attend full classes in person and talk to professors</li>
                <li>Watch for late-added sections</li>
                <li>Be ready to act on notifications within minutes</li>
              </ul>
            </div>
            <div className="rounded-lg border border-border bg-card p-5">
              <h3 className="font-semibold text-foreground mb-2">
                After Add/Drop (Desperate times)
              </h3>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                <li>Contact academic advisor for override possibilities</li>
                <li>Consider taking the class in a future semester</li>
                <li>Look for equivalent courses that fulfill the same requirement</li>
              </ul>
            </div>
          </div>

          <h2 className="text-2xl font-bold text-foreground mt-10 mb-4">The Bottom Line</h2>
          <p className="text-muted-foreground leading-relaxed">
            Getting into full ASU classes requires a combination of preparation and persistence.
            Register early, have backup plans, and most importantly &mdash; use tools that give you
            an edge. Automated seat tracking eliminates the guesswork and ensures you never miss an
            opening.
          </p>

          <div className="not-prose mt-12 rounded-lg border border-primary/20 bg-primary/5 p-8 text-center">
            <h2 className="mb-2 text-2xl font-bold text-foreground">
              Never miss an open seat again
            </h2>
            <p className="mb-6 text-muted-foreground">
              PickMyClass monitors ASU classes 24/7 and emails you when seats open. Free forever.
            </p>
            <Link
              href="/register"
              className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
            >
              Start Tracking Classes Free
            </Link>
          </div>

          <h2 id="faq" className="text-2xl font-bold text-foreground mt-10 mb-4">
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
              <li>
                <Link
                  href="/blog/asu-waitlist-guide"
                  className="text-primary hover:text-primary/80 transition-colors"
                >
                  ASU Waitlist Guide: How It Actually Works
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
