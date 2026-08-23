import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { InstructorAssignedEmailTemplate, SeatAvailableEmailTemplate } from '@/lib/email/templates';
import type { ClassInfo } from '@/lib/types/class';
import { buildAutoCleanupRemovedEmail } from '@/lib/email/templates/auto-cleanup';
import { getEmailFooter } from '@/lib/email/templates/footer';

const classInfo: ClassInfo = {
  term: '2261<script>',
  subject: 'CSE',
  catalog_nbr: '240',
  title: 'Intro <script>alert("x")</script>',
  class_nbr: '12x345',
  instructor_name: 'Dr. Smith & Co.',
  seats_available: 1,
  seats_capacity: 40,
  location: 'Tempe <Main>',
  meeting_times: 'MWF 9:00',
};

describe('notification email templates', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders sanitized seat-available emails with one-click unsubscribe links', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://test.pickmyclass.app');

    const html = SeatAvailableEmailTemplate(
      classInfo,
      'https://pickmyclass.app/unsubscribe?token=<bad>&next="x"'
    );

    expect(html).toContain('Seat Available');
    expect(html).toContain('1 open seat available');
    expect(html).toContain('Intro &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('Dr. Smith &amp; Co.');
    expect(html).toContain('Tempe &lt;Main&gt;');
    expect(html).toContain('/go/asu?classNbr=12345&term=2261');
    expect(html).toContain('token=&lt;bad&gt;&amp;next=&quot;x&quot;');
  });

  it('renders plural seat copy and omits optional class fields when absent', () => {
    const html = SeatAvailableEmailTemplate({
      ...classInfo,
      seats_available: 3,
      location: undefined,
      meeting_times: undefined,
    });

    expect(html).toContain('3 open seats available');
    expect(html).not.toContain('<strong>Location:</strong>');
    expect(html).not.toContain('<strong>Meeting Times:</strong>');
    expect(html).not.toContain('Unsubscribe</a>');
  });

  it('renders instructor-assigned emails with availability color branches', () => {
    const availableHtml = InstructorAssignedEmailTemplate(classInfo, 'https://pickmyclass.app/u');
    const fullHtml = InstructorAssignedEmailTemplate({
      ...classInfo,
      seats_available: 0,
      location: undefined,
      meeting_times: undefined,
    });

    expect(availableHtml).toContain('Instructor Assigned');
    expect(availableHtml).toContain('color: #10B981');
    expect(availableHtml).toContain('Instructor: Dr. Smith &amp; Co.');
    expect(fullHtml).toContain('color: #dc2626');
    expect(fullHtml).toContain('0 of 40 seats available');
  });
});

describe('getEmailFooter (shared)', () => {
  it('escapes unsubscribe URLs to prevent XSS in query params', () => {
    const footer = getEmailFooter('https://pickmyclass.app/unsubscribe?token=<bad>&next="x"');

    expect(footer).toContain(
      'href="https://pickmyclass.app/unsubscribe?token=&lt;bad&gt;&amp;next=&quot;x&quot;"'
    );
    expect(footer).not.toContain('<bad>');
    expect(footer).not.toContain('"x"');
    expect(footer).toContain('Unsubscribe</a>');
    expect(footer).toContain("Don't want these emails?");
  });

  it('omits the unsubscribe link when no URL is provided', () => {
    const footer = getEmailFooter();

    expect(footer).not.toContain('Unsubscribe</a>');
    expect(footer).toContain(
      "You're receiving this email because you're watching this class on PickMyClass."
    );
    expect(footer).toContain('This is an automated notification sent by PickMyClass.');
  });

  it('renders byte-identical footers across notification and auto-cleanup templates', () => {
    const url = 'https://pickmyclass.app/unsubscribe?token=tok';
    const footer = getEmailFooter(url);

    const seatHtml = SeatAvailableEmailTemplate(classInfo, url);
    const removalHtml = buildAutoCleanupRemovedEmail({
      classNbr: '42737',
      term: '2261',
      subject: 'CSE',
      catalogNbr: '110',
      title: 'T',
      unsubscribeUrl: url,
    }).html;

    // split length 2 == footer embedded exactly once in each template
    expect(seatHtml.split(footer)).toHaveLength(2);
    expect(removalHtml.split(footer)).toHaveLength(2);
  });
});
