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
    title: 'Best ASU Class Seat Tracker in 2026 (Free vs Paid, Compared)',
    description:
      'Comparing ASU class seat trackers: PickMyClass, ASUClassFinder, SeatSignal, Courseer, and manual checking. See which open-seat alert tool is free, fast, and worth it.',
    publishedAt: '2026-06-18',
    dateModified: '2026-06-18',
    readingTime: '7 min read',
  },
  {
    slug: 'asu-class-search',
    title: 'ASU Class Search: How to Find Open Classes Fast (2026 Guide)',
    description:
      'A student guide to ASU Class Search. Find open sections, filter by campus and seats, decode the section number, and get alerted the second a full class opens up.',
    publishedAt: '2026-06-18',
    dateModified: '2026-06-18',
    readingTime: '7 min read',
  },
  {
    slug: 'how-to-register-for-classes-at-asu',
    title: 'How to Register for Classes at ASU: Step-by-Step (2026)',
    description:
      'A step-by-step guide to registering for classes at ASU. Find your enrollment date, clear holds, add classes in MyASU by section number, and fix the errors that block you.',
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
      "Class full? Here's how to add yourself to an ASU waitlist when one exists, how the 24-hour rule works, and the faster backup that gets you a seat when there's no waitlist.",
    publishedAt: '2026-04-26',
    dateModified: '2026-06-18',
    readingTime: '6 min read',
  },
  {
    slug: 'asu-transfer-registration',
    title: 'ASU Transfer Student Registration: Complete Guide for MyPath2ASU Students',
    description:
      'Everything transfer students need to know about ASU registration. How transfer credits affect your registration date, MyPath2ASU articulation, and tips for getting into full classes.',
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
