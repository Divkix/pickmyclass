import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://pickmyclass.app';

  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/legal', '/legal/terms', '/legal/privacy'],
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
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
