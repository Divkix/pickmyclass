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
    readingTime: '5 min read',
  },
  {
    slug: 'how-to-get-into-full-asu-classes',
    title: 'How to Get Into Full Classes at ASU: 7 Strategies That Work',
    description:
      'Practical strategies to get into full ASU classes during registration and add/drop period. From waitlist tips to automated seat tracking tools.',
    publishedAt: '2026-03-27',
    readingTime: '7 min read',
  },
  {
    slug: 'asu-registration-tips',
    title: 'ASU Registration Tips: Build Your Perfect Schedule',
    description:
      'Everything you need to know about ASU class registration. Enrollment appointment tips, class search strategies, and tools to help you get the schedule you want.',
    publishedAt: '2026-03-27',
    readingTime: '6 min read',
  },
];
