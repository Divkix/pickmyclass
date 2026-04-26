import { Calendar, Clock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { JsonLd } from '@/components/landing/JsonLd';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { blogPosts } from '@/lib/blog/posts';

export const metadata: Metadata = {
  title: 'ASU Class Registration Tips & Guides — PickMyClass Blog',
  description:
    'Expert tips and strategies for ASU class registration. Learn how to get into full classes, track seat availability, and build the perfect schedule.',
  alternates: {
    canonical: '/blog',
  },
  openGraph: {
    title: 'ASU Class Registration Tips & Guides — PickMyClass Blog',
    description:
      'Expert tips and strategies for ASU class registration. Learn how to get into full classes and track seat availability.',
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
            <h1 className="text-4xl font-bold text-foreground sm:text-5xl">Blog</h1>
            <p className="mt-4 text-lg text-muted-foreground">
              Tips, guides, and strategies for ASU class registration. Learn how to build the
              perfect schedule and never miss an open seat.
            </p>
          </div>

          <div className="space-y-6">
            {blogPosts.map((post) => (
              <Link key={post.slug} href={`/blog/${post.slug}`}>
                <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
                  <CardHeader>
                    <CardTitle className="text-xl sm:text-2xl">{post.title}</CardTitle>
                    <CardDescription className="text-base">{post.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
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
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </main>

      <JsonLd data={breadcrumbSchema} />
    </div>
  );
}
