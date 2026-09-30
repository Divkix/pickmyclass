/**
 * Pre-commit: stamps today's date on every static sitemap route whose content
 * is staged, then re-stages the lastmod file. See lib/seo/lastmod-routes.ts.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { changedStaticRoutes, stampLastmod } from '../lib/seo/lastmod-routes';

const LASTMOD_FILE = 'lib/seo/static-page-lastmod.json';

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' });
}

/** The committer's calendar date, YYYY-MM-DD. */
function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${now.getFullYear()}-${month}-${day}`;
}

const staged = git('diff', '--cached', '--name-only', '--diff-filter=ACMRD', '-z')
  .split('\0')
  .filter(Boolean);

const lastmod: Record<string, string> = JSON.parse(readFileSync(LASTMOD_FILE, 'utf8'));

const routes = changedStaticRoutes(staged, Object.keys(lastmod));

const next = stampLastmod(lastmod, routes, today());

if (next) {
  writeFileSync(LASTMOD_FILE, `${JSON.stringify(next, null, 2)}\n`);
  git('add', LASTMOD_FILE);
  process.stdout.write(`lastmod: stamped ${routes.join(', ')} with ${today()}\n`);
}
