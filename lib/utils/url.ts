function appendQueryParams(url: URL, params: Record<string, string>): void {
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
}

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
