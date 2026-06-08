import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

// Mock templates module
vi.mock('@/lib/email/templates', () => ({
  SeatAvailableEmailTemplate: vi.fn(() => '<html>seat</html>'),
  InstructorAssignedEmailTemplate: vi.fn(() => '<html>instructor</html>'),
}));

// Mock unsubscribe token
vi.mock('@/lib/email/unsubscribe-token', () => ({
  generateUnsubscribeUrl: vi.fn((userId: string) => `https://pickmyclass.app/unsub?u=${userId}`),
}));

import { sendBatchEmailsOptimized } from '@/lib/email/send';
import type { ClassInfo } from '@/lib/email/types';

function createMockSendEmail() {
  return {
    send: vi.fn().mockResolvedValue({ messageId: 'msg_test123' }),
  };
}

function buildClassInfo(overrides: Partial<ClassInfo> = {}): ClassInfo {
  return {
    class_nbr: '12345',
    subject: 'CSE',
    catalog_nbr: '100',
    title: 'Intro',
    term: '2261',
    instructor_name: 'Dr. Test',
    seats_available: 3,
    seats_capacity: 50,
    location: 'TMP 101',
    meeting_times: 'MWF 10:00-10:50',
    ...overrides,
  } as ClassInfo;
}

describe('sendBatchEmailsOptimized', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array for empty batch', async () => {
    const sendEmail = createMockSendEmail();
    const results = await sendBatchEmailsOptimized([], sendEmail as unknown as SendEmail);
    expect(results).toEqual([]);
    expect(sendEmail.send).not.toHaveBeenCalled();
  });

  it('sends emails sequentially and returns success results', async () => {
    const sendEmail = createMockSendEmail();
    const emails = [
      {
        to: 'user1@test.com',
        userId: 'u1',
        classInfo: buildClassInfo(),
        type: 'seat_available' as const,
      },
      {
        to: 'user2@test.com',
        userId: 'u2',
        classInfo: buildClassInfo(),
        type: 'instructor_assigned' as const,
      },
    ];

    const results = await sendBatchEmailsOptimized(emails, sendEmail as unknown as SendEmail);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ success: true, messageId: 'msg_test123' });
    expect(results[1]).toEqual({ success: true, messageId: 'msg_test123' });
    expect(sendEmail.send).toHaveBeenCalledTimes(2);
  });

  it('uses the configured sender address when provided', async () => {
    const sendEmail = createMockSendEmail();

    await sendBatchEmailsOptimized(
      [
        {
          to: 'user@test.com',
          userId: 'u1',
          classInfo: buildClassInfo(),
          type: 'seat_available',
        },
      ],
      sendEmail as unknown as SendEmail,
      { fromEmail: 'alerts@pickmyclass.app' }
    );

    expect(sendEmail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'alerts@pickmyclass.app',
      })
    );
  });

  it('captures per-email errors without stopping the batch', async () => {
    const sendEmail = {
      send: vi
        .fn()
        .mockRejectedValueOnce(new Error('Transient failure'))
        .mockResolvedValueOnce({ messageId: 'msg_ok' }),
    };

    const emails = [
      {
        to: 'bad@test.com',
        userId: 'u1',
        classInfo: buildClassInfo(),
        type: 'seat_available' as const,
      },
      {
        to: 'good@test.com',
        userId: 'u2',
        classInfo: buildClassInfo(),
        type: 'seat_available' as const,
      },
    ];

    const results = await sendBatchEmailsOptimized(emails, sendEmail as unknown as SendEmail);

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain('Transient failure');
    expect(results[1].success).toBe(true);
    expect(results[1].messageId).toBe('msg_ok');
    expect(sendEmail.send).toHaveBeenCalledTimes(2);
  });

  it('stops batch on rate limit error and marks remaining as skipped', async () => {
    const rateLimitError = Object.assign(new Error('Rate limit'), {
      code: 'E_RATE_LIMIT_EXCEEDED',
    });

    const sendEmail = {
      send: vi
        .fn()
        .mockResolvedValueOnce({ messageId: 'msg_1' })
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({ messageId: 'msg_3' }),
    };

    const emails = [
      { to: 'a@t.com', userId: 'u1', classInfo: buildClassInfo(), type: 'seat_available' as const },
      { to: 'b@t.com', userId: 'u2', classInfo: buildClassInfo(), type: 'seat_available' as const },
      { to: 'c@t.com', userId: 'u3', classInfo: buildClassInfo(), type: 'seat_available' as const },
    ];

    const results = await sendBatchEmailsOptimized(emails, sendEmail as unknown as SendEmail);

    expect(results).toHaveLength(3);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[1].error).toContain('E_RATE_LIMIT_EXCEEDED');
    expect(results[2].success).toBe(false);
    expect(results[2].error).toContain('Skipped');
    expect(sendEmail.send).toHaveBeenCalledTimes(2); // Third never called
  });

  it('includes List-Unsubscribe headers in each email', async () => {
    const sendEmail = createMockSendEmail();
    const emails = [
      {
        to: 'user@test.com',
        userId: 'u99',
        classInfo: buildClassInfo(),
        type: 'seat_available' as const,
      },
    ];

    await sendBatchEmailsOptimized(emails, sendEmail as unknown as SendEmail);

    expect(sendEmail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: {
          'List-Unsubscribe': '<https://pickmyclass.app/unsub?u=u99>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      })
    );
  });

  it('includes plain-text fallback alongside HTML', async () => {
    const sendEmail = createMockSendEmail();
    const emails = [
      {
        to: 'user@test.com',
        userId: 'u1',
        classInfo: buildClassInfo(),
        type: 'seat_available' as const,
      },
    ];

    await sendBatchEmailsOptimized(emails, sendEmail as unknown as SendEmail);

    expect(sendEmail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('html'),
        text: expect.any(String),
      })
    );
    // text should be the HTML stripped of tags — mock returns '<html>seat</html>'
    const callArgs = sendEmail.send.mock.calls[0][0];
    expect(callArgs.text).toBeTruthy();
    expect(callArgs.text).not.toContain('<');
  });
});
