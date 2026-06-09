/**
 * Scoped console logger.
 *
 * Prepends `[scope]` to every log message.
 * info/warn route through console.warn; error routes through console.error
 * so the no-console lint rule only needs to allow `warn` and `error`.
 */
export function log(scope: string): {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
} {
  return {
    info: (...args: unknown[]) => console.warn(`[${scope}]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[${scope}]`, ...args),
    error: (...args: unknown[]) => console.error(`[${scope}]`, ...args),
  };
}
