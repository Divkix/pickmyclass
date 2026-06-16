/**
 * Mock for cloudflare:workers module used in vitest.
 * Provides fallback exports so Vite can resolve the import.
 * Test files override this with vi.mock('cloudflare:workers', ...).
 */
export const env: Record<string, unknown> = {};

/**
 * Minimal DurableObject base class for testing.
 * Mirrors the cloudflare:workers DurableObject constructor signature.
 * Only implements what CronLockDO actually uses.
 */
export class DurableObject<_Env = unknown> {
  protected ctx: DurableObjectState;
  protected env: _Env;

  constructor(ctx: DurableObjectState, env: _Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

/**
 * Fake DurableObjectState backed by a Map.
 * Supports get/put and blockConcurrencyWhile.
 */
export function makeFakeCtx(): DurableObjectState {
  const store = new Map<string, unknown>();
  return {
    storage: {
      async get<T>(key: string): Promise<T | undefined> {
        return store.get(key) as T | undefined;
      },
      async put(key: string, value: unknown): Promise<void> {
        store.set(key, value);
      },
    },
    async blockConcurrencyWhile(fn: () => Promise<void>): Promise<void> {
      await fn();
    },
  } as unknown as DurableObjectState;
}
