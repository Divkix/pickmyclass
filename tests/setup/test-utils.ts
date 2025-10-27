import type { ClassCheckMessage } from '@/lib/types/queue'
import { MockHyperdrive, MockQueue, MockKVNamespace } from '../mocks/cloudflare-env'

/**
 * Creates a mock Cloudflare environment with all bindings
 */
export function createMockEnv(overrides: Partial<CloudflareEnv> = {}): CloudflareEnv {
  return {
    HYPERDRIVE: new MockHyperdrive(),
    CLASS_CHECK_QUEUE: new MockQueue(),
    RATE_LIMIT_KV: new MockKVNamespace(),
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    SCRAPER_URL: 'http://localhost:3000',
    SCRAPER_SECRET_TOKEN: 'test-scraper-token',
    SCRAPER_BATCH_SIZE: '3',
    RESEND_API_KEY: 're_test_key',
    NOTIFICATION_FROM_EMAIL: 'test@example.com',
    NEXT_PUBLIC_BASE_URL: 'http://localhost:3000',
    ...overrides,
  } as CloudflareEnv
}

/**
 * Creates a mock Request object
 */
export function createMockRequest(
  url: string,
  init?: RequestInit & { headers?: Record<string, string> }
): Request {
  const headers = new Headers(init?.headers)
  return new Request(url, {
    ...init,
    headers,
  })
}

/**
 * Creates a mock queue message for class checking
 */
export function createQueueMessage(
  data: Partial<ClassCheckMessage> = {}
): ClassCheckMessage {
  return {
    classNbr: data.classNbr || '12431',
    term: data.term || '2261',
    subject: data.subject || 'CSE',
    catalogNbr: data.catalogNbr || '110',
  }
}

/**
 * Creates a batch of mock queue messages
 */
export function createQueueMessageBatch(
  messages: Partial<ClassCheckMessage>[] = []
): ClassCheckMessage[] {
  if (messages.length === 0) {
    return [createQueueMessage(), createQueueMessage({ classNbr: '12432' })]
  }
  return messages.map(msg => createQueueMessage(msg))
}

/**
 * Mock successful HTTP response
 */
export function createMockResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Mock error HTTP response
 */
export function createErrorResponse(message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
