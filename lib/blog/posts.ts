export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  readingTime: string;
}

export const blogPosts: BlogPost[] = [
  {
    slug: 'asu-class-seat-tracker',
    title: 'ASU Class Seat Tracker: How to Get Notified When Seats Open',
    description:
      'Stop refreshing MyASU. Learn how to automatically track ASU class seat availability and get email alerts the moment a seat opens in a full class.',
    publishedAt: '2026-03-27',
    readingTime: '8 min read',
  },
  {
    slug: 'how-to-get-into-full-asu-classes',
    title: 'How to Get Into Full Classes at ASU: 7 Strategies That Work',
    description:
      'Practical strategies to get into full ASU classes during registration and add/drop period. From waitlist tips to automated seat tracking tools.',
    publishedAt: '2026-03-27',
    readingTime: '10 min read',
  },
  {
    slug: 'asu-registration-tips',
    title: 'ASU Registration Tips: Build Your Perfect Schedule',
    description:
      'Everything you need to know about ASU class registration. Enrollment appointment tips, class search strategies, and tools to help you get the schedule you want.',
    publishedAt: '2026-03-27',
    readingTime: '9 min read',
  },
  {
    slug: 'asu-waitlist-guide',
    title: "ASU Waitlist Guide: How It Actually Works (And Why Most Classes Don't Have One)",
    description:
      "Confused about ASU waitlists? Learn how ASU's waitlist system actually works, which classes have them, and what to do when there's no waitlist available.",
    publishedAt: '2026-04-26',
    readingTime: '6 min read',
  },
  {
    slug: 'asu-transfer-registration',
    title: 'ASU Transfer Student Registration: Complete Guide for MyPath2ASU Students',
    description:
      'Everything transfer students need to know about ASU registration. How transfer credits affect your registration date, MyPath2ASU articulation, and tips for getting into full classes.',
    publishedAt: '2026-04-26',
    readingTime: '8 min read',
  },
  {
    slug: 'myasu-search-tips',
    title: "MyASU Class Search: 10 Hidden Features Most Students Don't Know",
    description:
      'Unlock the full power of MyASU class search. Learn advanced filters, hidden shortcuts, and pro tips to find the perfect classes faster.',
    publishedAt: '2026-04-26',
    readingTime: '7 min read',
  },
];
