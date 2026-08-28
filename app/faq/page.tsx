import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { JsonLd } from '@/components/landing/JsonLd';

export const metadata: Metadata = {
  title: 'Frequently Asked Questions — ASU Class Seat Notifications',
  description:
    'Everything you need to know about PickMyClass, the free ASU class seat notification service. How it works, notification timing, campus support, and more.',
  alternates: {
    canonical: '/faq',
  },
  openGraph: {
    title: 'Frequently Asked Questions — ASU Class Seat Notifications',
    description:
      'Everything you need to know about PickMyClass, the free ASU class seat notification service. How it works, notification timing, campus support, and more.',
    type: 'website',
    url: 'https://pickmyclass.app/faq',
  },
  twitter: {
    title: 'Frequently Asked Questions — ASU Class Seat Notifications',
    description:
      'Everything you need to know about PickMyClass, the free ASU class seat notification service. How it works, notification timing, campus support, and more.',
  },
};

export const dynamic = 'error';

const faqCategories = [
  {
    title: 'Getting Started',
    faqs: [
      {
        question: 'What is PickMyClass?',
        answer:
          "PickMyClass is a free class seat notification service built for Arizona State University students. We automatically monitor the ASU class search for seat availability changes and instructor assignments, then email you the moment something changes in a class you're watching.",
      },
      {
        question: 'How do I get started?',
        answer:
          "Getting started takes less than 2 minutes. Create a free account, search for your classes by section number, and add them to your watchlist. That's it — we'll handle the rest and email you when seats open up.",
      },
      {
        question: 'Is PickMyClass really free?',
        answer:
          'Yes, completely free. No premium tiers, no hidden fees, no credit card required, and no ads. PickMyClass was built by ASU students who were tired of refreshing MyASU, and we believe every Sun Devil should have access to it.',
      },
      {
        question: 'Do I need to use my ASU email to sign up?',
        answer:
          "No, you can sign up with any email address. We'll send notifications to whatever email you register with, so make sure it's one you check regularly.",
      },
    ],
  },
  {
    title: 'How It Works',
    faqs: [
      {
        question: 'How does PickMyClass track ASU class seat availability?',
        answer:
          'Our system automatically queries the ASU class search API every 30 minutes. We compare the current seat availability against the last known state for each class on your watchlist. When a change is detected — whether a seat opened up or an instructor was assigned — we send you an email notification.',
      },
      {
        question: 'How often does PickMyClass check for open seats?',
        answer:
          "We check every 30 minutes, 24 hours a day, 7 days a week. During busy periods like add/drop week, this means you'll know about an open seat well before most students who are checking manually.",
      },
      {
        question: 'How fast will I be notified when a seat opens?',
        answer:
          "You'll receive an email within minutes of our system detecting the change. Since we check every 30 minutes, the maximum delay between a seat opening and you being notified is about 30 minutes — far faster than checking manually throughout the day.",
      },
      {
        question: 'Will I be notified when a professor is assigned to a "Staff" section?',
        answer:
          'Yes! Instructor change detection is one of our most popular features. When ASU updates a section from "Staff" to an actual professor name, you\'ll get an email alert so you can look them up on RateMyProfessors before committing to the class.',
      },
      {
        question: 'How is this different from checking the ASU class search manually?',
        answer:
          'Instead of you manually refreshing the ASU class search page dozens of times a day hoping to catch an open seat, PickMyClass automates that entire process. We check every 30 minutes and email you the moment something changes — so you can focus on studying, working, or literally anything else.',
      },
    ],
  },
  {
    title: 'Features & Compatibility',
    faqs: [
      {
        question: 'Does PickMyClass work for all ASU campuses?',
        answer:
          'Yes, PickMyClass supports all ASU campuses including Tempe, Downtown Phoenix, Polytechnic, West, and ASU Online. Any class listed in the ASU class search system can be tracked.',
      },
      {
        question: 'How many classes can I track at once?',
        answer:
          "You can track multiple classes simultaneously. Simply add each section number to your watchlist and we'll monitor all of them for you. There's no need to check back — we'll email you when anything changes.",
      },
      {
        question: 'Can I track classes for different semesters?',
        answer:
          "You can track classes for any term that's currently available in the ASU class search system. When ASU publishes a new term's schedule, those classes become available to track immediately.",
      },
      {
        question: 'Can I use PickMyClass on my phone?',
        answer:
          "Absolutely. PickMyClass works in any web browser on desktop, tablet, or mobile. The dashboard is fully responsive and optimized for smaller screens. You can even add it to your phone's home screen for quick access.",
      },
      {
        question: 'What if a seat opens and closes before I can register?',
        answer:
          "This can happen during high-demand periods. We recommend keeping email notifications on and acting quickly when you receive an alert. The 30-minute check cycle means you'll still be among the first to know — far ahead of students checking manually.",
      },
    ],
  },
  {
    title: 'Account & Privacy',
    faqs: [
      {
        question: 'Does PickMyClass store my ASU credentials?',
        answer:
          'No, absolutely not. We never ask for your ASU login credentials. PickMyClass works by monitoring publicly available class search data. Your ASU account stays completely separate and secure.',
      },
      {
        question: 'What data does PickMyClass collect?',
        answer:
          "We collect only what's necessary to provide the service: your email address for notifications and the class sections you're watching. We don't sell your data, don't run ads, and don't share your information with third parties. See our Privacy Policy for full details.",
      },
      {
        question: 'How do I delete my account?',
        answer:
          'You can delete your account at any time from the Settings page. This permanently removes all your data including your watchlist, notification history, and account information.',
      },
      {
        question: 'Is PickMyClass affiliated with Arizona State University?',
        answer:
          'No, PickMyClass is an independent tool built by ASU students for ASU students. We are not affiliated with, endorsed by, or sponsored by Arizona State University.',
      },
    ],
  },
];

