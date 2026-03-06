import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: vi.fn(),
}));

vi.mock('@/lib/email/resend', () => ({
  sendBatchEmailsOptimized: vi.fn(),
}));

const mockSend = vi.fn();
vi.mock('resend', () => {
  return {
    Resend: class {
      emails = { send: mockSend };
    },
  };
});

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
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mockSend.mockResolvedValue({ data: { id: 'msg_1' }, error: null });
    process.env.RESEND_API_KEY = 'test-key';
    process.env.NOTIFICATION_FROM_EMAIL = 'alerts@pickmyclass.app';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockSend.mockReset();
    process.env = { ...originalEnv };
  });

  it('logs structured error with correct fields', async () => {
    const msg = buildMessage();
    mockSupabaseRpc([]);

    await handleDLQMessage(msg);

    expect(console.error).toHaveBeenCalledWith('[DLQ]', expect.stringContaining('42737'));
    expect(console.error).toHaveBeenCalledWith('[DLQ]', expect.stringContaining('2261'));
    expect(console.error).toHaveBeenCalledWith(
      '[DLQ]',
      expect.stringContaining('2026-03-01T00:00:00Z')
    );
  });

  it('calls Supabase to look up watchers', async () => {
    const rpcMock = mockSupabaseRpc([{ user_id: 'u1', email: 'a@test.com', watch_id: 'w1' }]);

    await handleDLQMessage(buildMessage());

    expect(rpcMock).toHaveBeenCalledWith('get_class_watchers', {
      section_number: '42737',
    });
  });

  it('sends alert email via Resend when watchers exist', async () => {
    mockSupabaseRpc([
      { user_id: 'u1', email: 'a@test.com', watch_id: 'w1' },
      { user_id: 'u2', email: 'b@test.com', watch_id: 'w2' },
    ]);

    await handleDLQMessage(buildMessage());

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alerts@pickmyclass.app',
        subject: expect.stringContaining('42737'),
      })
    );
    expect(console.log).toHaveBeenCalledWith('[DLQ]', expect.stringContaining('Alert email sent'));
  });

  it('handles case where no watchers found', async () => {
    mockSupabaseRpc([]);

    await handleDLQMessage(buildMessage());

    expect(console.error).toHaveBeenCalledWith('[DLQ]', expect.stringContaining('42737'));
    expect(console.log).toHaveBeenCalledWith('[DLQ]', expect.stringContaining('0 watchers'));
  });

  it('handles Supabase errors gracefully without throwing', async () => {
    mockSupabaseRpc(null, { message: 'Connection refused' });

    await expect(handleDLQMessage(buildMessage())).resolves.not.toThrow();

    expect(console.error).toHaveBeenCalledWith(
      '[DLQ]',
      expect.stringContaining('Failed to fetch watchers')
    );
  });

  it('handles Resend errors gracefully without throwing', async () => {
    mockSupabaseRpc([{ user_id: 'u1', email: 'a@test.com', watch_id: 'w1' }]);
    mockSend.mockRejectedValue(new Error('API key invalid'));

    await expect(handleDLQMessage(buildMessage())).resolves.not.toThrow();

    expect(console.error).toHaveBeenCalledWith(
      '[DLQ]',
      expect.stringContaining('alert email failed')
    );
  });

  it('skips email when RESEND_API_KEY is not configured', async () => {
    process.env.RESEND_API_KEY = undefined as unknown as string;
    mockSupabaseRpc([]);

    await handleDLQMessage(buildMessage());

    expect(mockSend).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith('[DLQ]', expect.stringContaining('not configured'));
  });
});
