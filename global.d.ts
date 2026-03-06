/**
 * Type declarations for CSS imports
 * Fixes TypeScript errors for CSS side-effect imports
 */

declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}

declare const __cacheVersion__: string;
declare const __buildTimestamp__: string;
