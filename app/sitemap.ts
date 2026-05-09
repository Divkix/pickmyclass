import type { MetadataRoute } from 'next';
import { blogPosts } from '@/lib/blog/posts';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = 'https://pickmyclass.app';

  const latestBlogDate = blogPosts.reduce((latest, post) => {
    const modified = post.dateModified ?? post.publishedAt;
    return modified > latest ? modified : latest;
  }, '2025-01-01');

  const blogEntries: MetadataRoute.Sitemap = blogPosts.map((post) => ({
    url: `${baseUrl}/blog/${post.slug}`,
    changeFrequency: 'monthly',
    priority: post.slug === 'asu-class-seat-tracker' ? 0.9 : 0.7,
    lastModified: new Date(post.dateModified ?? post.publishedAt),
  }));

  return [
    {
      url: `${baseUrl}/`,
      changeFrequency: 'weekly',
      priority: 1.0,
      lastModified: new Date(latestBlogDate),
    },
    {
      url: `${baseUrl}/faq`,
      changeFrequency: 'monthly',
      priority: 0.8,
      lastModified: new Date(latestBlogDate),
    },
    {
      url: `${baseUrl}/blog`,
      changeFrequency: 'weekly',
      priority: 0.6,
      lastModified: new Date(latestBlogDate),
    },
    {
      url: `${baseUrl}/about`,
      changeFrequency: 'monthly',
      priority: 0.5,
      lastModified: new Date(latestBlogDate),
    },
    ...blogEntries,
    {
      url: `${baseUrl}/legal`,
      changeFrequency: 'yearly',
      priority: 0.3,
      lastModified: new Date(latestBlogDate),
    },
    {
      url: `${baseUrl}/legal/terms`,
      changeFrequency: 'yearly',
      priority: 0.3,
      lastModified: new Date(latestBlogDate),
    },
    {
      url: `${baseUrl}/legal/privacy`,
      changeFrequency: 'yearly',
      priority: 0.3,
      lastModified: new Date(latestBlogDate),
    },
  ];
}
