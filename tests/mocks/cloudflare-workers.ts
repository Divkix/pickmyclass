/**
 * Mock for cloudflare:workers module used in vitest.
 * Provides fallback exports so Vite can resolve the import.
 * Test files override this with vi.mock('cloudflare:workers', ...).
 */
export const env: Record<string, unknown> = {};
