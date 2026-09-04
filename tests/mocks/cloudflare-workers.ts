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
  return {
    storage: {
      async get<T>(key: string): Promise<T | undefined> {
        return store.get(key) as T | undefined;
      },
      // eslint-disable-next-line anti-slop/no-unknown-parameters
      async put(key: string, value: unknown): Promise<void> {
        store.set(key, value);
      },
    },
    async blockConcurrencyWhile(fn: () => Promise<void>): Promise<void> {
      await fn();
    },
  } as DurableObjectState;
}
