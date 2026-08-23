import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE,
  EMAIL_BATCH_DELAY_MS,
  EMAIL_BATCH_SIZE,
  NOTIFICATION_FROM_EMAIL,
} from '@/lib/config';
import type { SendEmail } from '@/lib/types/env';
vi.mock('@/lib/email/unsubscribe-token', () => ({
  generateUnsubscribeUrl: vi.fn(
    (userId: string) => `https://pickmyclass.app/unsubscribe?token=${userId}`
  ),
  generateUnsubscribeToken: vi.fn(() => 'mock-token'),
  verifyUnsubscribeToken: vi.fn(() => null),
}));

import {
  buildAutoCleanupRemovedEmail,
  sendAutoCleanupRemovalEmails,
} from '@/lib/email/templates/auto-cleanup';

describe('buildAutoCleanupRemovedEmail', () => {
  const originalEnv = process.env.NEXT_PUBLIC_SITE_URL;

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalEnv === undefined)
      delete (process.env as Record<string, string | undefined>).NEXT_PUBLIC_SITE_URL;
    else (process.env as Record<string, string | undefined>).NEXT_PUBLIC_SITE_URL = originalEnv;
  });

  it('escapes HTML in subject, term, title and includes dashboard link', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://pickmyclass.app';

    const email = buildAutoCleanupRemovedEmail({
      classNbr: '42737<script>',
      term: '2261<script>',
      subject: 'CSE<script>',
      catalogNbr: '110',
      title: 'Intro <b>Programming</b> & More',
    });

    // subject uses rawIdentifier fallback (catalogNbr || classNbr) stripped of <>"'& — verify fallback and not escaped HTML injection
    expect(email.subject).toContain('110');
    expect(email.subject).not.toContain('<script>');

    // html should be escaped
    expect(email.html).toContain('CSE&lt;script&gt;');
    expect(email.html).toContain('Intro &lt;b&gt;Programming&lt;/b&gt; &amp; More');
    expect(email.html).toContain('42737&lt;script&gt;');
    expect(email.html).toContain('2261&lt;script&gt;');
    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toContain('<b>');

    // dashboard link present and escaped
    expect(email.html).toContain('https://pickmyclass.app/dashboard');
    expect(email.html).toContain('Go to Dashboard');
    expect(email.text).toContain('https://pickmyclass.app/dashboard');
  });

  it('includes dashboard link with default site URL when env not set', () => {
    delete (process.env as Record<string, string | undefined>).NEXT_PUBLIC_SITE_URL;

    const email = buildAutoCleanupRemovedEmail({
      classNbr: '42737',
      term: '2261',
      subject: 'CSE',
      catalogNbr: '110',
      title: null,
    });

    expect(email.html).toContain('https://pickmyclass.app/dashboard');
    expect(email.text).toContain('https://pickmyclass.app/dashboard');
  });

  it('subject falls back to classNbr when catalogNbr absent, and strips risky chars', () => {
    const withCatalog = buildAutoCleanupRemovedEmail({
      classNbr: '42737',
      term: '2261',
      subject: null,
      catalogNbr: '110',
      title: null,
    });
    expect(withCatalog.subject).toBe('Watched class 110 removed — no longer in ASU catalog');

    const withoutCatalog = buildAutoCleanupRemovedEmail({
      classNbr: '42737<bad>',
      term: '2261',
      subject: null,
      catalogNbr: null,
      title: null,
    });
    // classNbr fallback should strip < > etc
    expect(withoutCatalog.subject).toBe(
      'Watched class 42737bad removed — no longer in ASU catalog'
    );
    expect(withoutCatalog.subject).not.toContain('<');
  });

  it('subject strips quotes and ampersands from identifier', () => {
    const email = buildAutoCleanupRemovedEmail({
      classNbr: '12"34&56',
      term: '2261',
      subject: null,
      catalogNbr: '12"34&56',
      title: null,
    });
    expect(email.subject).toBe('Watched class 123456 removed — no longer in ASU catalog');
  });

  it('text fallback includes term, section, title when present and omits title line when absent', () => {
    const withTitle = buildAutoCleanupRemovedEmail({
      classNbr: '42737',
      term: '2261',
      subject: 'CSE',
      catalogNbr: '110',
      title: 'Principles',
    });
    expect(withTitle.text).toContain('Section: 42737');
    expect(withTitle.text).toContain('Term: 2261');
    expect(withTitle.text).toContain('Title: Principles');
    expect(withTitle.text).toContain('CSE 110: Principles');

    const withoutTitle = buildAutoCleanupRemovedEmail({
      classNbr: '42737',
      term: '2261',
      subject: 'CSE',
      catalogNbr: '110',
      title: null,
    });
    expect(withoutTitle.text).not.toContain('Title:');
    expect(withoutTitle.html).not.toContain('<strong>Title:</strong>');
  });

  it('includes unsubscribe URL in footer when provided', () => {
    const email = buildAutoCleanupRemovedEmail({
      classNbr: '42737',
      term: '2261',
      subject: 'CSE',
      catalogNbr: '110',
      title: 'T',
      unsubscribeUrl: 'https://pickmyclass.app/unsubscribe?token=abc',
    });
    expect(email.html).toContain('https://pickmyclass.app/unsubscribe?token=abc');
    expect(email.text).toContain('Unsubscribe: https://pickmyclass.app/unsubscribe?token=abc');
  });

  it('escapes the unsubscribe URL in the HTML footer', () => {
    const email = buildAutoCleanupRemovedEmail({
      classNbr: '42737',
      term: '2261',
      subject: 'CSE',
      catalogNbr: '110',
      title: null,
      unsubscribeUrl: 'https://pickmyclass.app/unsubscribe?token=<bad>&q="x"',
    });

    expect(email.html).toContain('token=&lt;bad&gt;&amp;q=&quot;x&quot;');
    expect(email.html).not.toContain('<bad>');
  });

  it('omits unsubscribe link when not provided', () => {
    const email = buildAutoCleanupRemovedEmail({
      classNbr: '42737',
      term: '2261',
      subject: 'CSE',
      catalogNbr: '110',
      title: 'T',
    });
    expect(email.html).not.toContain('Unsubscribe</a>');
    expect(email.text).not.toContain('Unsubscribe:');
  });

  it('handles trailing slash in site URL for dashboard link', () => {
    // eslint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- SAFETY: test mutates process.env for site URL branching
    (process.env as Record<string, string | undefined>).NEXT_PUBLIC_SITE_URL =
      // eslint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- SAFETY: string literal for env, narrow to string for assignment
      'https://pickmyclass.app///' as string;
    const email = buildAutoCleanupRemovedEmail({
      classNbr: '42737',
      term: '2261',
      subject: null,
      catalogNbr: null,
      title: null,
    });
    expect(email.html).toContain('https://pickmyclass.app/dashboard');
    expect(email.html).not.toContain('///dashboard');
  });
});

