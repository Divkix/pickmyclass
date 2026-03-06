import { cacheLife, cacheTag } from 'next/cache';
import { cacheVersion } from '@/lib/cache/cache-version';

export const publicPageCacheLife = {
  revalidate: 24 * 60 * 60,
  expire: 7 * 24 * 60 * 60,
} as const;

export function applyPublicPageCache(...tags: string[]): void {
  cacheLife(publicPageCacheLife);
  cacheTag('content:public', `deploy:${cacheVersion}`, ...tags);
}
