# Testing Patterns

**Analysis Date:** 2026-02-26

## Test Framework

**Runner:**
- Vitest 4.0.18
- Config: `vitest.config.ts`

**Assertion Library:**
- Vitest built-in expect API (compatible with Jest)
- Testing Library: `@testing-library/react`, `@testing-library/jest-dom` for component testing

**Run Commands:**
```bash
bun run test             # Run vitest in watch mode
bun run test:run        # Run tests once (CI mode, exits after completion)
bun run test:coverage   # Run tests with V8 coverage (enforces 80% thresholds)
bun run test:ui         # Run vitest with browser UI for interactive testing
```

**Single Test File:**
```bash
bunx vitest run tests/unit/lib/utils.test.ts
```

## Test File Organization

**Location:**
- Tests live in `tests/` directory (separate from source code, not colocated)
- Structure mirrors source: `tests/unit/lib/`, `tests/integration/api/`
- Do NOT place tests next to source files

**Naming:**
- `*.test.ts` or `*.spec.ts` suffix
- Examples: `utils.test.ts`, `asu-api.test.ts`, `login.test.ts`, `lockout.test.ts`
- Match source file names where possible: `lib/asu/api.ts` → `tests/unit/lib/asu-api.test.ts`

**Directory Structure:**
```
tests/
├── setup.ts                          # Global test setup (mocks, env vars)
├── unit/                             # Unit tests for utilities and small functions
│   ├── lib/
│   │   ├── utils.test.ts
│   │   ├── lockout.test.ts
│   │   ├── asu-api.test.ts
│   │   └── ratemyprofessor.test.ts
│   └── hooks/
│       └── useSwipe.test.ts
└── integration/                      # Integration tests for API routes
    ├── middleware.test.ts
    └── api/
        ├── login.test.ts
        ├── register.test.ts
        └── class-watches.test.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

describe('functionName or ComponentName', () => {
  // Optional: Setup before all tests
  beforeEach(() => {
    // Reset mocks, fake timers, etc.
  });

  afterEach(() => {
    // Cleanup
  });

  describe('specific behavior group', () => {
    it('should do something specific', () => {
      // Arrange
      const input = 'test';

      // Act
      const result = functionUnderTest(input);

      // Assert
      expect(result).toBe('expected');
    });
  });
});
```

**Example from `tests/unit/lib/utils.test.ts`:**
```typescript
describe('cn - Tailwind class merging utility', () => {
  describe('basic class concatenation', () => {
    it('should merge multiple class strings', () => {
      const result = cn('foo', 'bar', 'baz');
      expect(result).toBe('foo bar baz');
    });

    it('should handle single class', () => {
      const result = cn('single-class');
      expect(result).toBe('single-class');
    });
  });

  describe('Tailwind class conflict resolution', () => {
    it('should merge conflicting padding classes (last wins)', () => {
      const result = cn('p-4', 'p-8');
      expect(result).toBe('p-8');
    });
  });
});
```

**Patterns:**
- Nest `describe` blocks by feature/behavior group
- One assertion per test is preferred (but multiple related assertions OK)
- Descriptive test names starting with "should": `should merge multiple class strings`
- Use `beforeEach` for common setup that applies to multiple tests
- Use `afterEach` for cleanup (e.g., `vi.restoreAllMocks()`, `vi.useRealTimers()`)

## Mocking

**Framework:** Vitest's `vi` module

**Patterns:**

**Mock Functions:**
```typescript
const mockFn = vi.fn();                    // Create mock
mockFn.mockReturnValue('value');           // Sync return
mockFn.mockResolvedValue({ data: [] });   // Async return
mockFn.mockRejectedValue(new Error());    // Async error
mockFn.mockImplementation((x) => x * 2);  // Custom implementation

expect(mockFn).toHaveBeenCalled();
expect(mockFn).toHaveBeenCalledWith('arg');
expect(mockFn).toHaveBeenCalledTimes(1);
```

