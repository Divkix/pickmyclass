import type { SpanAttributes } from "@/lib/telemetry/span";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type MockEnv = Record<string, JsonValue>;

export const env: MockEnv = {};

export class WorkflowEntrypoint<_Env = unknown> {
  protected ctx: ExecutionContext;
  protected env: _Env;

  constructor(ctx: ExecutionContext, env: _Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

type SpanValue = SpanAttributes[string];

/** Records attributes so tests can assert what a span was tagged with. */
export class MockSpan {
  readonly isTraced = false;
  readonly attributes = new Map<string, SpanValue>();

  constructor(readonly name: string) {}

  setAttribute(key: string, value: SpanValue): this {
    this.attributes.set(key, value);

    return this;
  }

  setAttributes(attributes: SpanAttributes): this {
    for (const [key, value] of Object.entries(attributes)) this.attributes.set(key, value);

    return this;
  }

  end(): void {}
}

/** Every span opened through `tracing`, in order; tests clear it between cases. */
export const openedSpans: MockSpan[] = [];

export const tracing = {
  enterSpan<T, A extends unknown[]>(
    name: string,
    callback: (span: MockSpan, ...args: A) => T,
    ...args: A
  ): T {
    const span = new MockSpan(name);
    openedSpans.push(span);

    return callback(span, ...args);
  },
};
