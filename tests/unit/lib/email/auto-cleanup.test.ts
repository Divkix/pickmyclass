import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE } from '@/lib/config';
import type { SendEmail } from '@/lib/types/env';
vi.mock('@/lib/email/unsubscribe-token', () => ({
  generateUnsubscribeUrl: vi.fn((userId: string) => `https://pickmyclass.app/unsubscribe?token=${userId}`),
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
    (process.env as Record<string, string | undefined>).NEXT_PUBLIC_SITE_URL =
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
    const emailBinding = { send: sendMock } as unknown as SendEmail;

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(globalThis, 'setTimeout')
      // eslint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: test mock — setTimeout overload narrowed to callback+delay used by batch throttle
      .mockImplementation((cb: () => void) => {
        cb();
        // SAFETY: test double returns Timeout shape for batch throttle; only used for immediate resolve in cap test
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
    expect(results.every((r) => r.success)).toBe(true);
    // identity: first watcher was emailed
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ to: watchers[0].email }));
    // w501 (first truncated) not attempted — inequality of truncated vs deleted set
    expect(sendMock).not.toHaveBeenCalledWith(expect.objectContaining({ to: watchers[cap].email }));
    // also ensure the last truncated entry not sent
    const sentEmails = sendMock.mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(sentEmails).not.toContain(watchers[cap].email);
    expect(sentEmails).toContain(watchers[0].email);
    expect(sentEmails).toContain(watchers[cap - 1].email);
    const warnCalls = (console.warn as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]) + ' ' + String(c[1] ?? ''));
    expect(warnCalls.some((s) => s.includes('exceeds cap') && s.includes('truncating'))).toBe(true);
  });

  it('sends all watchers when under cap without truncation', async () => {
    const watchers = [
      { user_id: 'u1', email: 'a@example.com', watch_id: 'w1' },
      { user_id: 'u2', email: 'b@example.com', watch_id: 'w2' },
    ];
    const sendMock = vi.fn().mockResolvedValue({ messageId: 'msg' });
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
  });

  it('returns empty when no watchers', async () => {
    const sendMock = vi.fn().mockResolvedValue({ messageId: 'msg' });
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
});
