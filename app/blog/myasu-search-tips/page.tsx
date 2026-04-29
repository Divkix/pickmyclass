import type { Metadata } from 'next';
import Link from 'next/link';
import { BlogAuthor, BlogFAQ, FAQSchema, TableOfContents } from '@/components/blog';
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
  dateModified: '2026-04-26T00:00:00Z',
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
      "Unfortunately, MyASU class search doesn't have a direct filter for prerequisite requirements. You'll need to click into each class detail to see prerequisites. However, most 100-level general education courses have few or no prerequisites, making them safer bets if you're looking for flexible options.",
  },
  {
    question: 'Can I save my search filters?',
    answer:
      "MyASU class search doesn't have a built-in save feature for filters. However, you can bookmark the search URL after applying filters, or note down your preferred filter combinations for quick re-entry. Some students keep a document with their go-to search parameters.",
  },
  {
    question: 'What does "Staff" mean for instructor?',
    answer:
      '"Staff" means the instructor hasn\'t been assigned yet. This is common early in the registration period. The actual professor is usually announced 2-4 weeks before the semester starts. This is where PickMyClass\'s instructor change alerts become valuable — we notify you when "Staff" gets replaced with an actual name.',
  },
  {
    question: 'How do I find 1-credit or 3-credit classes?',
    answer:
      'Use the advanced filters in the class search. Look for a "Units" or "Credit Hours" filter option. You can typically specify a range (e.g., 3-3 for exactly 3 credits) to narrow results to your needs.',
  },
  {
    question: 'Can I search for classes that fulfill specific general education requirements?',
    answer:
      'Yes! In the advanced search, look for "General Studies" or "Requirement Designation" filters. You can select specific areas like Humanities (HU), Social-Behavioral Sciences (SB), or Natural Sciences (SQ/SG) to find classes that fulfill those requirements.',
  },
  {
    question: 'What\'s the difference between "Open" and "All" in the status filter?',
    answer:
      '"Open" shows only classes with available seats. "All" shows every section including full classes. If you\'re planning to use PickMyClass to track full classes, use "All" so you can find the sections you want to monitor.',
  },
  {
    question: 'How do I find ASU Sync vs fully online classes?',
    answer:
      'Use the "Mode of Instruction" filter. Select "ASU Sync" for live remote classes or "Online" for fully asynchronous online courses. Note that some classes may have multiple modes available in different sections.',
  },
  {
    question: 'Why do some classes show "Reserved" seating?',
    answer:
      "Reserved seats are held for specific student groups — often students in that major, honors students, or certain cohorts. These seats may open to all students after a specific date, or they may remain restricted. If a class shows reserved seats but appears full to you, it's worth checking back later to see if unreserved seats become available.",
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
            <h1 className="text-4xl font-bold text-foreground sm:text-5xl leading-tight">
              MyASU Class Search: 10 Hidden Features Most Students Don&apos;t Know
            </h1>
            <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
              <time dateTime="2026-04-26">April 26, 2026</time>
              <span>7 min read</span>
            </div>
          </div>

          <p className="text-lg text-muted-foreground leading-relaxed">
            Most ASU students use only a fraction of the class search tool&apos;s power. They type
            in a class name, hit search, and hope for the best. But MyASU&apos;s class search has
            hidden features that can help you find better classes, avoid time conflicts, and
            discover options you never knew existed.
          </p>

          <TableOfContents items={tocItems} />

          <h2 id="basic" className="text-2xl font-bold text-foreground mt-10 mb-4">
            Basic Search Tips (That Most Students Miss)
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Even the basic search has nuances that can save you time:
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            1. Subject Code vs. Course Number
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            When searching, you can enter either the subject code (like &ldquo;CSE&rdquo; or
            &ldquo;ENG&rdquo;) or the full course number (like &ldquo;CSE 110&rdquo;). But
            here&apos;s the trick: searching just the subject code shows you{' '}
            <strong className="text-foreground">all</strong> available courses in that department,
            which is great for discovery.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Pro tip:</strong> Try searching a subject code with
            no specific course number to browse interesting electives you might not have considered.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            2. Catalog vs. Class Search
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            There are two different search tools:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Class Search:</strong> Shows only classes offered
              in the current/upcoming semester with actual seats and times
            </li>
            <li>
              <strong className="text-foreground">Course Catalog:</strong> Shows every course ASU
              offers, even if not available this semester — useful for planning
            </li>
          </ul>
          <p className="text-muted-foreground leading-relaxed">
            Use the Class Search when you&apos;re ready to register. Use the Catalog when
            you&apos;re planning future semesters.
          </p>

          <h2 id="advanced-filters" className="text-2xl font-bold text-foreground mt-10 mb-4">
            Advanced Filters (The Power User Section)
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Click &ldquo;Advanced Search&rdquo; to unlock these powerful filters:
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">3. Campus Filter</h3>
          <p className="text-muted-foreground leading-relaxed">Filter by specific ASU campuses:</p>
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
              focus
            </li>
            <li>
              <strong className="text-foreground">West:</strong> Smaller campus, diverse programs
            </li>
            <li>
              <strong className="text-foreground">Online:</strong> ASU Online sections, fully remote
            </li>
          </ul>
          <p className="text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Strategy:</strong> If your preferred campus sections
            are full, check other campuses. Downtown and Polytechnic often have seats when Tempe is
            full.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            4. Session Filter (A, B, C)
          </h3>
          <p className="text-muted-foreground leading-relaxed">ASU offers three session types:</p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Session A:</strong> 15 weeks (traditional full
              semester)
            </li>
            <li>
              <strong className="text-foreground">Session B:</strong> 7.5 weeks (first half)
            </li>
            <li>
              <strong className="text-foreground">Session C:</strong> 7.5 weeks (second half)
            </li>
          </ul>
          <p className="text-muted-foreground leading-relaxed">
            Many students don&apos;t realize they can mix sessions. Taking two Session B classes
            back-to-back equals the same credit load as one Session A class, but with more
            flexibility. If Session A is full, check B and C options.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            5. Mode of Instruction Filter
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Filter by how the class is delivered:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">In-Person:</strong> Traditional classroom
              attendance required
            </li>
            <li>
              <strong className="text-foreground">ASU Sync:</strong> Live remote — attend virtually
              at scheduled times
            </li>
            <li>
              <strong className="text-foreground">Online:</strong> Asynchronous — complete on your
              own schedule
            </li>
            <li>
              <strong className="text-foreground">Hybrid:</strong> Mix of in-person and online
            </li>
          </ul>
          <p className="text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Life hack:</strong> If you need a specific class but
            can&apos;t make the in-person time, check if there&apos;s an ASU Sync or Online section
            with the same content.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">6. Instructor Search</h3>
          <p className="text-muted-foreground leading-relaxed">
            You can search by specific professor name. This is useful when:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>You want to take another class with a professor you liked</li>
            <li>You&apos;re avoiding a professor with poor reviews</li>
            <li>You&apos;re looking for a specific expert in a subject area</li>
          </ul>
          <p className="text-muted-foreground leading-relaxed">
            Combine this with RateMyProfessors research to build a schedule with professors who
            match your learning style.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            7. Time and Day Filters
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            These filters are more powerful than they appear:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Start Time Range:</strong> Avoid 8 AMs or find
              evening classes to fit your work schedule
            </li>
            <li>
              <strong className="text-foreground">Days of Week:</strong> Prefer M/W/F or T/Th?
              Filter for your preferred schedule pattern
            </li>
          </ul>
          <p className="text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Pro combo:</strong> Set a time range that works for
            you + specific days + campus to find the perfect schedule slot.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            8. Open/Closed Filter Tricks
          </h3>
          <p className="text-muted-foreground leading-relaxed">The status filter has two modes:</p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Open:</strong> Only shows classes with available
              seats. Use this when you need to register immediately.
            </li>
            <li>
              <strong className="text-foreground">All:</strong> Shows every section including full
              classes. Use this when you&apos;re planning to set up seat tracking for classes you
              want.
            </li>
          </ul>

          <h2 id="reading-results" className="text-2xl font-bold text-foreground mt-10 mb-4">
            Reading the Results (Decoding the Data)
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Once you get search results, here&apos;s how to interpret what you&apos;re seeing:
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            9. Understanding Seat Information
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            The results show multiple seat numbers:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Capacity:</strong> Total seats in the class (e.g.,
              150)
            </li>
            <li>
              <strong className="text-foreground">Enrolled:</strong> Current students registered
              (e.g., 147)
            </li>
            <li>
              <strong className="text-foreground">Available:</strong> Open seats you can grab (e.g.,
              3)
            </li>
          </ul>
          <p className="text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Watch for:</strong> Classes showing &ldquo;0&rdquo;
            available but not &ldquo;Closed&rdquo; may have reserved seats that could open later.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            10. Location Codes Explained
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            The location column uses codes like:
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

          <h2 id="pro-tips" className="text-2xl font-bold text-foreground mt-10 mb-4">
            Pro Tips for Power Users
          </h2>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Save Your Favorite Searches
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            While MyASU doesn&apos;t have a built-in save feature, you can bookmark search results
            pages after applying filters. Create bookmarks like &ldquo;Evening Online CSE
            Classes&rdquo; or &ldquo;Morning Tempe Humanities&rdquo; for quick access.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Check for Hidden Sections
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Some classes have multiple sections that don&apos;t appear in the default view. If you
            see a class you want but it&apos;s full, click on it to see all available sections.
            Sometimes a less popular time slot still has seats.
          </p>

          <h3 className="text-xl font-semibold text-foreground mt-8 mb-3">
            Use the Course Description
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Click on any class to see its full description, prerequisites, and any special notes.
            This is where you&apos;ll find important details like:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li>Required lab or recitation sections</li>
            <li>Special equipment or software needs</li>
            <li>Honors section requirements</li>
            <li>Department consent requirements</li>
          </ul>

          <div className="not-prose mt-10 rounded-lg border border-primary/20 bg-primary/5 p-8 text-center">
            <h2 className="mb-2 text-2xl font-bold text-foreground">Found the perfect class?</h2>
            <p className="mb-6 text-muted-foreground">
              Set up automatic seat tracking so you never lose your spot. PickMyClass monitors 24/7
              and alerts you when seats open.
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
