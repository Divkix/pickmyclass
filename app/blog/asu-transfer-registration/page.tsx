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
  dateModified: '2026-06-18T00:00:00Z',
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
      "Your registration date usually shows up in MyASU about 2-3 weeks before registration opens. As a new transfer, though, don't be shocked if you register later than someone who's been at ASU for two semesters with the same credit count. Just keep checking MyASU, and if your appointment isn't showing, ping your advisor.",
  },
  {
    question: 'Do my community college credits count toward senior standing?',
    answer:
      "Technically yes, but only once ASU officially evaluates them. They use 'earned credit hours' to figure out your class standing. You might get an earlier date initially based on projected credits from your application, but once the official eval comes through, your standing can shift. Check your DARS after your first semester to make sure everything's right.",
  },
  {
    question: 'Can I register before my transcript is evaluated?',
    answer:
      'Usually, yeah. ASU often gives you a registration date based on projected credits while they wait for the official transcript eval. But once that eval finishes, your standing might change, and you could end up needing to shuffle your schedule. Plan for that possibility.',
  },
  {
    question: 'How do I use the MyPath2ASU Transfer Guide?',
    answer:
      "Go to mypath2asu.asu.edu, pick your current school, choose your ASU major, and you'll see exactly which of your classes map over. It's honestly one of the more useful tools ASU has. Use it before you register so you don't waste time on classes that won't count.",
  },
  {
    question: "What if a course doesn't transfer?",
    answer:
      "It happens. You can ask your advisor to re-evaluate it if you think it's equivalent to an ASU course. If that doesn't work, it might still count as elective credit. Worst case, you retake it at ASU. Talk to your advisor before you panic.",
  },
  {
    question: 'Do international transfer students have different registration dates?',
    answer:
      "Same timeline generally, based on earned credits. But international students sometimes have extra orientation or paperwork requirements before they can register. Check with the International Student and Scholar Center so you don't get held up by some random form.",
  },
  {
    question: 'Can I appeal my registration date?',
    answer:
      "Basically no. ASU goes by earned credit hours and doesn't budge much. But if your credits look wrong, definitely reach out to your advisor or the registrar. A math error could be costing you an earlier date.",
  },
  {
    question: 'Should I attend orientation before registering?',
    answer:
      "If your program requires it, yes, and some do. Plus orientation usually includes actual useful info about registering for your specific major. Check your admit packet or ask your advisor so you don't get blocked from enrolling.",
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
            <h1 className="text-4xl font-semibold text-foreground sm:text-5xl leading-tight">
              ASU Transfer Student Registration: Complete Guide for MyPath2ASU Students
            </h1>
            <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
              <time dateTime="2026-04-26">April 26, 2026</time>
              <span>·</span>
              <span>Updated June 18, 2026</span>
              <span>8 min read</span>
            </div>
          </div>

          <p className="text-lg text-muted-foreground leading-relaxed">
            Transferring to ASU feels like showing up to a party where everyone already knows the
            layout. You're dealing with credit evaluations that take forever, registration dates
            that land way later than continuing students, and the fun fact that most decent class
            sections are basically full by the time you get access. With 4,000+ transfer students
            coming in every year, the system somehow still acts like you're the first person to ever
            do this. I built PickMyClass after missing registration for a required class myself, so
            trust me when I say: the transfer process is doable, but you have to play it smart.
          </p>

          <ShortAnswer>
            As a transfer student, your registration date is based on your officially evaluated
            credits, so it often lands later than continuing students. Use MyPath2ASU to see how
            your credits map, register the minute your window opens, and track full sections so you
            catch a seat when someone drops.
          </ShortAnswer>

          <KeyTakeaways
            items={[
              {
                text: 'Your registration date depends on officially evaluated credits, not just what you took elsewhere',
              },
              {
                text: 'MyPath2ASU shows exactly how your community college classes map to ASU requirements',
              },
              {
                text: 'Transfer students register later than continuing students, so preparation is everything',
              },
              {
                text: 'Seat tracking and advisor outreach are your best tools for getting into full classes',
              },
              {
                text: 'Consider shorter Session B/C classes if full-semester sections are packed',
              },
            ]}
          />

          <TableOfContents items={tocItems} />

          <h2 id="credits" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            How Transfer Credits Affect Your Registration Date
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            ASU sorts registration dates by{' '}
            <strong className="text-foreground">earned credit hours</strong>, which is where
            transfers get complicated. Your credits aren't just credits here. Some count, some
            don't, and the timing of when they post can cost you an earlier registration slot.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Earned vs. Projected Credits
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            When you first apply, ASU might assign you a registration date based on{' '}
            <em>projected credits</em> from your transcript. Sounds good, except only{' '}
            <strong className="text-foreground">earned credits</strong>, the ones officially
            evaluated and posted to your record, actually stick for future semesters. That initial
            boost can disappear once the real eval comes through.
          </p>
          <div className="rounded-lg border border-border bg-card p-5 my-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Real example:</strong> Say you finished 45 credits
              at community college. ASU might give you sophomore standing at first. But if the
              official eval says only 30 transfer over, your standing drops. That affects your next
              registration date. I've seen people caught off guard by this.
            </p>
          </div>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            How to Check Your Credit Evaluation
          </h3>
          <ol className="space-y-2 text-muted-foreground list-decimal list-inside">
            <li>Log into MyASU</li>
            <li>Open your Degree Audit (DARS) report</li>
            <li>Find the &ldquo;Transfer Credit&rdquo; or &ldquo;External Credit&rdquo; section</li>
            <li>See which courses actually counted and how they apply to your degree</li>
          </ol>
          <p className="text-muted-foreground leading-relaxed mt-4">
            <strong className="text-foreground">Do this:</strong> Check your DARS right after your
            first semester. If credits are missing or mapped wrong, email your advisor immediately.
            Fixing it now changes your registration priority next term.
          </p>

          <h2 id="mypath2asu" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            MyPath2ASU Articulation Guide
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            MyPath2ASU is basically a credit translation dictionary. It shows how your old school's
            courses map to ASU requirements. Using it before you register saves you from the
            nightmare of realizing a class you thought counted actually doesn't.
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
            <li>Look at the course-by-course equivalency chart</li>
          </ol>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Common Course Equivalencies
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Most Arizona community colleges already have agreements with ASU. The usual transfers
            are:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>General education classes (English, math, sciences)</li>
            <li>Lower-division prerequisites for your major</li>
            <li>The full Arizona General Education Curriculum (AGEC) block</li>
          </ul>
          <p className="text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Honestly:</strong> Finish your AGEC before
            transferring if you can. It locks in 35 credits of gen ed requirements and you won't
            have to retake anything.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            What to Do If a Course Doesn't Transfer
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            It sucks, but it happens. A class you assumed would count gets rejected. Here's what you
            can actually do:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Request a re-evaluation:</strong> If you think
              your class covers the same material as an ASU course, your advisor can request a
              review. It doesn't always work, but it's worth trying.
            </li>
            <li>
              <strong className="text-foreground">Use it as an elective:</strong> Even if it doesn't
              hit your major requirements, it might still count toward your total credit hours.
            </li>
            <li>
              <strong className="text-foreground">Plan to retake it:</strong> Sometimes you just
              have to take the ASU version. Build it into your timeline so it doesn't throw off
              graduation.
            </li>
          </ul>

          <h2 id="timeline" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Transfer Student Registration Timeline
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            The hard truth: you will probably register later than continuing students who have the
            same credit hours. It's frustrating but it's how the system works. Knowing the order
            helps you plan around it.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            When Transfer Students Typically Register
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Registration priority usually goes like this:
          </p>
          <ol className="space-y-2 text-muted-foreground list-decimal list-inside">
            <li>Continuing graduate and professional students</li>
            <li>Continuing undergrads, sorted by class standing</li>
            <li>New graduate students</li>
            <li>New transfer students (sometimes grouped with or after freshmen)</li>
            <li>New freshmen</li>
          </ol>
          <p className="text-muted-foreground leading-relaxed mt-4">
            By the time you get your slot, a lot of the good sections, especially the convenient
            times and popular professors, are already taken. That's not pessimism, that's just what
            happens.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            How to Prepare Despite Late Registration
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Late registration isn't a death sentence if you prepare. A few things that actually
            help:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Have backup plans ready:</strong> Don't just have
              one ideal schedule. Have three. Include online sections and different campuses.
            </li>
            <li>
              <strong className="text-foreground">Start tracking seats early:</strong> Add your
              target classes to{' '}
              <Link href="/" className="text-primary hover:text-primary/80 font-medium">
                PickMyClass
              </Link>{' '}
              the moment you know your registration date. Don't wait until after you register.
            </li>
            <li>
              <strong className="text-foreground">Be open to weird times:</strong> 8 AMs and evening
              sections are less popular for a reason, but they often have seats.
            </li>
            <li>
              <strong className="text-foreground">Check ASU Online:</strong> Online sections
              sometimes have totally different capacity numbers. A class that's full in-person might
              have online spots left.
            </li>
          </ul>

          <h2 id="full-classes" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Getting Into Full Classes as a Transfer Student
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            You're going to hit full classes. Everyone does. The difference is whether you have a
            plan for it.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Strategy 1: Aggressive Seat Tracking
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            This is the one that saved me. Since you're registering late, you need to know the
            instant a seat opens.{' '}
            <Link href="/" className="text-primary hover:text-primary/80 font-medium">
              PickMyClass
            </Link>{' '}
            checks every 30 minutes and texts you immediately. Manual checking is a pain, and during
            orientation week you're too busy to babysit the registration page anyway.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Strategy 2: Contact Your Advisor Immediately
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Advisors can sometimes pull strings for transfers who need specific major courses. If a
            required class is full:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>Book an advising appointment as soon as you can</li>
            <li>Tell them you're a new transfer with a late registration date</li>
            <li>Ask about department waitlists or override codes</li>
            <li>See if they're opening new sections</li>
          </ul>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Strategy 3: Embrace Add/Drop Week
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            The first week of the semester is chaotic in a good way. People are dropping and
            swapping constantly. If you have seat tracking running, you'll catch openings before
            most people even notice them.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Strategy 4: Consider Session B and C
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Can't get into a full-semester Session A class? Look at Session B or C. They're 7.5-week
            intensive sessions that start later. A lot of students don't even look at them, so
            there's often more room. You can stack them to catch up on credits.
          </p>

          <BlogCTA
            heading="Late registration is rough, but it's not the end"
            description="PickMyClass checks seats every 30 minutes and texts you the second something opens. A lot of transfer students use it to catch up during add/drop week."
          />

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
