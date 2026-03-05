# Coding Conventions

**Analysis Date:** 2026-02-26

## Naming Patterns

**Files:**
- Kebab-case for files and directories: `class-watches.test.ts`, `asu-api.ts`, `failed-login-attempts`
- React components and route files use standard conventions:
  - Components: PascalCase: `SeatAvailableEmailTemplate.tsx`
  - Route handlers: `route.ts` in directory (e.g., `app/api/class-watches/route.ts`)
  - Test files: `*.test.ts` or `*.spec.ts` suffix

**Functions:**
- camelCase for all functions: `fetchClassFromASU`, `createClassWatch`, `getServiceClient`, `incrementFailedAttempts`
- PascalCase allowed for React components: `SeatAvailableEmailTemplate`, `InstructorAssignedEmailTemplate`
- Biome `useNamingConvention` rule enforces both camelCase and PascalCase for functions (see biome.json override rules)

**Variables:**
- camelCase for all variables: `mockUser`, `classNumbers`, `watchesWithStates`, `updateData`
- Biome allows both camelCase and PascalCase for variables

**Types:**
- PascalCase for all types: `ClassWatcher`, `ClassDetails`, `ClassState`, `UserProfile`, `LockoutStatus`, `ApiError`
- Interfaces and type aliases follow same pattern: `ClassWatch`, `ClassInfo`, `EmailResult`

**Constants:**
- CONSTANT_CASE for module-level constants: `MAX_FAILED_ATTEMPTS`, `LOCKOUT_DURATION_MINUTES`, `MAX_WATCHES_PER_USER`, `CLASS_SEARCH_ENDPOINT_PATH`
- camelCase also allowed by biome config for constants

