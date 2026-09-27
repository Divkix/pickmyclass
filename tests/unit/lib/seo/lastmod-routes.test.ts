import { describe, expect, it } from 'vite-plus/test';
import { changedStaticRoutes, stampLastmod } from '@/lib/seo/lastmod-routes';
import lastmod from '@/lib/seo/static-page-lastmod.json';
import sitemap from '@/app/sitemap';

const tracked = Object.keys(lastmod);

describe('changedStaticRoutes', () => {
  it.each([
    ['app/page.tsx', ['/']],
    ['app/faq/page.tsx', ['/faq']],
    ['app/about/page.tsx', ['/about']],
    ['app/contact/page.tsx', ['/contact']],
    ['app/docs/page.tsx', ['/docs']],
    ['app/legal/terms/page.tsx', ['/legal/terms']],
    ['app/legal/privacy/page.tsx', ['/legal/privacy']],
    ['app/(marketing)/faq/page.tsx', ['/faq']],
    ['components/landing/HeroSection.tsx', ['/']],
    ['lib/faqs.ts', ['/']],
  ])('maps %s to %j', (file, routes) => {
    expect(changedStaticRoutes([file], tracked)).toEqual(routes);
  });

  it.each([
    'app/layout.tsx',
    'app/sitemap.ts',
    'app/globals.css',
    'app/legal/page.tsx',
    'app/dashboard/page.tsx',
    'app/blog/asu-waitlist-guide/page.tsx',
    'components/landing/JsonLd.tsx',
    'components/ui/button.tsx',
    'lib/seo/static-page-lastmod.json',
    'README.md',
  ])('ignores %s', (file) => {
    expect(changedStaticRoutes([file], tracked)).toEqual([]);
  });

  it('dedupes and sorts routes across files', () => {
    expect(
      changedStaticRoutes(
        ['app/faq/page.tsx', 'lib/faqs.ts', 'app/page.tsx', 'components/landing/HowItWorks.tsx'],
        tracked
      )
    ).toEqual(['/', '/faq']);
  });

  it('only returns tracked routes', () => {
    expect(changedStaticRoutes(['app/faq/page.tsx'], ['/'])).toEqual([]);
  });
});

describe('stampLastmod', () => {
  it('sets the date on changed routes and leaves the rest', () => {
    expect(
      stampLastmod({ '/': '2026-01-01', '/faq': '2026-01-01' }, ['/faq'], '2026-09-27')
    ).toEqual({ '/': '2026-01-01', '/faq': '2026-09-27' });
  });

  it('returns null when every route already has the date', () => {
    expect(stampLastmod({ '/': '2026-09-27' }, ['/'], '2026-09-27')).toBeNull();
    expect(stampLastmod({ '/': '2026-09-27' }, [], '2026-09-27')).toBeNull();
  });
});

describe('static-page-lastmod.json', () => {
  it('holds an ISO date for every route', () => {
    for (const date of Object.values(lastmod)) {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('feeds the sitemap lastModified for every tracked route', async () => {
    const entries = await sitemap();

    for (const [route, date] of Object.entries(lastmod)) {
      const entry = entries.find((item) => item.url === `https://pickmyclass.app${route}`);
      expect(entry?.lastModified).toEqual(new Date(`${date}T00:00:00.000Z`));
    }
  });
});
