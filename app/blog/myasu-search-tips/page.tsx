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
  title: "MyASU Class Search: 10 Hidden Features Most Students Don't Know",
  description:
    'Unlock the full power of MyASU class search. Learn advanced filters, hidden shortcuts, and pro tips to find the perfect classes faster.',
  alternates: {
    canonical: '/blog/myasu-search-tips',
  },
  openGraph: {
    title: "MyASU Class Search: 10 Hidden Features Most Students Don't Know",
    description:
      'Unlock the full power of MyASU class search. Learn advanced filters, hidden shortcuts, and pro tips.',
    type: 'article',
    publishedTime: '2026-04-26T00:00:00Z',
    images: ['/og-image.png'],
  },
};

export const dynamic = 'error';

const articleSchema = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: "MyASU Class Search: 10 Hidden Features Most Students Don't Know",
  description:
    'Unlock the full power of MyASU class search. Learn advanced filters, hidden shortcuts, and pro tips to find the perfect classes faster.',
  datePublished: '2026-04-26T00:00:00Z',
  dateModified: '2026-06-18T00:00:00Z',
  author: { '@type': 'Person', name: 'PickMyClass Team', url: 'https://pickmyclass.app' },
  publisher: {
    '@type': 'Organization',
    name: 'PickMyClass',
    url: 'https://pickmyclass.app',
  },
  mainEntityOfPage: 'https://pickmyclass.app/blog/myasu-search-tips',
};

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://pickmyclass.app/' },
    { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://pickmyclass.app/blog' },
    { '@type': 'ListItem', position: 3, name: 'MyASU Search Tips' },
  ],
};

const tocItems = [
  { id: 'basic', text: 'Basic Search Tips', level: 2 },
  { id: 'advanced-filters', text: 'Advanced Filters', level: 2 },
  { id: 'reading-results', text: 'Reading the Results', level: 2 },
  { id: 'pro-tips', text: 'Pro Tips', level: 2 },
  { id: 'faq', text: 'Frequently Asked Questions', level: 2 },
];

const faqItems = [
  {
    question: 'How do I search for classes with no prerequisites?',
    answer:
      "Yeah, there's no filter for that. You have to click into each class and read the details. Most 100-level gen ed classes are pretty safe though. If you want easy options, stick to those.",
  },
  {
    question: 'Can I save my search filters?',
    answer:
      'Nope, no save button. But you can bookmark the URL after you set your filters. I know students who keep a spreadsheet of their go-to search combos. Low tech, but it works.',
  },
  {
    question: 'What does "Staff" mean for instructor?',
    answer:
      '"Staff" just means they haven\'t picked a professor yet. Usually gets updated 2-4 weeks before the semester starts. PickMyClass will actually notify you when "Staff" gets replaced with a real name, which is nice because sometimes the professor makes or breaks the class.',
  },
  {
    question: 'How do I find 1-credit or 3-credit classes?',
    answer:
      "Use the advanced filters and look for a 'Units' or 'Credit Hours' option. You can set it to exactly what you need, like 3-3 for three-credit classes only.",
  },
  {
    question: 'Can I search for classes that fulfill specific general education requirements?',
    answer:
      "Yep. In advanced search, look for 'General Studies' or 'Requirement Designation.' You can filter by HU, SB, SQ, whatever you need. Way faster than scrolling through everything.",
  },
  {
    question: 'What\'s the difference between "Open" and "All" in the status filter?',
    answer:
      '"Open" means seats are available right now. "All" shows everything, including full sections. If you\'re tracking seats with PickMyClass, use "All" so you can find the exact sections you want to monitor.',
  },
  {
    question: 'How do I find ASU Sync vs fully online classes?',
    answer:
      'In advanced search, look for "Mode of Instruction." ASU Sync is live remote, Online is do-it-on-your-own-time. Some classes have both options in different sections, so check all of them.',
  },
  {
    question: 'Why do some classes show "Reserved" seating?',
    answer:
      "Reserved seats are usually held for majors, honors students, or specific cohorts. Sometimes they open up later, sometimes they don't. Worth checking back, especially after the first week when people drop.",
  },
];

