import { render, screen } from '@testing-library/react';
import type { Metadata } from 'next';
import { describe, expect, it } from 'vite-plus/test';
import { z } from 'zod';
import { metadata as aboutMetadata } from '@/app/about/page';
import { metadata as asuClassSearchMetadata } from '@/app/blog/asu-class-search/page';
import { metadata as asuClassSeatTrackerMetadata } from '@/app/blog/asu-class-seat-tracker/page';
import { metadata as asuRegistrationTipsMetadata } from '@/app/blog/asu-registration-tips/page';
import { metadata as asuTransferRegistrationMetadata } from '@/app/blog/asu-transfer-registration/page';
import { metadata as asuWaitlistGuideMetadata } from '@/app/blog/asu-waitlist-guide/page';
import { metadata as bestSeatTrackerMetadata } from '@/app/blog/best-asu-class-seat-tracker/page';
import { metadata as fullClassesMetadata } from '@/app/blog/how-to-get-into-full-asu-classes/page';
import { metadata as howToRegisterMetadata } from '@/app/blog/how-to-register-for-classes-at-asu/page';
import { metadata as blogLayoutMetadata } from '@/app/blog/layout';
import { metadata as myasuSearchTipsMetadata } from '@/app/blog/myasu-search-tips/page';
import { metadata as blogMetadata } from '@/app/blog/page';
import { metadata as contactMetadata } from '@/app/contact/page';
import { metadata as docsMetadata } from '@/app/docs/page';
import { metadata as faqMetadata } from '@/app/faq/page';
import { metadata as rootMetadata } from '@/app/layout';
import { metadata as privacyMetadata } from '@/app/legal/privacy/page';
import { metadata as termsMetadata } from '@/app/legal/terms/page';
import { metadata as homeMetadata } from '@/app/page';
import sitemap from '@/app/sitemap';
import { SkipToContent } from '@/components/SkipToContent';
import { blogPosts } from '@/lib/blog/posts';
import { DEFAULT_SITE_URL } from '@/lib/config';

const siteBase = new URL(rootMetadata.metadataBase ?? DEFAULT_SITE_URL);

function resolveMetadataUrl(value: string | URL | null | undefined): string | undefined {
  if (!value) return undefined;
  const resolved = new URL(value, siteBase);

  return resolved.pathname === '/' && resolved.search === '' && resolved.hash === ''
    ? resolved.origin
    : resolved.href;
}

describe('SkipToContent', () => {
  it('points at the main landmark', () => {
    render(<SkipToContent />);

    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
  });
});

describe('per-route open graph and twitter', () => {
  it('does not put homepage title or url on the root layout defaults', () => {
    expect(rootMetadata.openGraph).not.toHaveProperty('url');
    expect(rootMetadata.openGraph).not.toHaveProperty('title');
    expect(rootMetadata.openGraph).not.toHaveProperty('description');
    expect(rootMetadata.twitter).not.toHaveProperty('title');
    expect(rootMetadata.twitter).not.toHaveProperty('description');
  });

  it('keeps homepage og:url and twitter:title on the home route', () => {
    expect(resolveMetadataUrl(homeMetadata.openGraph?.url)).toBe('https://pickmyclass.app');
    expect(homeMetadata.alternates?.canonical).toBe(homeMetadata.openGraph?.url);
    expect(homeMetadata.openGraph?.title).toMatch(/PickMyClass — Free ASU Class Seat Tracker/);
    expect(homeMetadata.twitter?.title).toMatch(/PickMyClass — Free ASU Class Seat Tracker/);
  });

  it('sets faq og:url to the faq page, not the homepage', () => {
    expect(resolveMetadataUrl(faqMetadata.openGraph?.url)).toBe('https://pickmyclass.app/faq');
    expect(faqMetadata.alternates?.canonical).toBe(faqMetadata.openGraph?.url);
    expect(faqMetadata.openGraph?.title).toMatch(/Frequently Asked Questions/);
    expect(faqMetadata.twitter?.title).toMatch(/Frequently Asked Questions/);
  });

  it('sets about twitter:title to the about page title', () => {
    expect(resolveMetadataUrl(aboutMetadata.openGraph?.url)).toBe('https://pickmyclass.app/about');
    expect(aboutMetadata.alternates?.canonical).toBe(aboutMetadata.openGraph?.url);
    expect(aboutMetadata.twitter?.title).toMatch(/About PickMyClass/);
    expect(aboutMetadata.twitter?.title).not.toMatch(/Free ASU Class Seat Tracker/);
  });

  it('keeps the blog index og and twitter titles page-specific', () => {
    expect(resolveMetadataUrl(blogMetadata.openGraph?.url)).toBe('https://pickmyclass.app/blog');
    expect(blogMetadata.alternates?.canonical).toBe(blogMetadata.openGraph?.url);
    expect(blogMetadata.twitter?.title).toMatch(/ASU Registration Tips/);
  });
});

