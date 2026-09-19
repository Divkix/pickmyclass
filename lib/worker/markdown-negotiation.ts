/**
 * Markdown content negotiation for the Worker fetch path.
 *
 * A client that explicitly advertises `Accept: text/markdown` receives a Markdown
 * rendering of the page it requested; every other client keeps the HTML
 * representation. Both come from the same SSR response, so the two cannot drift.
 *
 * The conversion runs per markdown request — agent traffic is a small fraction of
 * page views, and caching a second representation is not worth the bookkeeping.
 */

const INLINE_TAGS: Record<string, true> = {
  abbr: true,
  bdi: true,
  bdo: true,
  button: true,
  cite: true,
  data: true,
  dfn: true,
  kbd: true,
  label: true,
  mark: true,
  output: true,
  picture: true,
  q: true,
  samp: true,
  small: true,
  span: true,
  sub: true,
  summary: true,
  sup: true,
  time: true,
  u: true,
  var: true,
  wbr: true,
};

/** Elements whose text content is never page content for an agent. */
const SKIPPED_TAGS: Record<string, true> = {
  audio: true,
  canvas: true,
  iframe: true,
  map: true,
  noscript: true,
  object: true,
  script: true,
  style: true,
  svg: true,
  template: true,
  video: true,
};

const HEADING_TAGS: Record<string, number> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
};

const INLINE_MARKERS: Record<string, string> = {
  b: '**',
  code: '`',
  del: '~~',
  em: '*',
  i: '*',
  ins: '__',
  s: '~~',
  strong: '**',
};

const NOT_FOUND_STATUSES = new Set([404, 410]);

const ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  copy: '\u00a9',
  gt: '>',
  hellip: '\u2026',
  ldquo: '\u201c',
  lsquo: '\u2018',
  lt: '<',
  mdash: '\u2014',
  middot: '\u00b7',
  nbsp: ' ',
  ndash: '\u2013',
  quot: '"',
  rdquo: '\u201d',
  reg: '\u00ae',
  rsquo: '\u2019',
  times: '\u00d7',
  trade: '\u2122',
};

const TOKEN_PATTERN =
  /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)>/g;

interface TagToken {
  tag: string;
  closing: boolean;
  attrs: string;
}

interface MediaRange {
  type: string;
  subtype: string;
  quality: number;
}

