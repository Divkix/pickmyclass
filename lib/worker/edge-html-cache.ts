import { hasSupabaseAuthCookiesInHeader } from '@/lib/auth/supabase-auth-cookies';
import { EDGE_HTML_CACHE_TTL_S } from '@/lib/config';

const EDGE_CACHE_EXACT_PATHS = new Set(['/', '/faq', '/about', '/blog', '/legal']);
const EDGE_CACHE_PREFIXES = ['/blog/', '/legal/'];

interface EdgeCacheStore {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, response: Response): Promise<void>;
}

function isCacheablePath(pathname: string): boolean {
  return (
    EDGE_CACHE_EXACT_PATHS.has(pathname) ||
    EDGE_CACHE_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

function cacheKey(request: Request, versionId?: string): Request {
  const pathname = new URL(request.url).pathname;
  return new Request(`https://edge-cache.internal/${versionId ?? 'dev'}${pathname}`);
}

function defaultCache(): EdgeCacheStore {
  // SAFETY: Cloudflare Cache API exposes caches.default per Workers runtime; lib.dom CacheStorage type lacks default — verified via runtime contract
  const rawCaches: unknown = caches;
  // SAFETY: rawCaches is CacheStorage with default property per Cloudflare runtime; shaped as EdgeCacheStore by contract
  const cacheWithDefault = rawCaches as { default: EdgeCacheStore };
  return cacheWithDefault.default;
}

export function createEdgeHtmlCache(resolveCache: () => EdgeCacheStore) {
  return {
    isEligible(request: Request): boolean {
      const url = new URL(request.url);
      const isRscRequest = request.headers.has('rsc') || url.searchParams.has('_rsc');

      return (
        request.method === 'GET' &&
        !isRscRequest &&
        isCacheablePath(url.pathname) &&
        !hasSupabaseAuthCookiesInHeader(request.headers.get('cookie'))
      );
    },

    get(request: Request, versionId?: string): Promise<Response | undefined> {
      return resolveCache().match(cacheKey(request, versionId));
    },

    put(request: Request, versionId: string | undefined, response: Response): Promise<void> | null {
      const isHtml = response.headers.get('content-type')?.toLowerCase().includes('text/html');
      if (response.status !== 200 || !isHtml || response.headers.has('set-cookie')) {
        return null;
      }

      // ponytail: clones full HTML for cache; accept bounded pages (<100KB)
      const toStore = new Response(response.clone().body, response);
      toStore.headers.set('Cache-Control', `public, s-maxage=${EDGE_HTML_CACHE_TTL_S}`);
      return resolveCache().put(cacheKey(request, versionId), toStore);
    },
  };
}

export const edgeHtmlCache = createEdgeHtmlCache(defaultCache);
