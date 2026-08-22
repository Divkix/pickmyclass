import type { MetadataRoute } from 'next';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const baseUrl = 'https://pickmyclass.app';

  // Private routes that no crawler (including AI bots) should index.
  const disallow = [
    '/dashboard',
    '/dashboard/*',
    '/admin',
    '/admin/*',
    '/api',
    '/api/*',
    '/auth',
    '/auth/*',
    '/sign-in',
    '/sign-in/*',
    '/sign-up',
    '/sign-up/*',
    '/settings',
    '/go/*',
  ];

  // AI search + assistant crawlers we want to allow so they can cite us.
  // Each gets the same disallow list as `*` so private routes stay protected.
  const aiBots = [
    'GPTBot',
    'OAI-SearchBot',
    'ChatGPT-User',
    'Google-Extended',
    'PerplexityBot',
    'Perplexity-User',
    'ClaudeBot',
    'Claude-SearchBot',
    'Claude-User',
    'anthropic-ai',
    'Applebot-Extended',
  ];

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow,
      },
      ...aiBots.map((userAgent) => ({
        userAgent,
        allow: '/',
        disallow,
      })),
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