function decodeEntities(text: string): string {
  return text.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const hex = entity[1] === 'x' || entity[1] === 'X';
      const code = Number.parseInt(hex ? entity.slice(2) : entity.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      return String.fromCodePoint(code);
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function tokenize(html: string): Array<TagToken | string> {
  const tokens: Array<TagToken | string> = [];
  let cursor = 0;

  for (const match of html.matchAll(TOKEN_PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) tokens.push(html.slice(cursor, start));
    cursor = start + match[0].length;

    if (match[0].startsWith('<!--')) continue;
    tokens.push({
      tag: (match[1] ?? '').toLowerCase(),
      closing: match[0][1] === '/',
      attrs: match[2] ?? '',
    });
  }

  if (cursor < html.length) tokens.push(html.slice(cursor));
  return tokens;
}

function readAttribute(attrs: string, name: string): string {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const match = attrs.match(pattern);
  const value = match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
  return decodeEntities(value).trim();
}

/** Content the page actually renders, without the shell around it. */
function extractContent(html: string): string {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (main?.[1]) return main[1];

  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (body?.[1]) return body[1];

  return html.replace(/<head\b[^>]*>[\s\S]*?<\/head>/i, '');
}

function pushTable(blocks: string[], rows: string[][]): void {
  const [header, ...body] = rows;
  if (!header) return;

  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ];
  blocks.push(lines.join('\n'));
}

/**
 * True when the client explicitly asks for Markdown and does not rank HTML higher.
 *
 * A wildcard-only `Accept` (`* /*`) is not enough: browsers and plain HTTP clients
 * send it, and they must keep receiving HTML.
 */
export function prefersMarkdown(accept: string | null): boolean {
  if (!accept) return false;

  const ranges: MediaRange[] = [];
  for (const part of accept.split(',')) {
    const [range, ...params] = part.split(';');
    const [type, subtype] = range.trim().toLowerCase().split('/');
    if (!type || !subtype) continue;

    let quality = 1;
    for (const param of params) {
      const [name, value] = param.split('=');
      if (name?.trim().toLowerCase() !== 'q') continue;
      const parsed = Number.parseFloat((value ?? '').trim());
      quality = Number.isFinite(parsed) ? parsed : 0;
    }
    ranges.push({ type, subtype, quality });
  }

  const explicit = ranges.some(
    (range) =>
      range.type === 'text' &&
      (range.subtype === 'markdown' || range.subtype === 'x-markdown') &&
      range.quality > 0
  );
  if (!explicit) return false;

  const qualityOf = (type: string, subtype: string, fallback: boolean): number => {
    let best = fallback ? 1 : 0;
    for (const range of ranges) {
      const matches =
        (range.type === '*' && range.subtype === '*') ||
        (range.type === type && range.subtype === '*') ||
        (range.type === type && range.subtype === subtype);
      if (matches) best = Math.max(best, range.quality);
    }
    return best;
  };

  // A missing `text/html` range scores 0 unless a wildcard covers it.
  const wildcard = ranges.some((range) => range.type === '*' && range.subtype === '*');
  return qualityOf('text', 'markdown', false) >= qualityOf('text', 'html', wildcard);
}

export function isHtmlResponse(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').toLowerCase().includes('text/html');
}

/** Appends a value to `Vary` without duplicating or clobbering the existing list. */
export function appendVary(headers: Headers, value: string): void {
  const existing = headers.get('vary');
  if (!existing) {
    headers.set('vary', value);
    return;
  }

  const values = existing
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (values.some((entry) => entry.toLowerCase() === value.toLowerCase())) return;

  values.push(value);
  headers.set('vary', values.join(', '));
}

/** Last-resort body for pages that render no convertible content. */
function fallbackFromHtml(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const description = html.match(
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i
  )?.[1];

  const parts: string[] = [];
  if (title) parts.push(`# ${decodeEntities(title).trim()}`);
  if (description) parts.push(decodeEntities(description).trim());
  return parts.join('\n\n');
}

function notFoundNote(origin: string): string {
  return [
    `**404 — page not found.** This URL does not exist on ${origin}.`,
    `Every page is listed in the sitemap at ${origin}/sitemap.xml, and ${origin}/llms.txt is the machine-readable index for agents.`,
  ].join('\n\n');
}

interface MarkdownResponseInput {
  /** The HTML response produced by the app router. */
  response: Response;
  /** Its decoded body. */
  html: string;
  /** Request URL, used for absolute links in generated notes. */
  url: string;
}

/** Recasts an HTML response as its Markdown representation, preserving status. */
export function markdownResponse({ response, html, url }: MarkdownResponseInput): Response {
  const origin = new URL(url).origin;
  let body = htmlToMarkdown(html) || fallbackFromHtml(html);
  if (NOT_FOUND_STATUSES.has(response.status)) {
    body = body ? `${body}\n\n---\n\n${notFoundNote(origin)}` : notFoundNote(origin);
  }

  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  headers.set('content-type', 'text/markdown; charset=utf-8');
  appendVary(headers, 'Accept');

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Converts rendered HTML into Markdown: headings, paragraphs, lists, tables,
 * links, images, emphasis, and fenced code, with scripts and other non-content
 * elements dropped.
 */
export function htmlToMarkdown(html: string): string {
  const blocks: string[] = [];
  const listStack: Array<{ ordered: boolean; index: number }> = [];
  const linkStack: Array<{ start: number; href: string }> = [];
  const styleStack: Array<{ start: number; marker: string }> = [];
  const skipped: string[] = [];

  let inline = '';
  let prefix = '';
  let quoteDepth = 0;
  let preText: string | null = null;
  let table: string[][] | null = null;
  let row: string[] | null = null;
  let cell: string | null = null;

  let tight = false;

  const flush = (): void => {
    const text = inline.replace(/\s+/g, ' ').trim();
    if (!text) return;

    const marker = `${'> '.repeat(Math.max(quoteDepth, 0))}${prefix}`;
    inline = '';
    prefix = '';

    const inList = listStack.length > 0;
    if (inList && tight && blocks.length > 0) {
      blocks[blocks.length - 1] = `${blocks[blocks.length - 1]}\n${marker}${text}`;
    } else {
      blocks.push(marker + text);
    }
    tight = inList;
  };

  for (const token of tokenize(extractContent(html))) {
    if (typeof token === 'string') {
      if (skipped.length > 0) continue;
      if (preText !== null) preText += token;
      else if (cell !== null) cell += decodeEntities(token);
      else inline += decodeEntities(token);
      continue;
    }

    const { tag, closing, attrs } = token;

    if (skipped.length > 0) {
      if (SKIPPED_TAGS[tag]) {
        if (closing) skipped.pop();
        else skipped.push(tag);
      }
      continue;
    }

    if (preText !== null) {
      if (tag === 'pre' && closing) {
        flush();
        const code = preText.replace(/^\n+|\s+$/g, '');
        if (code) {
          const ticks = code.includes('```') ? '````' : '```';
          blocks.push(`${ticks}\n${code}\n${ticks}`);
        }
        preText = null;
      }
      continue;
    }

    if (table !== null) {
      if (tag === 'tr') {
        if (closing) {
          if (row?.some((value) => value.trim())) table.push(row);
          row = null;
        } else {
          row = [];
        }
      } else if (tag === 'td' || tag === 'th') {
        if (closing) row?.push((cell ?? '').replace(/\s+/g, ' ').trim());
        cell = closing ? null : '';
      } else if (tag === 'table' && closing) {
        flush();
        pushTable(blocks, table);
        table = null;
        row = null;
        cell = null;
      }
      continue;
    }

    if (SKIPPED_TAGS[tag]) {
      if (!closing) skipped.push(tag);
      continue;
    }

    if (tag === 'table') {
      flush();
      if (!closing) table = [];
      continue;
    }

    if (tag === 'ul' || tag === 'ol') {
      flush();
      if (closing) listStack.pop();
      else listStack.push({ ordered: tag === 'ol', index: 0 });
      continue;
    }

    if (tag === 'li') {
      flush();
      if (!closing) {
        const list = listStack[listStack.length - 1];
        if (list) {
          list.index += 1;
          prefix = `${'  '.repeat(Math.max(listStack.length - 1, 0))}${list.ordered ? `${list.index}.` : '-'} `;
        }
      }
      continue;
    }

    if (tag === 'blockquote') {
      flush();
      quoteDepth += closing ? -1 : 1;
      continue;
    }

    const heading = HEADING_TAGS[tag];
    if (heading) {
      flush();
      if (!closing) prefix = `${'#'.repeat(heading)} `;
      continue;
    }

    if (tag === 'hr' && !closing) {
      flush();
      blocks.push('---');
      continue;
    }

    if (tag === 'pre') {
      flush();
      if (!closing) preText = '';
      continue;
    }

    if (tag === 'br') {
      flush();
      continue;
    }

    if (tag === 'img') {
      if (!closing) {
        const src = readAttribute(attrs, 'src');
        if (src && !src.startsWith('data:')) {
          inline += `![${readAttribute(attrs, 'alt')}](${src})`;
        }
      }
      continue;
    }

    if (tag === 'a') {
      if (closing) {
        const link = linkStack.pop();
        if (link?.href) {
          const text = inline.slice(link.start).trim() || link.href;
          inline = `${inline.slice(0, link.start)}[${text}](${link.href})`;
        }
      } else {
        const href = readAttribute(attrs, 'href');
        linkStack.push({
          start: inline.length,
          href: href && !/^javascript:/i.test(href) ? href : '',
        });
      }
      continue;
    }

    const marker = INLINE_MARKERS[tag];
    if (marker) {
      if (closing) {
        const styled = styleStack.pop();
        if (styled) {
          const text = inline.slice(styled.start).trim();
          inline = text
            ? `${inline.slice(0, styled.start)}${styled.marker}${text}${styled.marker}`
            : inline.slice(0, styled.start);
        }
      } else {
        styleStack.push({ start: inline.length, marker });
      }
      continue;
    }

    if (INLINE_TAGS[tag]) continue;

    // Every remaining tag is a block boundary.
    flush();
  }

  flush();
  return blocks
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
