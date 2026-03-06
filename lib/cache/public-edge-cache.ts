const publicEdgeCacheablePaths = new Set([
  '/',
  '/legal',
  '/legal/terms',
  '/legal/privacy',
  '/sitemap.xml',
  '/robots.txt',
  '/manifest.webmanifest',
]);

export const publicEdgeCacheControl = 'public, max-age=0, must-revalidate';
export const publicEdgeCdnCacheControl = 'public, s-maxage=3600, stale-while-revalidate=86400';

export function isPublicEdgeCacheablePath(pathname: string): boolean {
  return publicEdgeCacheablePaths.has(pathname);
}

export function buildPublicEdgeCacheKey(request: Request): Request {
  const normalizedUrl = new URL(request.url);
  normalizedUrl.search = '';

  return new Request(normalizedUrl.toString(), { method: 'GET' });
}