describe('sitemap lastmod', () => {
  it('emits a lastmod per URL instead of one shared stamp', async () => {
    const entries = await sitemap();

    const lastMods = entries.map((entry) => {
      const value = entry.lastModified;

      return value instanceof Date ? value.toISOString() : String(value);
    });

    expect(new Set(lastMods).size).toBeGreaterThan(1);

    const byUrl = new Map(entries.map((entry) => [entry.url, entry.lastModified]));

    for (const url of [
      'https://pickmyclass.app/blog/asu-class-seat-tracker',
      'https://pickmyclass.app/blog/asu-waitlist-guide',
      'https://pickmyclass.app/faq',
      'https://pickmyclass.app/legal/privacy',
    ]) {
      expect(byUrl.get(url)).toBeDefined();
    }

    expect(byUrl.has('https://pickmyclass.app/legal')).toBe(false);

    for (const post of blogPosts) {
      expect(byUrl.get(`https://pickmyclass.app/blog/${post.slug}`)).toBeDefined();
    }
  });
});

const layoutTitle = z.looseObject({ template: z.string() });

// Mirrors Next's resolution: a plain string goes through the nearest layout template,
// `absolute` bypasses it.
const pageTitle = z.union([
  z.string().transform((title) => ({ title, absolute: false })),
  z.looseObject({ absolute: z.string() }).transform(({ absolute }) => ({
    title: absolute,
    absolute: true,
  })),
]);

function renderedTitle(metadata: Metadata, template: string): string {
  const { title, absolute } = pageTitle.parse(metadata.title);

  return absolute ? title : template.replace('%s', title);
}

describe('search snippet lengths', () => {
  const rootTemplate = layoutTitle.parse(rootMetadata.title).template;
  const blogTemplate = layoutTitle.parse(blogLayoutMetadata.title).template;

  it.each([
    { path: '/', metadata: homeMetadata, template: rootTemplate },
    { path: '/about', metadata: aboutMetadata, template: rootTemplate },
    { path: '/contact', metadata: contactMetadata, template: rootTemplate },
    { path: '/docs', metadata: docsMetadata, template: rootTemplate },
    { path: '/faq', metadata: faqMetadata, template: rootTemplate },
    { path: '/legal/privacy', metadata: privacyMetadata, template: rootTemplate },
    { path: '/legal/terms', metadata: termsMetadata, template: rootTemplate },
    { path: '/blog', metadata: blogMetadata, template: blogTemplate },
    { path: '/blog/asu-class-search', metadata: asuClassSearchMetadata, template: blogTemplate },
    {
      path: '/blog/asu-class-seat-tracker',
      metadata: asuClassSeatTrackerMetadata,
      template: blogTemplate,
    },
    {
      path: '/blog/asu-registration-tips',
      metadata: asuRegistrationTipsMetadata,
      template: blogTemplate,
    },
    {
      path: '/blog/asu-transfer-registration',
      metadata: asuTransferRegistrationMetadata,
      template: blogTemplate,
    },
    {
      path: '/blog/asu-waitlist-guide',
      metadata: asuWaitlistGuideMetadata,
      template: blogTemplate,
    },
    {
      path: '/blog/best-asu-class-seat-tracker',
      metadata: bestSeatTrackerMetadata,
      template: blogTemplate,
    },
    {
      path: '/blog/how-to-get-into-full-asu-classes',
      metadata: fullClassesMetadata,
      template: blogTemplate,
    },
    {
      path: '/blog/how-to-register-for-classes-at-asu',
      metadata: howToRegisterMetadata,
      template: blogTemplate,
    },
    { path: '/blog/myasu-search-tips', metadata: myasuSearchTipsMetadata, template: blogTemplate },
  ])('keeps $path title <= 60 and description <= 160 chars', ({ metadata, template }) => {
    expect(renderedTitle(metadata, template).length).toBeLessThanOrEqual(60);
    expect(metadata.description?.length ?? 0).toBeGreaterThan(0);
    expect(metadata.description?.length ?? 0).toBeLessThanOrEqual(160);
  });
});
