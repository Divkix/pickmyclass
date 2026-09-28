import { describe, expect, it } from 'vite-plus/test';
import { postHogSessionIdFromHeaders } from '@/lib/analytics/session-id';

describe('postHogSessionIdFromHeaders', () => {
  it('accepts UUID session IDs and ignores missing or malformed values', () => {
    const sessionId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';

    expect(postHogSessionIdFromHeaders(new Headers())).toBeUndefined();
    expect(
      postHogSessionIdFromHeaders(new Headers({ 'X-PostHog-Session-Id': 'not-a-session-id' }))
    ).toBeUndefined();
    expect(postHogSessionIdFromHeaders(new Headers({ 'X-PostHog-Session-Id': sessionId }))).toBe(
      sessionId
    );
  });
});
