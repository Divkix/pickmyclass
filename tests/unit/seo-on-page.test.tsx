import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';
import { metadata as aboutMetadata } from '@/app/about/page';
import { metadata as blogMetadata } from '@/app/blog/page';
import { metadata as faqMetadata } from '@/app/faq/page';
import { metadata as rootMetadata } from '@/app/layout';
import { metadata as homeMetadata } from '@/app/page';
import sitemap from '@/app/sitemap';
import { SkipToContent } from '@/components/SkipToContent';
import { blogPosts } from '@/lib/blog/posts';

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
    expect(homeMetadata.openGraph?.url).toBe('https://pickmyclass.app/');
    expect(homeMetadata.openGraph?.title).toMatch(/PickMyClass — Free ASU Class Seat Tracker/);
    expect(homeMetadata.twitter?.title).toMatch(/PickMyClass — Free ASU Class Seat Tracker/);
  });

  it('sets faq og:url to the faq page, not the homepage', () => {
    expect(faqMetadata.openGraph?.url).toBe('https://pickmyclass.app/faq');
    expect(faqMetadata.openGraph?.title).toMatch(/Frequently Asked Questions/);
    expect(faqMetadata.twitter?.title).toMatch(/Frequently Asked Questions/);
  });

  it('sets about twitter:title to the about page title', () => {
    expect(aboutMetadata.openGraph?.url).toBe('https://pickmyclass.app/about');
    expect(aboutMetadata.twitter?.title).toMatch(/About PickMyClass/);
    expect(aboutMetadata.twitter?.title).not.toMatch(/Free ASU Class Seat Tracker/);
  });

  it('keeps the blog index og and twitter titles page-specific', () => {
    expect(blogMetadata.openGraph?.url).toBe('https://pickmyclass.app/blog');
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
      'https://pickmyclass.app/legal',
    ]) {
      expect(byUrl.get(url)).toBeDefined();
    }

    for (const post of blogPosts) {
      expect(byUrl.get(`https://pickmyclass.app/blog/${post.slug}`)).toBeDefined();
    }
  });
});