describe('sendAutoCleanupRemovalEmails', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defensively caps watchers at AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE and logs warn', async () => {
    const cap = AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE;
    const overCap = cap + 10;
    const watchers = Array.from({ length: overCap }, (_, i) => ({
      user_id: `u${i}`,
      email: `user${i}@example.com`,
      watch_id: `w${i}`,
    }));

    const sendMock = vi.fn().mockResolvedValue({ messageId: 'msg' });
    // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test double for EMAIL binding; minimal shape exposes only send()
    const emailBinding = { send: sendMock } as unknown as SendEmail;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(globalThis, 'setTimeout')
      // eslint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: test mock — setTimeout overload narrowed to callback+delay used by batch throttle
      .mockImplementation((cb: () => void) => {
        cb();
        // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test double returns Timeout shape for batch throttle; only used for immediate resolve in cap test
        return {} as unknown as ReturnType<typeof setTimeout>;
      });

    const results = await sendAutoCleanupRemovalEmails(
      {
        ref: { class_nbr: '42737', term: '2261' },
        classInfo: { subject: 'CSE', catalog_nbr: '110', title: 'Intro' },
        watchers,
      },
      emailBinding
    );

    expect(sendMock).toHaveBeenCalledTimes(cap);
    expect(results).toHaveLength(cap);
    // exact cap ownership: results map one-to-one onto the first-cap watchers, in order
    expect(results.map((r) => r.watchId)).toEqual(watchers.slice(0, cap).map((w) => w.watch_id));
    expect(results.every((r) => r.success)).toBe(true);
    // every capped result maps onto a real send attempt
    expect(results.every((r) => r.attempted)).toBe(true);
    expect(results.filter((r) => r.attempted)).toHaveLength(cap);
    expect(results.filter((r) => r.attempted).length).toBe(sendMock.mock.calls.length);
    // identity: first watcher was emailed
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ to: watchers[0].email }));
    // w501 (first truncated) not attempted — inequality of truncated vs deleted set
    expect(sendMock).not.toHaveBeenCalledWith(expect.objectContaining({ to: watchers[cap].email }));
    // also ensure the last truncated entry not sent
    // eslint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- SAFETY: mock call narrow to {to:string} for sentEmails extraction
    const sentEmails = sendMock.mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(sentEmails).not.toContain(watchers[cap].email);
    expect(sentEmails).toContain(watchers[0].email);
    expect(sentEmails).toContain(watchers[cap - 1].email);
    // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: console.warn mock narrowing requires ReturnType wrapper
    const warnCalls = (console.warn as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => String(c[0]) + ' ' + String(c[1] ?? '')
    );
    expect(warnCalls.some((s) => s.includes('exceeds cap') && s.includes('truncating'))).toBe(true);
  });

  it('sends all watchers when under cap without truncation', async () => {
    const watchers = [
      { user_id: 'u1', email: 'a@example.com', watch_id: 'w1' },
      { user_id: 'u2', email: 'b@example.com', watch_id: 'w2' },
    ];
    const sendMock = vi.fn().mockResolvedValue({ messageId: 'msg' });
    // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test double for EMAIL binding; minimal shape exposes only send()
    const emailBinding = { send: sendMock } as unknown as SendEmail;
    const results = await sendAutoCleanupRemovalEmails(
      {
        ref: { class_nbr: '42737', term: '2261' },
        classInfo: null,
        watchers,
      },
      emailBinding
    );

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.attempted)).toBe(true);
    // attempted count mirrors actual send invocations
    expect(results.filter((r) => r.attempted).length).toBe(sendMock.mock.calls.length);
  });

  it('returns empty when no watchers', async () => {
    const sendMock = vi.fn().mockResolvedValue({ messageId: 'msg' });
    // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test double for EMAIL binding; minimal shape exposes only send()
    const emailBinding = { send: sendMock } as unknown as SendEmail;
    const results = await sendAutoCleanupRemovalEmails(
      {
        ref: { class_nbr: '42737', term: '2261' },
        classInfo: null,
        watchers: [],
      },
      emailBinding
    );

    expect(sendMock).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it.each([
    ['E_RATE_LIMIT_EXCEEDED', 'rate limited'],
    ['E_DAILY_LIMIT_EXCEEDED', 'daily limit hit'],
    ['E_SENDER_NOT_VERIFIED', 'sender not verified'],
  ])('aborts remaining sends and marks them skipped on %s', async (fatalCode, message) => {
    const watchers = [
      { user_id: 'u1', email: 'a@example.com', watch_id: 'w1' },
      { user_id: 'u2', email: 'b@example.com', watch_id: 'w2' },
      { user_id: 'u3', email: 'c@example.com', watch_id: 'w3' },
    ];
    const sendMock = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error(message), { code: fatalCode }));
    // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test double for EMAIL binding; minimal shape exposes only send()
    const emailBinding = { send: sendMock } as unknown as SendEmail;

    const results = await sendAutoCleanupRemovalEmails(
      {
        ref: { class_nbr: '42737', term: '2261' },
        classInfo: null,
        watchers,
      },
      emailBinding
    );

    // fatal provider error stops further attempts at the failing watcher
    expect(sendMock).toHaveBeenCalledTimes(1);
    // exactly one real attempt; remainder rows are synthetic skips, not attempts
    expect(results).toEqual([
      { success: false, watchId: 'w1', error: `${fatalCode}: ${message}`, attempted: true },
      {
        success: false,
        watchId: 'w2',
        error: `Skipped: ${fatalCode} limit reached`,
        attempted: false,
      },
      {
        success: false,
        watchId: 'w3',
        error: `Skipped: ${fatalCode} limit reached`,
        attempted: false,
      },
    ]);
    // attempted count tracks actual send invocations, not result-row length
    const attemptedRows = results.filter((r) => r.attempted);
    expect(attemptedRows.map((r) => r.watchId)).toEqual(['w1']);
    expect(attemptedRows.length).toBe(sendMock.mock.calls.length);
    expect(attemptedRows.every((r) => !r.success)).toBe(true);
  });

  it('continues sending after a non-fatal failure and reports truthful per-results', async () => {
    const watchers = [
      { user_id: 'u1', email: 'a@example.com', watch_id: 'w1' },
      { user_id: 'u2', email: 'b@example.com', watch_id: 'w2' },
      { user_id: 'u3', email: 'c@example.com', watch_id: 'w3' },
    ];
    const sendMock = vi
      .fn()
      .mockResolvedValueOnce({ messageId: 'm1' })
      .mockRejectedValueOnce(
        Object.assign(new Error('smtp hiccup'), { code: 'E_CONNECTION_CLOSED' })
      )
      .mockResolvedValueOnce({ messageId: 'm3' });
    // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test double for EMAIL binding; minimal shape exposes only send()
    const emailBinding = { send: sendMock } as unknown as SendEmail;

    const results = await sendAutoCleanupRemovalEmails(
      {
        ref: { class_nbr: '42737', term: '2261' },
        classInfo: null,
        watchers,
      },
      emailBinding
    );

    // non-fatal codes do not abort: every watcher attempted exactly once
    expect(sendMock).toHaveBeenCalledTimes(3);
    expect(results).toEqual([
      { success: true, watchId: 'w1', attempted: true },
      { success: false, watchId: 'w2', error: 'E_CONNECTION_CLOSED: smtp hiccup', attempted: true },
      { success: true, watchId: 'w3', attempted: true },
    ]);
    // every result corresponds to a real send invocation
    const attemptedRows = results.filter((r) => r.attempted);
    expect(attemptedRows.map((r) => r.watchId)).toEqual(['w1', 'w2', 'w3']);
    expect(attemptedRows.length).toBe(sendMock.mock.calls.length);
  });

  it('attaches per-watcher one-click unsubscribe headers and honors fromEmail override', async () => {
    const watchers = [
      { user_id: 'user-42', email: 'a@example.com', watch_id: 'w1' },
      { user_id: 'user-43', email: 'b@example.com', watch_id: 'w2' },
    ];
    const sendMock = vi.fn().mockResolvedValue({ messageId: 'msg' });
    // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test double for EMAIL binding; minimal shape exposes only send()
    const emailBinding = { send: sendMock } as unknown as SendEmail;

    await sendAutoCleanupRemovalEmails(
      {
        ref: { class_nbr: '42737', term: '2261' },
        classInfo: null,
        watchers,
      },
      emailBinding,
      'custom@pickmyclass.app'
    );

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'a@example.com',
        from: 'custom@pickmyclass.app',
        headers: {
          'List-Unsubscribe': '<https://pickmyclass.app/unsubscribe?token=user-42>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      })
    );
    // second watcher got its own unsubscribe URL in body and headers
    // eslint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- SAFETY: mock call narrowed to sent payload shape for unsubscribe inspection
    const secondPayload = sendMock.mock.calls[1][0] as { html: string; text: string };
    expect(secondPayload.html).toContain('unsubscribe?token=user-43');
    expect(secondPayload.text).toContain(
      'Unsubscribe: https://pickmyclass.app/unsubscribe?token=user-43'
    );
    expect(sendMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        headers: {
          'List-Unsubscribe': '<https://pickmyclass.app/unsubscribe?token=user-43>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      })
    );

    // without an override the sender falls back to NOTIFICATION_FROM_EMAIL
    const defaultSend = vi.fn().mockResolvedValue({ messageId: 'msg' });
    // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test double for EMAIL binding
    const defaultBinding = { send: defaultSend } as unknown as SendEmail;
    await sendAutoCleanupRemovalEmails(
      {
        ref: { class_nbr: '42737', term: '2261' },
        classInfo: null,
        watchers: [watchers[0]],
      },
      defaultBinding
    );
    expect(defaultSend).toHaveBeenCalledWith(
      expect.objectContaining({ from: NOTIFICATION_FROM_EMAIL })
    );
  });

  it('throttles once between batches when watcher count exceeds EMAIL_BATCH_SIZE', async () => {
    const watchers = Array.from({ length: EMAIL_BATCH_SIZE + 1 }, (_, i) => ({
      user_id: `u${i}`,
      email: `user${i}@example.com`,
      watch_id: `w${i}`,
    }));
    const sendMock = vi.fn().mockResolvedValue({ messageId: 'msg' });
    // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test double for EMAIL binding; minimal shape exposes only send()
    const emailBinding = { send: sendMock } as unknown as SendEmail;
    const timeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      // eslint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: test mock — setTimeout overload narrowed to callback+delay used by batch throttle
      .mockImplementation((cb: () => void) => {
        cb();
        // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test double returns Timeout shape for batch throttle
        return {} as unknown as ReturnType<typeof setTimeout>;
      });

    const results = await sendAutoCleanupRemovalEmails(
      {
        ref: { class_nbr: '42737', term: '2261' },
        classInfo: null,
        watchers,
      },
      emailBinding
    );

    expect(results.every((r) => r.success)).toBe(true);
    // single batch boundary crossed: after email 10 of 11, delay uses configured value
    expect(timeoutSpy).toHaveBeenCalledTimes(1);
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), EMAIL_BATCH_DELAY_MS);
  });
});