**Exception: Naming Convention Bypass**
Biome's naming convention rule is disabled for specific files with non-standard requirements:
- `**/route.ts` - Route handlers use exported function names like `GET`, `POST`, `DELETE`
- `worker.ts` - Cloudflare Worker entrypoint has function names like `fetch`, `scheduled`, `queue`
- `lib/asu/api.ts` - External API response types use UPPERCASE_SNAKE_CASE (from ASU's API schema)
- `lib/supabase/**/*.ts` - Generated types and Supabase-specific patterns
- `middleware.ts` - Custom middleware with specific patterns
- `tests/**/*.ts` - Test files have relaxed naming

## Code Style

**Formatting:**
- Tool: Biome 2.4.2
- Indentation: 2 spaces (configured in biome.json)
- Line width: 100 characters (default), 120 for CSS
- Line endings: LF (Unix style)
- Quote style: Single quotes for JavaScript/TypeScript
- JSX quotes: Double quotes

**Key Biome Settings:**
- `bracketSameLine: false` - Closing brackets on new line
- `trailingCommas: 'es5'` - Trailing commas in ES5-compatible format
- `arrowParentheses: 'always'` - Always include parentheses around arrow function parameters
- `semicolons: 'always'` - Always include semicolons
- `bracketSpacing: true` - Spaces inside object literal braces

**Linting:**
- Tool: Biome (same tool as formatting)
- Recommended rules enabled with targeted overrides
- Run: `bun run lint` to check, `bun run lint:fix` to auto-fix

**Key Linter Rules:**
- `noNonNullAssertion: off` - Non-null assertions (!) are allowed (used frequently in response type assertions)
- `noParameterAssign: off` - Parameter reassignment allowed
- `noExplicitAny: warn` - Explicit `any` types generate warnings, not errors
- `useExhaustiveDependencies: warn` - React dependency warnings (not errors)
- `noArrayIndexKey: warn` - Using array index as React key generates warnings
- `noSvgWithoutTitle: warn`, `noLabelWithoutControl: warn` - Accessibility warnings

## Import Organization

**Order:**
1. Node.js built-in imports: `import { resolve } from 'node:path'`
2. External packages: `import { z } from 'zod'`, `import { Resend } from 'resend'`
3. Internal app imports: `import { fetchClassFromASU } from '@/lib/asu/api'`
4. Type-only imports: `import type { Database } from '@/lib/supabase/database.types'`

**Path Aliases:**
- `@/` resolves to project root, configured in `vitest.config.ts` and `tsconfig.json`
- Always use absolute paths via `@/` - never relative paths like `../../../lib`
- Examples: `@/lib/utils`, `@/app/api/cron/route`, `@/components/landing/JsonLd`

**Unused Import Cleanup:**
- Run `bun run knip` to find unused exports and dependencies
- Remove flagged imports immediately

## Error Handling

**Patterns:**
- Custom error classes extend Error with specific types: `ApiError`, `AuthError`, `RateLimitError`, `NotFoundError` (in `lib/asu/api.ts`)
- Error classes set name and status properties:
  ```typescript
  export class AuthError extends ApiError {
    constructor(message: string) {
      super(message, 401);
      this.name = 'AuthError';
    }
  }
  ```
- Check errors in database operations: `if (error) throw new Error(...)`
- Type-safe response parsing: Cast unknown responses with `as` keyword:
  ```typescript
  const data = (await response.json()) as AsuApiResponse;
  ```
- Try-catch blocks for async operations, console errors logged with context prefix:
  ```typescript
  try {
    // operation
  } catch (error) {
    console.error('[DB] Error fetching...:', error);
    throw new Error(`Failed to fetch: ${error.message}`);
  }
  ```

## Logging

**Framework:** console (built-in)

**Patterns:**
- Context-prefixed logs: `[DB]`, `[Email]`, `[Cron]`, `[Auth]` for easy filtering
- Log errors consistently: `console.error('[Context] Message:', error)`
- Log info for important operations: `console.log('[Context] Completed:', details)`
- Never log sensitive data (passwords, tokens, auth headers)
- Example from `lib/db/queries.ts`:
  ```typescript
  console.error(`[DB] Error fetching watchers for section ${classNbr}:`, error);
  console.log(`[DB] Found ${data?.length || 0} sections to check`);
  ```

## Comments

**When to Comment:**
- Document non-obvious logic or tricky algorithms
- Explain WHY, not WHAT - code should be readable enough for WHAT
- Mark intentional workarounds or temporary solutions: `// TODO:`, `// FIXME:`, `// HACK:`
- Do NOT over-comment obvious code

**JSDoc/TSDoc:**
- Use for public functions and exports
- Format:
  ```typescript
  /**
   * [Single line summary]
   *
   * [Optional detailed description]
   *
   * @param paramName - Description
   * @returns Description
   */
  export function functionName(paramName: Type): ReturnType { }
  ```
- Examples in `lib/db/queries.ts`, `lib/asu/api.ts`, `lib/email/resend.ts`
- Required for: database query helpers, public API functions, exported utilities
- Optional for: internal helper functions, one-liners

**Block Comments:**
- Use `/* ... */` for multi-line explanations at top of functions or sections
- Example in `lib/asu/api.ts`:
  ```typescript
  // --- Error Classes ---
  // --- Types ---
  // --- Helpers ---
  // --- Main Function ---
  ```

## Function Design

**Size:**
- Prefer functions under 50 lines
- Complex logic should be split into smaller helper functions
- Main route handlers are exceptions (can be 100+ lines for all validation/business logic)

**Parameters:**
- Use object destructuring for related parameters: `({ term, class_nbr })`
- Zod for validation: `z.object({ term: z.string(), ... }).safeParse(body)`
- Type parameters explicitly: `fetchClassFromASU(classNbr: string, term: string, env: AsuApiEnv)`

**Return Values:**
- Explicit return types always: `async function functionName(): Promise<Type> { }`
- Void for operations with side effects: `async function incrementFailedAttempts(): Promise<void>`
- Never return implicit undefined - throw error or return null explicitly

## Module Design

**Exports:**
- Named exports for functions and types: `export function getClassWatchers`, `export interface ClassWatch`
- Default exports only for React components if single export
- One responsibility per module: `lib/asu/api.ts` only handles ASU API, `lib/auth/lockout.ts` only lockout logic

**Barrel Files:**
- Not heavily used - import directly from source files
- Examples of imports: `import { getServiceClient } from '@/lib/supabase/service'`
- Each module is focused and self-contained

**File Organization Within Modules:**
- Error classes first (if any)
- Type definitions and interfaces
- Helper/utility functions
- Exported main functions
- Example structure in `lib/asu/api.ts`:
  ```typescript
  // --- Error Classes ---
  export class ApiError extends Error { }
  export class AuthError extends ApiError { }

  // --- Types ---
  export interface ClassDetails { }
  interface AsuApiEnv { }

  // --- Helpers ---
  function formatTime() { }
  function mapToClassDetails() { }

  // --- Main Function ---
  export async function fetchClassFromASU() { }
  ```

## TypeScript Configuration

**Two tsconfigs:**
- `tsconfig.json` - vinext app with full library support
- `tsconfig.worker.json` - Cloudflare Workers compatibility (restricted globals)
- Both must pass `tsc --noEmit` in CI

**Type Assertions:**
- Use sparingly, only for necessary casts
- Always cast response.json() to specific type: `as AsuApiResponse`
- Type unknown responses from APIs before use

---

*Convention analysis: 2026-02-26*
