import type { MetadataRoute } from 'next';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const baseUrl = 'https://pickmyclass.app';

  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/faq', '/blog', '/about', '/legal', '/legal/terms', '/legal/privacy'],
        disallow: [
          '/dashboard',
          '/dashboard/*',
          '/admin',
          '/admin/*',
          '/api',
          '/api/*',
          '/auth',
          '/auth/*',
          '/login',
          '/register',
          '/forgot-password',
          '/reset-password',
          '/verify-email',
          '/settings',
          '/go/*',
        ],
      },
      {
        userAgent: 'GPTBot',
        allow: ['/', '/faq', '/blog', '/about', '/legal', '/legal/terms', '/legal/privacy'],
      },
      {
        userAgent: 'ChatGPT-User',
        allow: ['/', '/faq', '/blog', '/about'],
      },
      {
        userAgent: 'Google-Extended',
        allow: ['/', '/faq', '/blog', '/about'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
