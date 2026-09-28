export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  dateModified?: string;
  readingTime: string;
}

export const blogPosts: BlogPost[] = [
  {
    slug: 'best-asu-class-seat-tracker',
    title: 'Best ASU Class Seat Tracker 2026: Free vs Paid',
    description:
      'Compare ASU seat trackers by published price, campus coverage, alert channel, check cadence and limits. Details checked September 28, 2026.',
    publishedAt: '2026-06-18',
    dateModified: '2026-09-28',
    readingTime: '8 min read',
  },
  {
    slug: 'asu-class-search',
    title: 'Find Open ASU Classes: Search Sections and Track Full Courses',
    description:
      "Use ASU Class Search to review sections and availability. If a section is full, check ASU's options or track it for seat-opening email alerts.",
    publishedAt: '2026-06-18',
    dateModified: '2026-09-28',
    readingTime: '4 min read',
  },
  {
    slug: 'how-to-register-for-classes-at-asu',
    title: 'How to Register for Classes at ASU: Step-by-Step (2026)',
    description:
      'Step-by-step guide to ASU registration: find your enrollment date, clear holds, add classes in MyASU by section number, and fix the errors that block you.',
    publishedAt: '2026-06-18',
    dateModified: '2026-06-18',
    readingTime: '8 min read',
  },
  {
    slug: 'asu-class-seat-tracker',
    title: 'ASU Class Seat Tracker: How to Get Notified When Seats Open',
    description:
      'Stop refreshing MyASU. Learn how to automatically track ASU class seat availability and get email alerts the moment a seat opens in a full class.',
    publishedAt: '2026-03-27',
    dateModified: '2026-06-18',
    readingTime: '8 min read',
  },
  {
    slug: 'how-to-get-into-full-asu-classes',
    title: 'How to Get Into Full Classes at ASU: 7 Strategies That Work',
    description:
      'Practical strategies to get into full ASU classes during registration and add/drop period. From waitlist tips to automated seat tracking tools.',
    publishedAt: '2026-03-27',
    dateModified: '2026-06-18',
    readingTime: '10 min read',
  },
  {
    slug: 'asu-registration-tips',
    title: 'ASU Registration Tips: Build Your Perfect Schedule',
    description:
      'Everything you need to know about ASU class registration. Enrollment appointment tips, class search strategies, and tools to help you get the schedule you want.',
    publishedAt: '2026-03-27',
    dateModified: '2026-06-18',
    readingTime: '9 min read',
  },
  {
    slug: 'asu-waitlist-guide',
    title: "How to Add a Full ASU Class to the Waitlist (And What to Do If There's No Waitlist)",
    description:
      'Full ASU class? Check for a waitlist, next steps if none appears, and where to verify deadlines or seat restrictions. ASU guidance checked 28 Sep 2026.',
    publishedAt: '2026-04-26',
    dateModified: '2026-09-28',
    readingTime: '6 min read',
  },
  {
    slug: 'asu-transfer-registration',
    title: 'ASU Transfer Student Registration: Complete Guide for MyPath2ASU Students',
    description:
      'ASU registration for transfer students: how transfer credits affect your registration date, MyPath2ASU articulation, and tips for getting into full classes.',
    publishedAt: '2026-04-26',
    dateModified: '2026-06-18',
    readingTime: '8 min read',
  },
  {
    slug: 'myasu-search-tips',
    title: "MyASU Class Search: 10 Hidden Features Most Students Don't Know",
    description:
      'Unlock the full power of MyASU class search. Learn advanced filters, hidden shortcuts, and pro tips to find the perfect classes faster.',
    publishedAt: '2026-04-26',
    dateModified: '2026-06-18',
    readingTime: '7 min read',
  },
];
