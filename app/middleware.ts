import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const CacheablePaths = ['/', '/faq', '/blog'];

const CacheControl = 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isCacheable =
    CacheablePaths.includes(pathname) ||
    pathname.startsWith('/blog/') ||
    pathname.startsWith('/legal');

  if (isCacheable) {
    const response = NextResponse.next();
    response.headers.set('Cache-Control', CacheControl);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next|api|dashboard|admin|login|register|settings|verify-email|forgot-password|reset-password|auth|go|favicon.svg|og-image.png|apple-touch-icon.png|manifest.json|fonts/|_headers|.*\\..*$).*)',
  ],
};
