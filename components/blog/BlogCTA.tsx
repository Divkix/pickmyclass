import Link from 'next/link';

interface BlogCTAProps {
  heading: string;
  description: string;
  ctaLabel?: string;
  href?: string;
}

export function BlogCTA({
  heading,
  description,
  ctaLabel = 'Start Tracking Free',
  href = '/sign-up',
}: BlogCTAProps) {
  return (
    <div className="not-prose mt-10 rounded-lg border border-primary/20 bg-primary/5 p-8 text-center">
      <h2 className="mb-2 text-2xl font-semibold text-foreground">{heading}</h2>
      <p className="mb-6 text-muted-foreground">{description}</p>
      <Link
        href={href}
        className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
      >
        {ctaLabel}
      </Link>
    </div>
  );
}