const allFaqs = faqCategories.flatMap((cat) => cat.faqs);

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: allFaqs.map((faq) => ({
    '@type': 'Question',
    name: faq.question,
    acceptedAnswer: {
      '@type': 'Answer',
      text: faq.answer,
    },
  })),
};

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://pickmyclass.app/' },
    { '@type': 'ListItem', position: 2, name: 'FAQ' },
  ],
};

export default async function FAQPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 px-4 py-12 md:px-8">
        <div className="mx-auto max-w-4xl">
          <div className="mb-4">
            <nav className="text-sm text-muted-foreground">
              <Link href="/" className="hover:text-foreground transition-colors">
                Home
              </Link>
              <span className="mx-2">/</span>
              <span className="text-foreground">FAQ</span>
            </nav>
          </div>

          <div className="mb-12">
            <h1 className="text-4xl font-semibold text-foreground sm:text-5xl">
              Frequently Asked Questions
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">
              Everything you need to know about using PickMyClass to track ASU class seat
              availability. Can&apos;t find your answer?{' '}
              <a
                href="mailto:support@pickmyclass.app"
                className="text-primary hover:text-primary/80 transition-colors"
              >
                Contact us
              </a>
              .
            </p>
          </div>

          {faqCategories.map((category) => (
            <section key={category.title} className="mb-12">
              <h2 className="mb-6 text-2xl font-semibold text-foreground">{category.title}</h2>
              <div className="space-y-4">
                {category.faqs.map((faq) => (
                  <div key={faq.question} className="rounded-lg border border-border bg-card p-6">
                    <h3 className="mb-2 text-lg font-semibold text-foreground">{faq.question}</h3>
                    <p className="text-muted-foreground leading-relaxed">{faq.answer}</p>
                  </div>
                ))}
              </div>
            </section>
          ))}

          <div className="rounded-lg border border-primary/20 bg-primary/5 p-8 text-center">
            <h2 className="mb-2 text-2xl font-semibold text-foreground">
              Ready to stop refreshing?
            </h2>
            <p className="mb-6 text-muted-foreground">
              Join 2,400+ Sun Devils who get notified when seats open in full ASU classes.
            </p>
            <Link
              href="/sign-up"
              className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
            >
              Get Started Free
            </Link>
          </div>
        </div>
      </main>

      <JsonLd data={faqSchema} />
      <JsonLd data={breadcrumbSchema} />
    </div>
  );
}
