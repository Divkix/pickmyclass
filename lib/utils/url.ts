/**
 * URL building helpers to centralize `new URL(...)` + `searchParams.set` patterns.
 */

/**
 * Append query params to an existing URL object.
 */
function appendQueryParams(url: URL, params: Record<string, string>): void {
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
}

/**
 * Build a URL string from a base, an optional path, and query params.
 *
 * When `path` is provided:
 * - if `path` starts with '/', it replaces the base pathname (absolute, matches `new URL(path, base)` semantics)
 * - otherwise it is appended to the base pathname (relative join, deduped)
 * - trailing slashes on the base are trimmed for the join case
 */
export function buildUrl(base: string, path: string, params: Record<string, string>): string {
  const url = new URL(base);
  if (path) {
    if (path.startsWith('/')) {
      url.pathname = path;
    } else {
      const trimmedBase = url.pathname.replace(/\/+$/, '');
      const normalizedPath = `/${path}`;
      const endpoint = trimmedBase.endsWith(normalizedPath)
        ? trimmedBase
        : `${trimmedBase}${normalizedPath}`;
      url.pathname = endpoint;
    }
  }
  appendQueryParams(url, params);
  return url.toString();
}
