import { Calendar, Clock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { JsonLd } from '@/components/landing/JsonLd';
import { blogPosts } from '@/lib/blog/posts';

export const metadata: Metadata = {
  title: 'ASU Registration Tips & Guides: Class Search, Waitlists & Open Seats',
  description:
    'Real guides for ASU class registration. Find open classes, beat waitlists, get into full sections, and track seats so you stop refreshing MyASU.',
  alternates: {
    canonical: '/blog',
  },
  openGraph: {
    title: 'ASU Registration Tips & Guides: Class Search, Waitlists & Open Seats',
    description:
      'Real guides for ASU class registration. Find open classes, beat waitlists, and track seats so you stop refreshing MyASU.',
    type: 'website',
    url: 'https://pickmyclass.app/blog',
  },
};

export const dynamic = 'error';

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://pickmyclass.app/' },
    { '@type': 'ListItem', position: 2, name: 'Blog' },
  ],
};

export default async function BlogIndexPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="flex-1 px-4 py-12 md:px-8">
        <div className="mx-auto max-w-4xl">
          <div className="mb-4">
            <nav className="text-sm text-muted-foreground">
              <Link href="/" className="hover:text-foreground transition-colors">
                Home
              </Link>
              <span className="mx-2">/</span>
              <span className="text-foreground">Blog</span>
            </nav>
          </div>

          <div className="mb-12">
            <h1 className="text-4xl font-semibold text-foreground sm:text-5xl">
              ASU Registration Tips &amp; Guides
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">
              Straight answers for the stuff ASU never explains clearly: how to find open classes,
              how waitlists really work, how to get into full sections, and how to lock in the
              schedule you actually want.
            </p>
          </div>

          <div className="space-y-6">
            {blogPosts.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="block rounded-lg border border-border bg-card p-6 hover:bg-muted/50 transition-colors"
              >
                <h2 className="text-xl sm:text-2xl font-semibold text-foreground mb-2">
                  {post.title}
                </h2>
                <p className="text-base text-muted-foreground mb-4">{post.description}</p>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="size-3.5" />
                    <time dateTime={post.publishedAt}>
                      {new Date(post.publishedAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        timeZone: 'UTC',
                      })}
                    </time>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="size-3.5" />
                    <span>{post.readingTime}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </main>

      <JsonLd data={breadcrumbSchema} />
    </div>
  );
}
