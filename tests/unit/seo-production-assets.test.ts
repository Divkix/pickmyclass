import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { blogPosts } from '@/lib/blog/posts';

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

  it('publishes llms-full.txt with every public guide and public crawl target', () => {
    const full = readPublicFile('llms-full.txt');

    for (const post of blogPosts) {
      expect(full).toContain(`https://pickmyclass.app/blog/${post.slug}`);
      expect(full).toContain(post.title);
    }

    for (const path of ['/', '/faq', '/blog', '/legal/terms', '/legal/privacy']) {
      expect(full).toContain(`https://pickmyclass.app${path === '/' ? '/' : path}`);
    }
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
