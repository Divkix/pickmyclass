import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';

interface Resource {
  path: string;
  title: string;
  returns: string;
}

const resources: Resource[] = [
  {
    path: '/llms.txt',
    title: 'llms.txt',
    returns:
      'A short Markdown index for agents: what PickMyClass is, the product facts, key pages, the situations it matches, and this resource list.',
  },
  {
    path: '/llms-full.txt',
    title: 'llms-full.txt',
    returns:
      'The full Markdown corpus of the public guides and pages for agents that want everything in one fetch instead of crawling page by page.',
  },
  {
    path: '/sitemap.xml',
    title: 'sitemap.xml',
    returns:
      'Every indexable URL with a last-modified date, the canonical list of pages a crawler should visit.',
  },
  {
    path: '/pricing.md',
    title: 'pricing.md',
    returns:
      'Machine-readable pricing: PickMyClass is free, with no paid tier, no ads, and no upsells to compare against.',
  },
  {
    path: '/blog/feed.xml',
    title: 'blog/feed.xml',
    returns:
      'An RSS 2.0 feed of the blog, with titles, descriptions, links, and publication dates for ASU registration guides.',
  },
  {
    path: '/api/monitoring/health',
    title: 'api/monitoring/health',
    returns:
      'A public JSON liveness check. An unauthenticated request answers 200 with { "status": "ok" }; the detailed dependency report behind it is reserved for the operator.',
  },
  {
    path: '/openapi.json',
    title: 'openapi.json',
    returns:
      'An OpenAPI 3.1 description of the public API: the health endpoint, its response schema, and the JSON error shape every API routing failure returns.',
  },
  {
    path: '/.well-known/security.txt',
    title: '.well-known/security.txt',
    returns: 'The RFC 9116 security contact for reporting a vulnerability in the service.',
  },
];

export const metadata: Metadata = {
  title: 'PickMyClass Developer & Agent Resources',
  description:
    'Machine-readable surfaces for the PickMyClass ASU class seat tracker: llms.txt, llms-full.txt, sitemap.xml, pricing.md, the blog RSS feed, and the public health endpoint.',
  alternates: {
    canonical: '/docs',
  },
  openGraph: {
    title: 'PickMyClass Developer & Agent Resources',
    description:
      'Machine-readable surfaces for the PickMyClass ASU class seat tracker, what each one returns, and how watch management works without a public API.',
    type: 'website',
    url: '/docs',
    images: ['/og-image.png'],
  },
  twitter: {
    title: 'PickMyClass Developer & Agent Resources',
    description:
      'Machine-readable surfaces for the PickMyClass ASU class seat tracker, what each one returns, and how watch management works without a public API.',
  },
};

export const dynamic = 'error';

export default function DocsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 px-4 py-12 md:px-8">
        <article className="prose prose-neutral dark:prose-invert mx-auto max-w-3xl">
          <div className="not-prose mb-8">
            <h1 className="text-4xl font-semibold text-foreground sm:text-5xl leading-tight">
              PickMyClass developer &amp; agent resources
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">
              The machine-readable surfaces of PickMyClass, the free ASU class seat tracker — what
              each one returns, and where the boundaries are.
            </p>
          </div>

          <p className="text-muted-foreground leading-relaxed">
            Every page on this site is also available as Markdown: send{' '}
            <code className="text-sm">Accept: text/markdown</code> and the same server-rendered page
            comes back as <code className="text-sm">text/markdown; charset=utf-8</code>. The same
            Markdown is also served at the page&apos;s <code className="text-sm">.md</code> URL (
            <code className="text-sm">/index.md</code> for the homepage,{' '}
            <code className="text-sm">/faq.md</code> for the FAQ), and HTML responses advertise it
            in the <code className="text-sm">Link</code> header. The files below are the curated
            surfaces, and each one is stable enough to fetch directly.
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Machine-readable surfaces
          </h2>
          <div className="not-prose overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-2 pr-4 font-semibold text-foreground">Surface</th>
                  <th className="py-2 font-semibold text-foreground">What it returns</th>
                </tr>
              </thead>
              <tbody>
                {resources.map((resource) => (
                  <tr key={resource.path} className="border-b border-border/50 align-top">
                    <td className="py-3 pr-4 whitespace-nowrap">
                      <a
                        href={resource.path}
                        className="text-primary hover:text-primary/80 font-mono text-xs"
                      >
                        {resource.title}
                      </a>
                    </td>
                    <td className="py-3 text-muted-foreground">{resource.returns}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">
            API versioning and deprecation
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            The public API is versioned in the URL path:{' '}
            <code className="text-sm">/api/v1/monitoring/health</code> is the current version, and{' '}
            <code className="text-sm">/api/monitoring/health</code> answers identically as a stable
            unversioned alias. A breaking change ships as a new path version, the previous version
            keeps answering, and an endpoint on its way out reports{' '}
            <code className="text-sm">Deprecation</code> and <code className="text-sm">Sunset</code>{' '}
            headers at least 90 days before it stops.
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Watch management needs an account
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            PickMyClass has no public API for reading or changing a student&apos;s watches. Adding a
            class section, removing one, and reading watch state all sit behind a signed-in account
            at{' '}
            <Link href="/sign-up" className="text-primary hover:text-primary/80">
              /sign-up
            </Link>
            : a person searches for a class by its 5-digit section number, adds it to their
            watchlist, and receives an email when a seat opens or a &ldquo;Staff&rdquo; section gets
            a named instructor. An agent cannot create or manage watches on someone else&apos;s
            behalf, and there is no key, token, or endpoint that would let it try. Alerts are
            email-only: no SMS, no push.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            The sign-up page, the FAQ, and the guides are the supported routes for a human working
            through the flow, and the machine-readable files above are the supported routes for
            reading. PickMyClass reads publicly available ASU class search data — the same data any
            student sees — and is not affiliated with Arizona State University.
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">Source repository</h2>
          <p className="text-muted-foreground leading-relaxed">
            The whole service is open source at{' '}
            <a
              href="https://github.com/Divkix/pickmyclass"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary/80"
            >
              github.com/Divkix/pickmyclass
            </a>
            . The code is the specification: what is checked, how often, and what an alert contains.
            Bugs, questions, and feature ideas belong in the{' '}
            <a
              href="https://github.com/Divkix/pickmyclass/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary/80"
            >
              issue tracker
            </a>
            , and account-specific requests belong at{' '}
            <a href="mailto:support@pickmyclass.app" className="text-primary hover:text-primary/80">
              support@pickmyclass.app
            </a>{' '}
            or on the{' '}
            <Link href="/contact" className="text-primary hover:text-primary/80">
              contact page
            </Link>
            .
          </p>
        </article>
      </main>
    </div>
  );
}