**Mock Modules:**
```typescript
const mockFetchClassFromASU = vi.fn();

vi.mock('@/lib/asu/api', () => ({
  fetchClassFromASU: (...args: unknown[]) => mockFetchClassFromASU(...args),
  NotFoundError: class NotFoundError extends Error { },
}));
```

**Mock Supabase Chains (Complex Pattern from `tests/integration/api/login.test.ts`):**
```typescript
const mockGetUser = vi.fn();
const mockSignInWithPassword = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getUser: mockGetUser,
        signInWithPassword: mockSignInWithPassword,
      },
    })
  ),
}));

// In tests:
mockSignInWithPassword.mockResolvedValue({
  data: { user: { id: 'user-1' } },
  error: null,
});
```

**Mock Chain Building (from `tests/integration/api/class-watches.test.ts`):**
```typescript
const createMockChain = () => {
  const mockData = { current: null as unknown };
  const mockError = { current: null as { message: string; code: string } | null };

  const chain = {
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
  };

  chain.from.mockReturnValue({
    select: chain.select,
    delete: chain.delete,
  });

  chain.select.mockReturnValue({
    eq: chain.eq,
  });

  chain.eq.mockReturnValue({
    single: chain.single,
  });

  // Helper methods for test setup
  return {
    ...chain,
    setMockData: (data: unknown) => {
      mockData.current = data;
    },
    reset: () => {
      mockData.current = null;
      vi.clearAllMocks();
    },
  };
};

const mockChain = createMockChain();
```

**Fake Timers (from `tests/unit/lib/lockout.test.ts`):**
```typescript
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

// Test can now control time:
it('should return remaining minutes', () => {
  const futureDate = new Date('2024-06-15T12:15:00Z'); // 15 min from mocked "now"
  expect(getRemainingLockoutTime(futureDate)).toBe(15);
});
```

**What to Mock:**
- External APIs (`ASU API`, `Resend`, `Supabase`)
- Heavy dependencies (file I/O, network calls)
- Time-based functions (when testing with fake timers)

**What NOT to Mock:**
- Pure utility functions (`cn`, `formatTime`)
- Simple type transformations
- Business logic you're testing (only mock external dependencies)
- Custom error classes

## Fixtures and Factories

**Test Data:**
- Define test data at top of test file, before mocks
- Use factories for complex objects with many properties

**Example from `tests/integration/api/class-watches.test.ts`:**
```typescript
const mockUser = { id: 'user-123', email: 'test@example.com' };
const mockWatch: ClassWatch = {
  id: 'watch-1',
  user_id: 'user-123',
  term: '2261',
  subject: 'CSE',
  catalog_nbr: '240',
  class_nbr: '12345',
  created_at: '2024-06-15T12:00:00Z',
};
const mockClassState: ClassState = {
  class_nbr: '12345',
  term: '2261',
  subject: 'CSE',
  catalog_nbr: '240',
  title: 'Intro to Programming',
  instructor_name: 'John Doe',
  seats_available: 10,
  seats_capacity: 50,
};
```

**Factory Pattern (from `tests/unit/lib/asu-api.test.ts`):**
```typescript
function buildAsuSuccessResponse() {
  return {
    hits: {
      total: { value: 1 },
      hits: [
        {
          _source: {
            CLASSNBR: '42737',
            SUBJECT: 'ABS',
            // ... more properties
          },
        },
      ],
    },
  };
}

// Use in tests:
const fetchSpy = vi
  .spyOn(global, 'fetch')
  .mockResolvedValue(new Response(JSON.stringify(buildAsuSuccessResponse()), { status: 200 }));
```

**Location:**
- Define test data and factories directly in test files (not separate fixtures directory)
- Keep data close to tests for easy maintenance

## Coverage

**Requirements:**
- 80% threshold for branches, functions, lines, and statements
- Configured in `vitest.config.ts`:
  ```typescript
  thresholds: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  }
  ```
