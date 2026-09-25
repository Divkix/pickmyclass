type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type MockEnv = Record<string, JsonValue>;

export const env: MockEnv = {};

export function waitUntil(_promise: Promise<unknown>): void {}

export class WorkflowEntrypoint<_Env = unknown> {
  protected ctx: ExecutionContext;
  protected env: _Env;

  constructor(ctx: ExecutionContext, env: _Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
