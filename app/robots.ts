import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = 'https://pickmyclass.app';

  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/legal', '/legal/terms', '/legal/privacy', '/login', '/register'],
        disallow: [
          '/dashboard',
          '/dashboard/*',
          '/admin',
          '/admin/*',
          '/api',
          '/api/*',
          '/auth',
          '/auth/*',
          '/forgot-password',
          '/reset-password',
          '/verify-email',
          '/settings',
          '/go/*',
        ],
      },
      {
        userAgent: 'GPTBot',
        allow: ['/', '/legal', '/legal/terms', '/legal/privacy'],
      },
      {
        userAgent: 'ChatGPT-User',
        allow: ['/'],
      },
      {
        userAgent: 'Google-Extended',
        allow: ['/'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
