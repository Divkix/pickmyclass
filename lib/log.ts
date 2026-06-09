/**
 * Scoped console logger.
 *
 * Prepends `[scope]` to every log message.
 * info routes through console.info and warn routes through console.warn, matching the
 * logging behavior implemented in the info and warn handlers below. Therefore, the
 * no-console lint rule must allow console.info, console.warn, and console.error.
 */
export function log(scope: string): {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
} {
  return {
    info: (...args: unknown[]) => console.info(`[${scope}]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[${scope}]`, ...args),
    error: (...args: unknown[]) => console.error(`[${scope}]`, ...args),
  };
}
