import type { MetadataRoute } from 'next';
import { blogPosts } from '@/lib/blog/posts';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = 'https://pickmyclass.app';

  const blogEntries: MetadataRoute.Sitemap = blogPosts.map((post) => ({
    url: `${baseUrl}/blog/${post.slug}`,
    changeFrequency: 'monthly',
    priority: post.slug === 'asu-class-seat-tracker' ? 0.9 : 0.7,
    lastModified: new Date(post.publishedAt),
  }));

  return [
    {
      url: `${baseUrl}/`,
      changeFrequency: 'weekly',
      priority: 1.0,
      lastModified: new Date(),
    },
    {
      url: `${baseUrl}/faq`,
      changeFrequency: 'monthly',
      priority: 0.8,
      lastModified: new Date(),
    },
    {
      url: `${baseUrl}/blog`,
      changeFrequency: 'weekly',
      priority: 0.6,
      lastModified: new Date(),
    },
    ...blogEntries,
    {
      url: `${baseUrl}/legal`,
      changeFrequency: 'yearly',
      priority: 0.3,
      lastModified: new Date(),
    },
    {
      url: `${baseUrl}/legal/terms`,
      changeFrequency: 'yearly',
      priority: 0.3,
      lastModified: new Date(),
    },
    {
      url: `${baseUrl}/legal/privacy`,
      changeFrequency: 'yearly',
      priority: 0.3,
      lastModified: new Date(),
    },
  ];
}