- CI enforces coverage: `bun run test:coverage` fails if thresholds not met

**View Coverage:**
```bash
bun run test:coverage
# Generates HTML report in coverage/ directory
```

**Exclude from Coverage:**
- `lib/supabase/database.types.ts` (generated)
- `**/types.ts` files (type definitions only)
- Test files themselves

## Test Types

**Unit Tests:**
- Location: `tests/unit/`
- Scope: Test single functions in isolation
- Mocking: Mock external dependencies
- Examples: `utils.test.ts`, `asu-api.test.ts`, `lockout.test.ts`
- Fast, run in <100ms typically

**Integration Tests:**
- Location: `tests/integration/`
- Scope: Test route handlers with mocked Supabase/ASU API
- Mocking: Mock external services, not internal functions
- Examples: `api/login.test.ts`, `api/class-watches.test.ts`, `middleware.test.ts`
- Slower, test full request/response cycle

**E2E Tests:**
- Framework: Not currently used in project
- If added: Use Playwright (`bun run test:e2e`)

## Common Patterns

**Async Testing:**
```typescript
it('should fetch class details', async () => {
  const mockFetch = vi.spyOn(global, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(mockData), { status: 200 }));

  const result = await fetchClassFromASU('42737', '2264', config);

  expect(result).toMatchObject({
    subject: 'ABS',
    seats_available: 21,
  });
});
```

**Error Testing:**
```typescript
it('should throw NotFoundError when section not found', async () => {
  vi.spyOn(global, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify({ hits: { hits: [] } }), { status: 200 }));

  await expect(
    fetchClassFromASU('99999', '2264', config)
  ).rejects.toThrow(NotFoundError);
});
```

**Response Validation:**
```typescript
it('should validate request body with Zod', async () => {
  const request = createRequest({ email: 'not-an-email', password: 'pass' });
  const response = await POST(request);

  expect(response.status).toBe(400);
  const data = await response.json() as LoginResponse;
  expect(data.error).toBe('Invalid input');
});
```

**Date/Time Testing with Fake Timers:**
```typescript
it('should set lockout expiration 15 minutes from now', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));

  await incrementFailedAttempts('test@example.com');

  const expectedLockout = new Date('2024-06-15T12:15:00Z');
  expect(mockUpsert).toHaveBeenCalledWith(
    expect.objectContaining({
      locked_until: expectedLockout.toISOString(),
    }),
    { onConflict: 'email' }
  );

  vi.useRealTimers();
});
```

## Global Setup

**File:** `tests/setup.ts`

Runs before any tests. Configures:
- Import Testing Library globals: `@testing-library/jest-dom/vitest`
- Cleanup after each test: `afterEach(() => cleanup())`
- Mock `window.matchMedia` (for animations/media queries)
- Mock `ResizeObserver`, `IntersectionObserver` (DOM APIs)
- Stub environment variables for tests:
  ```typescript
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-secret-key');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://test.example.com');
  ```

## Test Response Types

Define response types in test files to validate against mocked data:

```typescript
interface LoginResponse {
  success?: boolean;
  error?: string;
  details?: Array<{ field: string; message: string }>;
  isLocked?: boolean;
  remainingMinutes?: number;
  remainingAttempts?: number;
}

// Use in assertions:
const data = await parseResponse(response) as LoginResponse;
expect(data.remainingAttempts).toBe(2);
```

## Helper Functions in Tests

Create reusable helpers to reduce boilerplate:

```typescript
// From tests/integration/api/login.test.ts:
function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

async function parseResponse(response: Response): Promise<LoginResponse> {
  return (await response.json()) as LoginResponse;
}

// Use:
const request = createRequest({ email: 'test@example.com', password: 'pass' });
const response = await POST(request);
const data = await parseResponse(response);
```

---

*Testing analysis: 2026-02-26*
