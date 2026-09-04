export function param(
  searchParams: Record<string, string | string[] | undefined>,
  key: string
): string {
  const v = searchParams[key];
  return typeof v === 'string' ? v : '';
}

export function parsePageParam(value: string | undefined, fallback = 1): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
}
