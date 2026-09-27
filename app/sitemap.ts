import type { MetadataRoute } from 'next';
import { blogPosts } from '@/lib/blog/posts';
// Stamped by the pre-commit hook (scripts/bump-lastmod.ts) when a page's
// content is committed; edit by hand only to backdate.
import STATIC_PAGE_LASTMOD from '@/lib/seo/static-page-lastmod.json';

const baseUrl = 'https://pickmyclass.app';

function lastmod(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

function postLastmodIso(post: { publishedAt: string; dateModified?: string }): string {
  const modified = post.dateModified ?? post.publishedAt;

  return modified > post.publishedAt ? modified : post.publishedAt;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const latestPostDate = blogPosts.reduce((latest, post) => {
    const modified = postLastmodIso(post);

    return modified > latest ? modified : latest;
  }, '2025-01-01');

  const blogEntries: MetadataRoute.Sitemap = blogPosts.map((post) => ({
    url: `${baseUrl}/blog/${post.slug}`,
    changeFrequency: 'monthly',
    priority: post.slug === 'asu-class-seat-tracker' ? 0.9 : 0.7,
    lastModified: lastmod(postLastmodIso(post)),
  }));

  return [
    {
      url: `${baseUrl}/`,
      changeFrequency: 'weekly',
      priority: 1.0,
      lastModified: lastmod(STATIC_PAGE_LASTMOD['/']),
    },
    {
      url: `${baseUrl}/faq`,
      changeFrequency: 'monthly',
      priority: 0.8,
      lastModified: lastmod(STATIC_PAGE_LASTMOD['/faq']),
    },
    {
      url: `${baseUrl}/blog`,
      changeFrequency: 'weekly',
      priority: 0.6,
      lastModified: lastmod(latestPostDate),
    },
    {
      url: `${baseUrl}/about`,
      changeFrequency: 'monthly',
      priority: 0.5,
      lastModified: lastmod(STATIC_PAGE_LASTMOD['/about']),
    },
    {
      url: `${baseUrl}/contact`,
      changeFrequency: 'yearly',
      priority: 0.4,
      lastModified: lastmod(STATIC_PAGE_LASTMOD['/contact']),
    },
    {
      url: `${baseUrl}/docs`,
      changeFrequency: 'monthly',
      priority: 0.4,
      lastModified: lastmod(STATIC_PAGE_LASTMOD['/docs']),
    },
    ...blogEntries,
    {
      url: `${baseUrl}/legal/terms`,
      changeFrequency: 'yearly',
      priority: 0.3,
      lastModified: lastmod(STATIC_PAGE_LASTMOD['/legal/terms']),
    },
    {
      url: `${baseUrl}/legal/privacy`,
      changeFrequency: 'yearly',
      priority: 0.3,
      lastModified: lastmod(STATIC_PAGE_LASTMOD['/legal/privacy']),
    },
  ];
}
