import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { GET as getLlmsFull } from '@/app/llms-full.txt/route';
import { blogPosts } from '@/lib/blog/posts';
import { CURATED_GUIDE_SLUGS, buildLlmsFullTxt } from '@/lib/seo/llms-full';
import { PUBLIC_PAGES, absoluteUrl } from '@/lib/seo/public-pages';

const root = process.cwd();

function readPublicFile(fileName: string): string {
  const filePath = join(root, 'public', fileName);
  expect(existsSync(filePath), `${fileName} should be published from public/`).toBe(true);

  return readFileSync(filePath, 'utf8');
}

describe('production SEO and AI discovery assets', () => {
  it('publishes llms.txt with high-intent ASU class tracking answers', () => {
    const llms = readPublicFile('llms.txt');

    for (const text of [
      '# PickMyClass',
      'ASU class seat tracker',
      'pickmyclass',
      'pick my class',
      'ASU class tracker',
      'ASU class finder',
      'ASU class registration',
      'My ASU',
      'https://pickmyclass.app/',
      'https://pickmyclass.app/faq',
      'https://pickmyclass.app/blog/asu-class-seat-tracker',
    ]) {
      expect(llms).toContain(text);
    }
  });

  it('generates llms-full.txt with every public guide and public crawl target', () => {
    const full = buildLlmsFullTxt();

    expect(full.startsWith('# PickMyClass Full AI Search Reference\n')).toBe(true);
    expect(full).not.toContain('undefined');

    for (const post of blogPosts) {
      expect(full).toContain(`URL: https://pickmyclass.app/blog/${post.slug}`);
      expect(full).toContain(`### ${post.title}`);
    }

    for (const page of PUBLIC_PAGES) {
      expect(full).toContain(`- ${page.label}: ${absoluteUrl(page.path)}\n`);
    }
  });

  it('only curates llms-full.txt summaries for published posts, each once', () => {
    const slugs = new Set(blogPosts.map((post) => post.slug));

    for (const slug of CURATED_GUIDE_SLUGS) expect(slugs.has(slug)).toBe(true);

    expect(new Set(CURATED_GUIDE_SLUGS).size).toBe(CURATED_GUIDE_SLUGS.length);
  });

  it('serves /llms-full.txt as cacheable UTF-8 plain text', async () => {
    const response = getLlmsFull();

    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('cache-control')).toContain('max-age=3600');
    expect(await response.text()).toBe(buildLlmsFullTxt());
    expect(existsSync(join(root, 'public', 'llms-full.txt'))).toBe(false);
  });

  it('falls back hero ATF copy to opacity 1 without JS and for reduced motion', () => {
    const css = readFileSync(join(root, 'app/globals.css'), 'utf8');

    expect(css).toContain('.animation-hidden');
    expect(css).toContain('hero-atf-appear');
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).toContain('scripting: none');
    expect(css).toMatch(/\.animation-hidden[\s\S]*opacity:\s*1\s*!important/);
  });
});