export default async function MyASUSearchTipsPost() {
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
              <span className="text-foreground">MyASU Search Tips</span>
            </nav>
          </div>

          <div className="not-prose mb-8">
            <h1 className="text-4xl font-semibold text-foreground sm:text-5xl leading-tight">
              MyASU Class Search: 10 Hidden Features Most Students Don't Know
            </h1>
            <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
              <time dateTime="2026-04-26">April 26, 2026</time>
              <span>·</span>
              <span>Updated June 18, 2026</span>
              <span>7 min read</span>
            </div>
          </div>

          <p className="text-lg text-muted-foreground leading-relaxed">
            I'll be honest: most students use MyASU class search like a basic Google search. Type in
            a class name, hit enter, scroll until something looks okay. But the tool has way more
            capability than that, and most people never touch the advanced filters. If you learn a
            few tricks, you can avoid 8 AMs you don't want, find sections at less crowded campuses,
            and actually build a schedule that works with your life instead of against it.
          </p>

          <ShortAnswer>
            The MyASU class search hides its power in the advanced filters: search by subject code,
            filter to open seats only, narrow by campus and session, and use the 5-digit class
            number to register fast. Below are 10 features most students miss, plus how to handle a
            section that's already full.
          </ShortAnswer>

          <KeyTakeaways
            items={[
              {
                text: 'Searching by subject code (like "CSE") shows every course in that department, which is how you stumble on interesting electives',
              },
              {
                text: 'Advanced filters for campus, session, and instruction mode are the difference between a schedule you tolerate and one you actually like',
              },
              {
                text: 'Use the "All" status filter when you\'re tracking full classes, not just the "Open" one',
              },
              {
                text: 'Click into any class to see hidden sections and requirements like labs or special software',
              },
              {
                text: "Bookmark your filtered searches because MyASU won't remember them for you",
              },
            ]}
          />

          <TableOfContents items={tocItems} />

          <h2 id="basic" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Basic Search Tips (That Most Students Miss)
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Even the default search has quirks that can save you time if you know them.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            1. Subject Code vs. Course Number
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            You can search by subject code (like &ldquo;CSE&rdquo; or &ldquo;ENG&rdquo;) or the full
            course number (like &ldquo;CSE 110&rdquo;). The useful part? Searching just the subject
            code pulls up <strong className="text-foreground">every</strong> available course in
            that department. It's a great way to discover electives you'd never think to search for.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Try this:</strong> Search a subject code with no
            course number and just browse. You might find something weird and interesting.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            2. Catalog vs. Class Search
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            There are two different tools and they do different things:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Class Search:</strong> Shows only what's actually
              offered this semester, with real seat counts and times. Use this when you're ready to
              register.
            </li>
            <li>
              <strong className="text-foreground">Course Catalog:</strong> Shows every course ASU
              technically offers, even if it's not running this semester. Good for long-term
              planning.
            </li>
          </ul>
          <p className="text-muted-foreground leading-relaxed">
            Mix them up. Use the Catalog to plan your next three semesters, then switch to Class
            Search when it's time to actually click the enroll button.
          </p>

          <h2 id="advanced-filters" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Advanced Filters (The Stuff Power Users Actually Use)
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Click &ldquo;Advanced Search&rdquo; and suddenly you have actual control. Here's what
            each filter does and why it matters.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">3. Campus Filter</h3>
          <p className="text-muted-foreground leading-relaxed">
            Filter by specific ASU campuses. Obviously useful if you live near one, but also handy
            if your main campus is full:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Tempe:</strong> Main campus, most options
            </li>
            <li>
              <strong className="text-foreground">Downtown Phoenix:</strong> Urban campus, law,
              nursing, journalism
            </li>
            <li>
              <strong className="text-foreground">Polytechnic:</strong> Engineering, tech, aviation
            </li>
            <li>
              <strong className="text-foreground">West:</strong> Smaller campus, diverse programs
            </li>
            <li>
              <strong className="text-foreground">Online:</strong> Fully remote sections
            </li>
          </ul>
          <p className="text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Real talk:</strong> If Tempe is packed, check
            Downtown or Polytechnic. They often have seats for the same classes, and the commute
            might be worth it.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            4. Session Filter (A, B, C)
          </h3>
          <p className="text-muted-foreground leading-relaxed">ASU runs three session types:</p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Session A:</strong> 15 weeks, the traditional full
              semester
            </li>
            <li>
              <strong className="text-foreground">Session B:</strong> 7.5 weeks, first half
            </li>
            <li>
              <strong className="text-foreground">Session C:</strong> 7.5 weeks, second half
            </li>
          </ul>
          <p className="text-muted-foreground leading-relaxed">
            Most people don't realize you can mix them. Two Session B classes back-to-back equals
            the same credit load as one Session A, but with more flexibility. If your Session A pick
            is full, B and C are worth a look.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            5. Mode of Instruction Filter
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Filter by how the class is actually delivered:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">In-Person:</strong> You show up to a classroom.
              Simple.
            </li>
            <li>
              <strong className="text-foreground">ASU Sync:</strong> Live remote. You're on Zoom at
              scheduled class times.
            </li>
            <li>
              <strong className="text-foreground">Online:</strong> Asynchronous. Do the work on your
              own schedule.
            </li>
            <li>
              <strong className="text-foreground">Hybrid:</strong> Some in-person, some online.
            </li>
          </ul>
          <p className="text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Worth trying:</strong> If a class you need only
            meets at a time that conflicts with your job, check if there's an ASU Sync or Online
            section with the same content.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">6. Instructor Search</h3>
          <p className="text-muted-foreground leading-relaxed">
            You can search by professor name. Useful when:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>You want another class with a professor you actually liked</li>
            <li>You're avoiding someone with terrible reviews</li>
            <li>You're looking for a specific researcher in your field</li>
          </ul>
          <p className="text-muted-foreground leading-relaxed">
            Pair this with RateMyProfessors. Building a schedule around good professors makes a huge
            difference in how much you learn and how miserable you are.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            7. Time and Day Filters
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            These are way more useful than they look:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Start Time Range:</strong> Block out 8 AMs if
              you're not a morning person, or find evening classes that fit your work schedule
            </li>
            <li>
              <strong className="text-foreground">Days of Week:</strong> Prefer M/W/F or T/Th?
              Filter for it instead of manually scrolling
            </li>
          </ul>
          <p className="text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Best combo:</strong> Time range + days + campus.
            Stack the filters and you'll get a schedule that actually fits your life.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            8. Open/Closed Filter Tricks
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            The status filter does two things, and you need to know when to use each:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Open:</strong> Only classes with seats available
              right now. Use this when you're about to hit the enroll button.
            </li>
            <li>
              <strong className="text-foreground">All:</strong> Everything, including full classes.
              Use this when you're building your tracking list and want to find specific sections to
              monitor.
            </li>
          </ul>

          <h2 id="reading-results" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Reading the Results (What the Numbers Actually Mean)
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Once you get results, there's more going on than just the class name and time.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            9. Understanding Seat Information
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            The seat numbers aren't just one column. You get three:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Capacity:</strong> Total seats (e.g., 150)
            </li>
            <li>
              <strong className="text-foreground">Enrolled:</strong> People currently signed up
              (e.g., 147)
            </li>
            <li>
              <strong className="text-foreground">Available:</strong> Seats you can actually grab
              (e.g., 3)
            </li>
          </ul>
          <p className="text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Watch for this:</strong> If it says &ldquo;0&rdquo;
            available but the class isn't marked &ldquo;Closed,&rdquo; there might be reserved seats
            opening up later. Don't give up immediately.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            10. Location Codes Explained
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            The location column uses short codes you'll see constantly:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">TEMPE:</strong> Tempe campus buildings
            </li>
            <li>
              <strong className="text-foreground">DTPHX:</strong> Downtown Phoenix campus
            </li>
            <li>
              <strong className="text-foreground">POLY:</strong> Polytechnic campus
            </li>
            <li>
              <strong className="text-foreground">WEST:</strong> West campus
            </li>
            <li>
              <strong className="text-foreground">ONLINE:</strong> Fully online section
            </li>
            <li>
              <strong className="text-foreground">ASU Sync:</strong> Live remote delivery
            </li>
          </ul>

          <h2 id="pro-tips" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Pro Tips for Power Users
          </h2>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Save Your Favorite Searches
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            MyASU doesn't save filters, but your browser does. Bookmark the search results page
            after you apply filters. Name them something useful like &ldquo;Evening Online
            CSE&rdquo; or &ldquo;Morning Tempe Humanities.&rdquo; It saves a surprising amount of
            time during registration week.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Check for Hidden Sections
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Some classes have multiple sections that don't show up in the default list view. If you
            see a class you want but it's full, click into it. A less popular time slot might still
            have seats, or there might be a section at a different campus you didn't see.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Use the Course Description
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Click any class to see the full description, prerequisites, and special notes. This is
            where you'll find stuff like:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>Required lab or recitation sections</li>
            <li>Software or equipment you need to buy</li>
            <li>Honors requirements</li>
            <li>Department consent needed</li>
          </ul>

          <BlogCTA
            heading="Full class? Don't just wait and hope"
            description="PickMyClass checks every 30 minutes and sends you a text when a seat opens. A lot of students get into their must-have classes during add/drop week this way."
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
      <JsonLd data={breadcrumbSchema} />
    </div>
  );
}
