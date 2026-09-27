import { describe, expect, it } from 'vite-plus/test';
import sitemap from '@/app/sitemap';
import { blogPosts } from '@/lib/blog/posts';
import { PUBLIC_PAGES, absoluteUrl } from '@/lib/seo/public-pages';
import lastmod from '@/lib/seo/static-page-lastmod.json';

describe('PUBLIC_PAGES', () => {
  it('has a lastmod date for every page except the blog index, and no orphan dates', () => {
    const datedPaths = PUBLIC_PAGES.map((page) => page.path).filter((path) => path !== '/blog');

    expect(Object.keys(lastmod).sort()).toEqual([...datedPaths].sort());
  });

  it('puts every public page and blog post in the sitemap exactly once', async () => {
    const urls = (await sitemap()).map((entry) => entry.url);

    expect(urls).toEqual([
      ...PUBLIC_PAGES.map((page) => absoluteUrl(page.path)),
      ...blogPosts.map((post) => absoluteUrl(`/blog/${post.slug}`)),
    ]);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('gives every sitemap entry a valid lastModified date', async () => {
    for (const entry of await sitemap()) {
      expect(entry.lastModified).toBeInstanceOf(Date);
      expect(String(entry.lastModified)).not.toBe('Invalid Date');
    }
  });
});
