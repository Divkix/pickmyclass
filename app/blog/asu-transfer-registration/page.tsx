import type { Metadata } from 'next';
import Link from 'next/link';
import { BlogAuthor, BlogFAQ, FAQSchema, TableOfContents } from '@/components/blog';
import { Header } from '@/components/Header';
import { JsonLd } from '@/components/landing/JsonLd';

export const metadata: Metadata = {
  title: 'ASU Transfer Student Registration: Complete Guide for MyPath2ASU Students',
  description:
    'Everything transfer students need to know about ASU registration. How transfer credits affect your registration date, MyPath2ASU articulation, and tips for getting into full classes.',
  alternates: {
    canonical: '/blog/asu-transfer-registration',
  },
  openGraph: {
    title: 'ASU Transfer Student Registration: Complete Guide for MyPath2ASU Students',
    description:
      'How transfer credits affect your registration date, MyPath2ASU articulation, and tips for getting into full classes.',
    type: 'article',
    publishedTime: '2026-04-26T00:00:00Z',
    images: ['/og-image.png'],
  },
};

export const dynamic = 'error';

const articleSchema = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'ASU Transfer Student Registration: Complete Guide for MyPath2ASU Students',
  description:
    'Everything transfer students need to know about ASU registration. How transfer credits affect your registration date, MyPath2ASU articulation, and tips for getting into full classes.',
  datePublished: '2026-04-26T00:00:00Z',
  dateModified: '2026-04-26T00:00:00Z',
  author: { '@type': 'Person', name: 'PickMyClass Team', url: 'https://pickmyclass.app' },
  publisher: {
    '@type': 'Organization',
    name: 'PickMyClass',
    url: 'https://pickmyclass.app',
  },
  mainEntityOfPage: 'https://pickmyclass.app/blog/asu-transfer-registration',
};

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://pickmyclass.app/' },
    { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://pickmyclass.app/blog' },
    { '@type': 'ListItem', position: 3, name: 'ASU Transfer Student Registration' },
  ],
};

const tocItems = [
  { id: 'credits', text: 'How Transfer Credits Affect Your Registration Date', level: 2 },
  { id: 'mypath2asu', text: 'MyPath2ASU Articulation Guide', level: 2 },
  { id: 'timeline', text: 'Transfer Student Registration Timeline', level: 2 },
  { id: 'full-classes', text: 'Getting Into Full Classes as a Transfer', level: 2 },
  { id: 'faq', text: 'Frequently Asked Questions', level: 2 },
];

const faqItems = [
  {
    question: 'When will I know my registration date?',
    answer:
      "Your registration date is typically available in MyASU 2-3 weeks before registration opens. As a new transfer student, you may register later than continuing students with the same credit hours. Check MyASU regularly and contact your advisor if you don't see your appointment.",
  },
  {
    question: 'Do my community college credits count toward senior standing?',
    answer:
      "Yes, but only after they're officially evaluated. ASU uses 'earned credit hours' (completed and evaluated) to determine class standing. Your projected credits may get you an earlier registration date initially, but your standing will be adjusted after official evaluation.",
  },
  {
    question: 'Can I register before my transcript is evaluated?',
    answer:
      'Typically, yes. ASU often assigns initial registration dates based on projected credits from your transfer application. However, your official evaluation may affect your standing, and you might need to adjust your schedule after the official transfer credit evaluation is complete.',
  },
  {
    question: 'How do I use the MyPath2ASU Transfer Guide?',
    answer:
      'Visit mypath2asu.asu.edu, select your current institution, choose your major at ASU, and view the course-by-course equivalencies. This shows exactly which of your completed courses will transfer and count toward your ASU degree requirements.',
  },
  {
    question: "What if a course doesn't transfer?",
    answer:
      "You have options: 1) Request a course evaluation if you believe it's equivalent to an ASU course, 2) Take the ASU course you need, 3) Check if the course can count as elective credit instead of major credit. Contact your academic advisor for guidance.",
  },
  {
    question: 'Do international transfer students have different registration dates?',
    answer:
      'International transfer students typically follow the same registration timeline based on earned credits. However, there may be additional requirements (like orientation) that must be completed before you can register. Check with the International Student and Scholar Center.',
  },
  {
    question: 'Can I appeal my registration date?',
    answer:
      "Generally, no. ASU assigns registration dates based on class standing (earned credit hours) with limited exceptions. However, if you believe there's an error in your credit calculation, contact your academic advisor or the registrar's office.",
  },
  {
    question: 'Should I attend orientation before registering?',
    answer:
      'Yes, if required. Some programs and colleges require transfer students to attend orientation before they can register. Check your admit materials or contact your advisor to confirm. Orientation often provides valuable registration guidance specific to your major.',
  },
];

