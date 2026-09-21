type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type MockEnv = Record<string, JsonValue>;

export const env: MockEnv = {};

export function waitUntil(_promise: Promise<unknown>): void {}

export class DurableObject<_Env = unknown> {
  protected ctx: DurableObjectState;
  protected env: _Env;

  constructor(ctx: DurableObjectState, env: _Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

export function makeFakeCtx(): DurableObjectState {
  const store = new Map<string, unknown>();

  // SAFETY: exercised CronLockDO paths use only storage and blockConcurrencyWhile; rest unused.
  return {
    storage: {
      async get<T>(key: string): Promise<T | undefined> {
        // SAFETY: map holds only values put() here; get hands them back under the caller's T.
        return store.get(key) as T | undefined;
      },
      async put<T>(key: string, value: T): Promise<void> {
        store.set(key, value);
      },
    },
    async blockConcurrencyWhile(fn: () => Promise<void>): Promise<void> {
      await fn();
    },
  } as DurableObjectState;
}
