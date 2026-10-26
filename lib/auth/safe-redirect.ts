/** URL parsing strips tabs and newlines and reads `\` as `/`, so `"/\t/evil.com"` is `//evil.com`. */
const UNSAFE_PATH_CHARS = /[^\x20-\x7e\u0080-\uffff]|\\/;

export function safeInternalPath(candidate: string | null | undefined, fallback: string): string {
  if (
    candidate?.startsWith("/") &&
    !candidate.startsWith("//") &&
    !UNSAFE_PATH_CHARS.test(candidate)
  ) {
    return candidate;
  }

  return fallback;
}
