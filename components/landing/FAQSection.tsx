import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { faqs } from '@/lib/faqs';

export function FAQSection() {
  return (
    <section className="border-b border-border px-6 py-20">
      <div className="mx-auto max-w-4xl">
        <div className="mb-12 text-center">
          <h2 className="mb-4 text-3xl font-semibold text-foreground sm:text-4xl">
            Frequently Asked Questions
          </h2>
          <p className="text-lg text-muted-foreground">
            Everything you need to know about tracking ASU class seats
          </p>
        </div>

        <div className="space-y-3">
          {faqs.map((faq) => (
            <details
              key={faq.question}
              className="faq-item group rounded-xl border border-border bg-card px-5 transition-colors hover:border-primary/30 open:border-primary/30"
            >
              <summary className="flex items-center justify-between gap-4 py-5 text-left text-base font-semibold text-foreground">
                {faq.question}
                <ChevronDown
                  className="faq-chevron size-5 shrink-0 text-primary"
                  aria-hidden="true"
                />
              </summary>
              <div className="faq-answer">
                <div>
                  <p className="pb-5 leading-relaxed text-muted-foreground">{faq.answer}</p>
                </div>
              </div>
            </details>
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
