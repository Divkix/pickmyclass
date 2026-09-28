import { describe, expect, it } from 'vite-plus/test';
import robots from '@/app/robots';

describe('robots directives', () => {
  it('allows auth crawls, retains private-path exclusions, and explicitly allows Claude-SearchBot', async () => {
    const response = await robots();
    const rules = Array.isArray(response.rules) ? response.rules : [response.rules];
    const defaultRule = rules.find((rule) => rule.userAgent === '*');
    const claudeRule = rules.find((rule) => rule.userAgent === 'Claude-SearchBot');

    expect(defaultRule?.disallow).not.toEqual(
      expect.arrayContaining(['/sign-in', '/sign-in/*', '/sign-up', '/sign-up/*'])
    );
    expect(defaultRule?.disallow).toEqual(
      expect.arrayContaining(['/dashboard', '/dashboard/*', '/admin', '/settings'])
    );
    expect(claudeRule?.allow).toBe('/');
    expect(claudeRule?.disallow).toEqual(expect.arrayContaining(['/dashboard', '/settings']));
  });
});
