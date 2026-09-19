import { describe, expect, it } from 'vite-plus/test';
import {
  appendLinkEntry,
  htmlToMarkdown,
  markdownResponse,
  markdownSourcePath,
  pageLinkHeader,
  prefersMarkdown,
} from '@/lib/worker/markdown-negotiation';

const NOT_FOUND_HTML = `<html><body><main><h1>Page Not Found</h1><p>That URL is gone.</p></main></body></html>`;

function htmlResponse(html: string, status = 200): Response {
  const response = new Response(html, { status });
  response.headers.set('content-type', 'text/html; charset=utf-8');
  response.headers.set('content-length', String(html.length));
  response.headers.set('vary', 'Accept-Encoding');
  return response;
}

describe('prefersMarkdown', () => {
  it.each([
    [
      'a browser',
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    ],
    ['curl', '*/*'],
    ['a markdown request that ranks HTML higher', 'text/markdown;q=0.5, text/html'],
    ['a markdown refusal', 'text/markdown;q=0, text/html'],
    ['no Accept header', null],
  ])('stays on HTML for %s', (_case, accept) => {
    expect(prefersMarkdown(accept)).toBe(false);
  });

  it.each([
    ['an explicit markdown request', 'text/markdown'],
    ['markdown ranked above HTML', 'text/markdown, text/html;q=0.5'],
    ['the legacy markdown type', 'text/x-markdown'],
  ])('switches to markdown for %s', (_case, accept) => {
    expect(prefersMarkdown(accept)).toBe(true);
  });
});

describe('htmlToMarkdown', () => {
  it('converts headings, links, lists, and tables while dropping scripts', () => {
    const html = `<html><head><title>PickMyClass</title></head><body>
      <main>
        <h1>Fall 2026 seats</h1>
        <p>Watch <a href="/blog/asu-class-seat-tracker">a section open</a> before it fills.</p>
        <ul><li>CSE 240</li><li>CSE 310</li></ul>
        <table>
          <thead><tr><th>Section</th><th>Seats</th></tr></thead>
          <tbody><tr><td>12345</td><td>0</td></tr></tbody>
        </table>
        <script>window.tracker = { secret: 'leaked' };</script>
      </main>
    </body></html>`;

    const markdown = htmlToMarkdown(html);

    expect(markdown).toContain('# Fall 2026 seats');
    expect(markdown).toContain('[a section open](/blog/asu-class-seat-tracker)');
    expect(markdown).toContain('- CSE 240');
    expect(markdown).toContain('- CSE 310');
    expect(markdown).toContain('| Section | Seats |');
    expect(markdown).toContain('| --- | --- |');
    expect(markdown).toContain('| 12345 | 0 |');
    expect(markdown).not.toContain('leaked');
  });
});

describe('markdownResponse', () => {
  it('recasts a 404 body as markdown pointing at the sitemap', async () => {
    const markdown = markdownResponse({
      response: htmlResponse(NOT_FOUND_HTML, 404),
      html: NOT_FOUND_HTML,
      url: 'https://pickmyclass.app/__ora-404-probe',
    });

    expect(markdown.status).toBe(404);
    expect(markdown.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(markdown.headers.get('vary')).toBe('Accept-Encoding, Accept');
    expect(markdown.headers.has('content-length')).toBe(false);

    const body = await markdown.text();

    expect(body).toContain('# Page Not Found');
    expect(body).toContain('https://pickmyclass.app/sitemap.xml');
    expect(body).toContain('https://pickmyclass.app/llms.txt');
  });

  it('keeps a successful status and leaves out the not-found note', async () => {
    const html =
      '<html><body><main><h1>Pricing</h1><p>Free for ASU students.</p></main></body></html>';

    const markdown = markdownResponse({
      response: htmlResponse(html),
      html,
      url: 'https://pickmyclass.app/pricing',
    });

    expect(markdown.status).toBe(200);

    const body = await markdown.text();

    expect(body).toContain('Free for ASU students.');
    expect(body).not.toContain('sitemap.xml');
  });

  it('opens with the document title when the page starts with something else', async () => {
    const html =
      '<html><head><title>PickMyClass — ASU class seat tracker</title></head><body><main><p>Built for Sun Devils</p><h1>Free seat alerts</h1></main></body></html>';

    const markdown = markdownResponse({
      response: htmlResponse(html),
      html,
      url: 'https://pickmyclass.app/',
    });

    const body = await markdown.text();

    expect(body.startsWith('# PickMyClass — ASU class seat tracker')).toBe(true);
    expect(body).toContain('Built for Sun Devils');
  });
});

describe('markdownSourcePath', () => {
  it('maps a .md URL onto the page it names', () => {
    expect(markdownSourcePath('/index.md')).toBe('/');
    expect(markdownSourcePath('/blog/asu-class-seat-tracker.md')).toBe(
      '/blog/asu-class-seat-tracker'
    );
    expect(markdownSourcePath('/blog/asu-class-seat-tracker')).toBeNull();
    expect(markdownSourcePath('/llms.txt')).toBeNull();
  });
});

describe('pageLinkHeader / appendLinkEntry', () => {
  it('advertises the sitemap and the page markdown twin', () => {
    expect(pageLinkHeader('/')).toBe(
      '</sitemap.xml>; rel="sitemap", </index.md>; rel="alternate"; type="text/markdown"'
    );
    expect(pageLinkHeader('/blog/asu-class-seat-tracker')).toContain(
      '</blog/asu-class-seat-tracker.md>; rel="alternate"'
    );
    expect(pageLinkHeader('/pricing.md')).toBe('</sitemap.xml>; rel="sitemap"');
  });

  it('keeps the links the page already advertises', () => {
    const headers = new Headers({ link: '</og.png>; rel="preload"' });

    appendLinkEntry(headers, pageLinkHeader('/'));

    expect(headers.get('link')).toBe(
      '</og.png>; rel="preload", </sitemap.xml>; rel="sitemap", </index.md>; rel="alternate"; type="text/markdown"'
    );
  });
});
