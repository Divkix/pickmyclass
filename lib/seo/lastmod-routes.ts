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

/** Page content that lives outside the route's own `app/routes/` directory. */
const CONTENT_SOURCES: readonly ContentSource[] = [
  {
    prefix: "components/landing/",
    route: "/",
    ignore: ["components/landing/JsonLd.tsx", "components/landing/AuthRedirect.tsx"],
  },
  { prefix: "lib/faqs.ts", route: "/", ignore: [] },
];

function routeForAppFile(file: string): string | null {
  if (!file.startsWith("app/routes/")) return null;

  const routeFile = file.slice("app/routes/".length);

  if (routeFile === "__root.tsx" || !/\.(?:tsx|ts|jsx|js|mdx)$/.test(routeFile)) {
    return null;
  }

  const route = routeFile
    .replace(/\.(?:tsx|ts|jsx|js|mdx)$/, "")
    .replace(/(?:^|\/)(?:index|route)$/, "");

  return `/${route}`;
}

function routeForContentSource(file: string): string | null {
  const source = CONTENT_SOURCES.find(
    (candidate) => file.startsWith(candidate.prefix) && !candidate.ignore.includes(file),
  );

  return source?.route ?? null;
}

/**
 * Routes from `trackedRoutes` whose content changed in `files`, sorted.
 * A file in a route's directory belongs to that route only, never to its
 * parent: `app/routes/legal/terms.tsx` stamps `/legal/terms`, not `/legal`.
 */
export function changedStaticRoutes(
  files: readonly string[],
  trackedRoutes: readonly string[],
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
  date: string,
): Record<string, string> | null {
  const stale = routes.filter((route) => lastmod[route] !== date);

  if (stale.length === 0) return null;

  const next = { ...lastmod };

  for (const route of stale) next[route] = date;

  return next;
}
