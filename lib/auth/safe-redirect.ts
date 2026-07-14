/** Return a same-origin path or a safe fallback for post-auth redirects. */
export function safeInternalPath(candidate: string | null | undefined, fallback: string): string {
  if (candidate?.startsWith('/') && !candidate.startsWith('//') && !candidate.startsWith('/\\')) {
    return candidate;
  }
  return fallback;
}
