import { JsonLd } from '@/components/landing/JsonLd';

interface FAQItem {
  question: string;
  answer: string;
}

interface BlogFAQProps {
  items: FAQItem[];
}

export function BlogFAQ({ items }: BlogFAQProps) {
  return (
    <>
      <div className="space-y-4 my-6">
        {items.map((item) => (
          <div key={item.question} className="rounded-lg border border-border bg-card p-5">
            <h3 className="font-semibold text-foreground mb-2">{item.question}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{item.answer}</p>
          </div>
        ))}
      </div>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: items.map((item) => ({
            '@type': 'Question',
            name: item.question,
            acceptedAnswer: { '@type': 'Answer', text: item.answer },
          })),
        }}
      />
    </>
  );
}
