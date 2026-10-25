export function parsePageParam(value: string | undefined, fallback = 1): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);

  if (!Number.isFinite(n)) return fallback;

  return Math.max(1, Math.floor(n));
}
