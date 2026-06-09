import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

// Mock dependencies before importing the module under test
vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: vi.fn(),
}));

const mockSend = vi.fn();
const mockEmailBinding: SendEmail = {
  send: mockSend,
} as unknown as SendEmail;

import { handleDLQMessage } from '@/lib/queue/dlq-consumer';
import { getServiceClient } from '@/lib/supabase/service';
import type { ClassCheckMessage } from '@/lib/types/queue';

function buildMessage(overrides: Partial<ClassCheckMessage> = {}): ClassCheckMessage {
  return {
    class_nbr: '42737',
    term: '2261',
    enqueued_at: '2026-03-01T00:00:00Z',
    stagger_group: 'even',
    ...overrides,
  };
}

function mockSupabaseRpc(data: unknown[] | null, error: { message: string } | null = null) {
  const rpcMock = vi.fn().mockResolvedValue({ data, error });
  (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({ rpc: rpcMock });
  return rpcMock;
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
  });

  it('logs structured error with correct fields', async () => {
    const msg = buildMessage();
    mockSupabaseRpc([]);

    await handleDLQMessage(msg, mockEmailBinding);

    expect(console.error).toHaveBeenCalledWith('[DLQ]', expect.stringContaining('42737'));
    expect(console.error).toHaveBeenCalledWith('[DLQ]', expect.stringContaining('2261'));
    expect(console.error).toHaveBeenCalledWith(
      '[DLQ]',
      expect.stringContaining('2026-03-01T00:00:00Z')
    );
  });

  it('calls Supabase to look up watchers', async () => {
    const rpcMock = mockSupabaseRpc([{ user_id: 'u1', email: 'a@test.com', watch_id: 'w1' }]);

    await handleDLQMessage(buildMessage(), mockEmailBinding);

    expect(rpcMock).toHaveBeenCalledWith('get_class_watchers', {
      section_number: '42737',
    });
  });

  it('sends alert email via Cloudflare Email Service when watchers exist', async () => {
    mockSupabaseRpc([
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
    mockSupabaseRpc([{ user_id: 'u1', email: 'a@test.com', watch_id: 'w1' }]);

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
    mockSupabaseRpc([]);

    await handleDLQMessage(buildMessage(), mockEmailBinding);

    expect(console.error).toHaveBeenCalledWith('[DLQ]', expect.stringContaining('42737'));
    expect(console.info).toHaveBeenCalledWith('[DLQ]', expect.stringContaining('0 watchers'));
  });

  it('handles Supabase errors gracefully without throwing', async () => {
    mockSupabaseRpc(null, { message: 'Connection refused' });

    await expect(handleDLQMessage(buildMessage(), mockEmailBinding)).resolves.not.toThrow();

    expect(console.error).toHaveBeenCalledWith(
      '[DLQ]',
      expect.stringContaining('Failed to fetch watchers')
    );
  });

  it('handles Cloudflare Email errors gracefully without throwing', async () => {
    mockSupabaseRpc([{ user_id: 'u1', email: 'a@test.com', watch_id: 'w1' }]);
    mockSend.mockRejectedValue(new Error('API key invalid'));

    await expect(handleDLQMessage(buildMessage(), mockEmailBinding)).resolves.not.toThrow();

    expect(console.error).toHaveBeenCalledWith(
      '[DLQ]',
      expect.stringContaining('alert email failed')
    );
  });
});
