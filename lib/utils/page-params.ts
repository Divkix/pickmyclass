/**
 * Read a single searchParams value as a string.
 *
 * Next.js searchParams values are `string | string[] | undefined`; this
 * normalizes them for the admin pages' filter/sort handling. When the key is
 * absent or holds an array, it returns `''` (which the page-param parsing and
 * `|| 'all'` fallbacks treat as "not provided").
 *
 * @param searchParams - The resolved searchParams record.
 * @param key - The param name to read.
 * @returns The string value, or '' when absent or non-scalar.
 */
export function param(
  searchParams: Record<string, string | string[] | undefined>,
  key: string
): string {
  const v = searchParams[key];
  return typeof v === 'string' ? v : '';
}

/**
 * Parse and sanitize a page number from a query-string parameter.
 *
 * `Number('abc')` is NaN and `Math.max(1, NaN)` is NaN, so raw Number()
 * coercion can serialize NULL to the pagination RPC and break the admin
 * tables. This helper coerces the raw string, validates finiteness, floors
 * decimals, and clamps to a minimum of 1.
 *
 * @param value - Raw query parameter value (the `param()` helper in this
 *   module returns `''` when the key is absent, which maps to the fallback).
 * @param fallback - Value used when the param is missing or not a finite
 *   number (default: 1).
 * @returns A valid page number >= 1.
 */
export function parsePageParam(value: string | undefined, fallback = 1): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
}
