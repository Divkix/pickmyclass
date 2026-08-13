/**
 * Mock for cloudflare:workers module used in vitest.
 * Provides fallback exports so Vite can resolve the import.
 * Test files override this with vi.mock('cloudflare:workers', ...).
 */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type MockEnv = Record<string, JsonValue>;
export const env: MockEnv = {};

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
  // SAFETY: mock constructs minimal Cloudflare env for test; only accessed fields asserted
  return {
    storage: {
      async get<T>(key: string): Promise<T | undefined> {
        // SAFETY: test double stores values by key; retrieval mirrors put type for contract
        return store.get(key) as T | undefined;
      },
      // eslint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: mock type guard decodes unknown at I/O boundary
      async put(key: string, value: unknown): Promise<void> {
        store.set(key, value);
      },
    },
    async blockConcurrencyWhile(fn: () => Promise<void>): Promise<void> {
      await fn();
    },
  } as DurableObjectState;
}
