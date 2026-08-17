import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { buildAutoCleanupRemovedEmail } from '@/lib/email/templates/auto-cleanup';

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