export default async function ASUTransferRegistrationPost() {
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
              <span className="text-foreground">ASU Transfer Student Registration</span>
            </nav>
          </div>

          <div className="not-prose mb-8">
            <h1 className="text-4xl font-bold text-foreground sm:text-5xl leading-tight">
              ASU Transfer Student Registration: Complete Guide for MyPath2ASU Students
            </h1>
            <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
              <time dateTime="2026-04-26">April 26, 2026</time>
              <span>8 min read</span>
            </div>
          </div>

          <p className="text-lg text-muted-foreground leading-relaxed">
            Transferring to ASU comes with unique challenges. With 4,000+ transfer students joining
            each year, you&apos;re navigating different registration timelines, credit evaluations,
            and the reality that many classes are already full by the time you can register.
            Here&apos;s everything you need to know to succeed as a transfer student.
          </p>

          <TableOfContents items={tocItems} />

          <h2 id="credits" className="text-2xl font-bold text-foreground mt-10 mb-4">
            How Transfer Credits Affect Your Registration Date
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            ASU assigns registration dates based on{' '}
            <strong className="text-foreground">earned credit hours</strong>, which creates unique
            challenges for transfer students. Here&apos;s what you need to understand:
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Earned vs. Projected Credits
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            When you first transfer, ASU may use <em>projected credits</em> from your transcript
            evaluation to assign your initial registration date. However, only{' '}
            <strong className="text-foreground">earned credits</strong> (officially evaluated and
            posted to your ASU record) count toward your class standing long-term.
          </p>
          <div className="rounded-lg border border-border bg-card p-5 my-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Example:</strong> You completed 45 credits at
              community college. ASU might initially give you sophomore standing (30-59 credits) for
              registration purposes. But if only 30 credits officially transfer, your standing
              adjusts, which could affect future registration dates.
            </p>
          </div>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            How to Check Your Credit Evaluation
          </h3>
          <ol className="space-y-2 text-muted-foreground list-decimal list-inside">
            <li>Log into MyASU</li>
            <li>Navigate to your Degree Audit (DARS) report</li>
            <li>Look for &ldquo;Transfer Credit&rdquo; or &ldquo;External Credit&rdquo; section</li>
            <li>Verify which courses were accepted and how they count toward your degree</li>
          </ol>
          <p className="text-muted-foreground leading-relaxed mt-4">
            <strong className="text-foreground">Action item:</strong> Check your DARS report
            immediately after your first semester. If credits are missing or incorrectly evaluated,
            contact your advisor right away. Corrections can affect your registration priority for
            the next semester.
          </p>

          <h2 id="mypath2asu" className="text-2xl font-bold text-foreground mt-10 mb-4">
            MyPath2ASU Articulation Guide
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            MyPath2ASU is ASU&apos;s transfer articulation tool that shows exactly how your credits
            will transfer. Understanding this system helps you plan your degree and avoid surprises.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            How to Use the MyPath2ASU Transfer Guide
          </h3>
          <ol className="space-y-3 text-muted-foreground list-decimal list-inside">
            <li>
              Visit{' '}
              <a
                href="https://mypath2asu.asu.edu"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-primary/80"
              >
                mypath2asu.asu.edu
              </a>
            </li>
            <li>Select your current or previous institution</li>
            <li>Choose your intended ASU major</li>
            <li>View the course-by-course equivalency chart</li>
          </ol>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Common Course Equivalencies
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Most Arizona community colleges have established equivalency agreements with ASU. Common
            transfer courses include:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>General education requirements (English, Math, Sciences)</li>
            <li>Lower-division major prerequisites</li>
            <li>Arizona General Education Curriculum (AGEC) blocks</li>
          </ul>
          <p className="text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Pro tip:</strong> Complete your AGEC before
            transferring. It guarantees that 35 credits of general education requirements are
            satisfied, giving you a head start on your ASU degree.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            What to Do If a Course Doesn&apos;t Transfer
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Sometimes a course you expected to count doesn&apos;t transfer as planned. Your options:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Request re-evaluation:</strong> If you believe a
              course is equivalent to an ASU course, work with your advisor to request a
              re-evaluation
            </li>
            <li>
              <strong className="text-foreground">Use as elective credit:</strong> Even if it
              doesn&apos;t count toward your major, it may still count as general elective credit
            </li>
            <li>
              <strong className="text-foreground">Take the ASU equivalent:</strong> Plan to take the
              ASU course you need, potentially adjusting your graduation timeline
            </li>
          </ul>

          <h2 id="timeline" className="text-2xl font-bold text-foreground mt-10 mb-4">
            Transfer Student Registration Timeline
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Transfer students often face a disadvantage: you may register later than continuing
            students with the same credit hours. Here&apos;s the typical timeline and how to
            navigate it:
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            When Transfer Students Typically Register
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Registration priority generally follows this order:
          </p>
          <ol className="space-y-2 text-muted-foreground list-decimal list-inside">
            <li>Continuing graduate/professional students</li>
            <li>Continuing undergraduate students (by class standing)</li>
            <li>New graduate students</li>
            <li>New transfer students (may be grouped with or after new freshmen)</li>
            <li>New freshmen</li>
          </ol>
          <p className="text-muted-foreground leading-relaxed mt-4">
            <strong className="text-foreground">The challenge:</strong> By the time new transfer
            students register, many popular classes and sections are already full.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            How to Prepare Despite Late Registration
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Even with a later registration date, you can set yourself up for success:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Research thoroughly before your date:</strong>{' '}
              Have backup schedules ready, including online sections and different campuses
            </li>
            <li>
              <strong className="text-foreground">Set up seat tracking immediately:</strong> Add all
              desired classes to{' '}
              <Link href="/" className="text-primary hover:text-primary/80 font-medium">
                PickMyClass
              </Link>{' '}
              as soon as you know your registration date, even before you can register
            </li>
            <li>
              <strong className="text-foreground">Be flexible with timing:</strong> Be willing to
              take 8 AM or evening sections that might still have seats
            </li>
            <li>
              <strong className="text-foreground">Consider ASU Online:</strong> Online sections
              often have different capacity and may have seats when in-person sections are full
            </li>
          </ul>

          <h2 id="full-classes" className="text-2xl font-bold text-foreground mt-10 mb-4">
            Getting Into Full Classes as a Transfer Student
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Late registration means you&apos;ll likely encounter full classes. Here&apos;s your
            action plan:
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Strategy 1: Aggressive Seat Tracking
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            This is your most important tool. Since you&apos;re registering late, you need to be
            first to know when seats open.{' '}
            <Link href="/" className="text-primary hover:text-primary/80 font-medium">
              PickMyClass
            </Link>{' '}
            checks every 30 minutes and notifies you immediately — much more reliable than manual
            checking, especially when you&apos;re busy with orientation and settling in.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Strategy 2: Contact Your Advisor Immediately
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Academic advisors can sometimes help transfer students who need specific classes for
            degree progress. If a required class for your major is full:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>Schedule an advising appointment as soon as possible</li>
            <li>Explain that you&apos;re a new transfer student with late registration</li>
            <li>Ask about department waitlists or capacity overrides</li>
            <li>Inquire about alternative sections that might open</li>
          </ul>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Strategy 3: Embrace Add/Drop Week
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            The first week of classes is when transfer students can catch up. Students are
            constantly dropping and swapping classes. With seat tracking set up, you&apos;ll be
            among the first to know when openings occur.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Strategy 4: Consider Session B and C
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            If you can&apos;t get into Session A classes (full semester), look at Session B or C
            options. These 7.5-week sessions start later and often have more availability. They can
            be a great way to catch up on credits while you wait for full-semester openings.
          </p>

          <div className="not-prose mt-10 rounded-lg border border-primary/20 bg-primary/5 p-8 text-center">
            <h2 className="mb-2 text-2xl font-bold text-foreground">
              Late registration doesn&apos;t mean no classes
            </h2>
            <p className="mb-6 text-muted-foreground">
              PickMyClass helps transfer students get into full classes by monitoring seats 24/7.
              Join 2,400+ Sun Devils who never miss an opening.
            </p>
            <Link
              href="/register"
              className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
            >
              Start Tracking Free
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
                  href="/blog/asu-registration-tips"
                  className="text-primary hover:text-primary/80 transition-colors"
                >
                  ASU Registration Tips: Build Your Perfect Schedule
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
                  href="/blog/asu-class-seat-tracker"
                  className="text-primary hover:text-primary/80 transition-colors"
                >
                  ASU Class Seat Tracker: How to Get Notified When Seats Open
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
