import type { MetadataRoute } from 'next';
import { blogPosts } from '@/lib/blog/posts';

const baseUrl = 'https://pickmyclass.app';

/**
 * Per-URL lastmod. Blog posts use `publishedAt` (not the bulk `dateModified`
 * stamp that previously made every sitemap row 2026-06-18). Static pages use
 * the date their copy last changed.
 */
const STATIC_PAGE_LASTMOD = {
  '/': '2026-08-28',
  '/faq': '2026-08-22',
  '/about': '2026-08-22',
  '/legal': '2025-10-24',
  '/legal/terms': '2025-10-24',
  '/legal/privacy': '2025-10-24',
} as const;

function lastmod(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const latestPostDate = blogPosts.reduce((latest, post) => {
    return post.publishedAt > latest ? post.publishedAt : latest;
  }, '2025-01-01');

  const blogEntries: MetadataRoute.Sitemap = blogPosts.map((post) => ({
    url: `${baseUrl}/blog/${post.slug}`,
    changeFrequency: 'monthly',
    priority: post.slug === 'asu-class-seat-tracker' ? 0.9 : 0.7,
    lastModified: lastmod(post.publishedAt),
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
    ...blogEntries,
    {
      url: `${baseUrl}/legal`,
      changeFrequency: 'yearly',
      priority: 0.3,
      lastModified: lastmod(STATIC_PAGE_LASTMOD['/legal']),
    },
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
