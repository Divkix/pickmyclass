/**
 * Maps changed repo files to the static sitemap routes whose content they
 * change. The pre-commit hook (`scripts/bump-lastmod.ts`) stamps those routes
 * in `static-page-lastmod.json`, so the sitemap never reads git history at
 * build time (Workers Builds clones shallow).
 */

interface ContentSource {
  /** Repo-relative file or directory prefix (directories end in `/`). */
  prefix: string;
  route: string;
  /** Files under `prefix` that render no page content of their own. */
  ignore: readonly string[];
}

/** Page content that lives outside the route's own `app/` directory. */
const CONTENT_SOURCES: readonly ContentSource[] = [
  {
    prefix: 'components/landing/',
    route: '/',
    ignore: ['components/landing/JsonLd.tsx', 'components/landing/AuthRedirect.tsx'],
  },
  { prefix: 'lib/faqs.ts', route: '/', ignore: [] },
];

const ROOT_PAGE_FILE = /^page\.(?:tsx|ts|jsx|js|mdx)$/;

/** `app/(marketing)/faq` -> `/faq`: route groups do not appear in the URL. */
function routeForAppDirectory(directory: string): string {
  const segments = directory
    .split('/')
    .slice(1)
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')));

  return `/${segments.join('/')}`;
}

function routeForAppFile(file: string): string | null {
  if (!file.startsWith('app/')) return null;

  const slash = file.lastIndexOf('/');
  const route = routeForAppDirectory(file.slice(0, slash));
  const fileName = file.slice(slash + 1);

  // Files directly in app/ (layout, sitemap, globals.css, ...) are shared by
  // every route or by none; only the home page itself belongs to `/`.
  if (route === '/' && !ROOT_PAGE_FILE.test(fileName)) return null;

  return route;
}

function routeForContentSource(file: string): string | null {
  const source = CONTENT_SOURCES.find(
    (candidate) => file.startsWith(candidate.prefix) && !candidate.ignore.includes(file)
  );

  return source?.route ?? null;
}

/**
 * Routes from `trackedRoutes` whose content changed in `files`, sorted.
 * A file in a route's directory belongs to that route only, never to its
 * parent: `app/legal/terms/page.tsx` stamps `/legal/terms`, not `/legal`.
 */
export function changedStaticRoutes(
  files: readonly string[],
  trackedRoutes: readonly string[]
): string[] {
  const tracked = new Set(trackedRoutes);
  const changed = new Set<string>();

  for (const file of files) {
    const route = routeForAppFile(file) ?? routeForContentSource(file);

    if (route && tracked.has(route)) changed.add(route);
  }

  return [...changed].sort();
}

/**
 * Returns `lastmod` with `date` set for each of `routes`, or `null` when
 * nothing would change (so the caller can skip rewriting the file).
 */
export function stampLastmod(
  lastmod: Readonly<Record<string, string>>,
  routes: readonly string[],
  date: string
): Record<string, string> | null {
  const stale = routes.filter((route) => lastmod[route] !== date);

  if (stale.length === 0) return null;

  const next = { ...lastmod };

  for (const route of stale) next[route] = date;

  return next;
}
