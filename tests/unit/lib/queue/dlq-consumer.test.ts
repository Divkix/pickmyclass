import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

// Mock dependencies before importing the module under test
vi.mock('@/lib/db/queries', () => ({
  getClassWatchers: vi.fn(),
}));

const mockSend = vi.fn();
// SAFETY: test double constructs minimal SendEmail shape; only send is accessed
const mockEmailBinding: SendEmail = {
  send: mockSend,
} as SendEmail;

import { getClassWatchers } from '@/lib/db/queries';
import { handleDLQMessage } from '@/lib/queue/dlq-consumer';
import type { ClassCheckMessage } from '@/lib/types/queue';

function buildMessage(overrides: Partial<ClassCheckMessage> = {}): ClassCheckMessage {
  return {
    class_nbr: '42737',
    term: '2261',
    enqueued_at: '2026-03-01T00:00:00Z',
    ...overrides,
  };
}
// SAFETY: test mock narrows getClassWatchers to vi.fn shape to set mockResolvedValue
// eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
const mockGetClassWatchers = getClassWatchers as ReturnType<typeof vi.fn>;
function mockWatchers(watchers: unknown[]) {
  mockGetClassWatchers.mockResolvedValue(watchers);
}

function mockWatchersError(message: string) {
  mockGetClassWatchers.mockRejectedValue(new Error(message));
}

describe('handleDLQMessage', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mockSend.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockSend.mockReset();
    mockGetClassWatchers.mockReset();
  });

  it('logs structured error with correct fields', async () => {
    const msg = buildMessage();
    mockWatchers([]);

    await handleDLQMessage(msg, mockEmailBinding);

    expect(console.error).toHaveBeenCalledWith('[DLQ]', expect.stringContaining('42737'));
    expect(console.error).toHaveBeenCalledWith('[DLQ]', expect.stringContaining('2261'));
    expect(console.error).toHaveBeenCalledWith(
      '[DLQ]',
      expect.stringContaining('2026-03-01T00:00:00Z')
    );
  });

  it('looks up watchers scoped to the failed SectionRef (class_nbr + term)', async () => {
    mockWatchers([{ user_id: 'u1', email: 'a@test.com', watch_id: 'w1' }]);

    await handleDLQMessage(buildMessage(), mockEmailBinding);

    expect(mockGetClassWatchers).toHaveBeenCalledWith({
      class_nbr: '42737',
      term: '2261',
    });
  });

  it('sends alert email via Cloudflare Email Service when watchers exist', async () => {
    mockWatchers([
      { user_id: 'u1', email: 'a@test.com', watch_id: 'w1' },
      { user_id: 'u2', email: 'b@test.com', watch_id: 'w2' },
    ]);

    await handleDLQMessage(buildMessage(), mockEmailBinding);

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alerts@pickmyclass.app',
        subject: expect.stringContaining('42737'),
      })
    );
    expect(console.info).toHaveBeenCalledWith('[DLQ]', expect.stringContaining('Alert email sent'));
  });

  it('uses configured sender for alert emails', async () => {
    mockWatchers([{ user_id: 'u1', email: 'a@test.com', watch_id: 'w1' }]);

    await handleDLQMessage(buildMessage(), mockEmailBinding, {
      fromEmail: 'alerts@pickmyclass.app',
    });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'alerts@pickmyclass.app',
      })
    );
  });

  it('handles case where no watchers found', async () => {
    mockWatchers([]);

    await handleDLQMessage(buildMessage(), mockEmailBinding);

    expect(console.error).toHaveBeenCalledWith('[DLQ]', expect.stringContaining('42737'));
    expect(console.info).toHaveBeenCalledWith('[DLQ]', expect.stringContaining('0 watchers'));
  });

  it('handles watcher lookup errors gracefully without throwing', async () => {
    mockWatchersError('Connection refused');

    await expect(handleDLQMessage(buildMessage(), mockEmailBinding)).resolves.not.toThrow();

    expect(console.error).toHaveBeenCalledWith(
      '[DLQ]',
      expect.stringContaining('Failed to fetch watchers')
    );
  });

  it('handles Cloudflare Email errors gracefully without throwing', async () => {
    mockWatchers([{ user_id: 'u1', email: 'a@test.com', watch_id: 'w1' }]);
    mockSend.mockRejectedValue(new Error('API key invalid'));

    await expect(handleDLQMessage(buildMessage(), mockEmailBinding)).resolves.not.toThrow();

    expect(console.error).toHaveBeenCalledWith(
      '[DLQ]',
      expect.stringContaining('alert email failed')
    );
  });
});
