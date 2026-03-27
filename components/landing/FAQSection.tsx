import Link from 'next/link';

const faqs = [
  {
    question: 'How does PickMyClass track ASU class seat availability?',
    answer:
      "PickMyClass automatically checks the ASU class search system every 30 minutes for changes in seat availability and instructor assignments. When a seat opens up in a class you're watching, we send you an email alert so you can register before anyone else.",
  },
  {
    question: 'Is PickMyClass free for ASU students?',
    answer:
      'Yes, PickMyClass is completely free and always will be. There are no premium tiers, no hidden fees, and no ads. We built this tool because we were tired of refreshing MyASU ourselves.',
  },
  {
    question: 'How often does PickMyClass check for open seats?',
    answer:
      "We check every 30 minutes, around the clock. During high-traffic periods like add/drop week, this means you'll know about an open seat well before most students checking manually.",
  },
  {
    question: 'Will I be notified when a professor is assigned to a "Staff" section?',
    answer:
      'Yes! Instructor change detection is one of our key features. When ASU updates a section from "Staff" to an actual professor name, you\'ll get an email alert so you can look them up on RateMyProfessors before committing.',
  },
  {
    question: 'Does PickMyClass work for all ASU campuses and online classes?',
    answer:
      'Yes, PickMyClass supports all ASU campuses including Tempe, Downtown Phoenix, Polytechnic, West, and ASU Online. Any class listed in the ASU class search can be tracked.',
  },
  {
    question: 'How many classes can I track at once?',
    answer:
      "You can track multiple classes simultaneously. Just add each section number to your watchlist and we'll monitor all of them for you.",
  },
  {
    question: 'Is PickMyClass affiliated with Arizona State University?',
    answer:
      'No, PickMyClass is an independent tool built by ASU students for ASU students. We are not affiliated with, endorsed by, or sponsored by Arizona State University.',
  },
  {
    question: 'How is this different from checking the ASU class search manually?',
    answer:
      'Instead of you manually refreshing the ASU class search page hoping to catch an open seat, PickMyClass automates that process. We check every 30 minutes and email you the moment something changes — so you can go about your day without stressing about missing a seat.',
  },
];

export function FAQSection() {
  return (
    <section className="border-b border-border px-6 py-20">
      <div className="mx-auto max-w-4xl">
        <div className="mb-12 text-center">
          <h2 className="mb-4 text-3xl font-bold text-foreground sm:text-4xl">
            Frequently Asked Questions
          </h2>
          <p className="text-lg text-muted-foreground">
            Everything you need to know about tracking ASU class seats
          </p>
        </div>

        <div className="space-y-6">
          {faqs.map((faq) => (
            <div key={faq.question} className="rounded-lg border border-border bg-card p-6">
              <h3 className="mb-2 text-lg font-semibold text-foreground">{faq.question}</h3>
              <p className="text-muted-foreground leading-relaxed">{faq.answer}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 text-center">
          <Link
            href="/faq"
            className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
          >
            See all frequently asked questions &rarr;
          </Link>
        </div>
      </div>
    </section>
  );
}

export { faqs };
