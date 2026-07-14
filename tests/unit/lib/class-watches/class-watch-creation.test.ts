import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { ClassWatchRow } from '@/lib/types/class-watch';
import { createClassWatchClient } from '@/lib/class-watches/class-watch-creation';

const watch = {
  id: 'watch-1',
  user_id: 'user-1',
  term: '2267',
  class_nbr: '12345',
  subject: 'CSE',
  catalog_nbr: '110',
  created_at: '2026-07-12T00:00:00.000Z',
} as ClassWatchRow;

describe('classWatchCreation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('provides the selectable terms and default term through one options seam', () => {
    const client = createClassWatchClient(vi.fn());

    const options = client.getOptions();

    expect(options.terms.map((term) => term.code)).toEqual(['2264', '2267']);
    expect(options.defaultTerm).toBe('2264');
  });

  it('validates with the authoritative creation schema before making a request', async () => {
    const request = vi.fn();
    const client = createClassWatchClient(request);

    await expect(client.create({ term: '2267', class_nbr: '123' })).rejects.toThrow(
      'Section number must be a 5-digit code'
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects a non-selectable term before making a request', async () => {
    const request = vi.fn();

    await expect(
      createClassWatchClient(request).create({ term: '2261', class_nbr: '12345' })
    ).rejects.toThrow('This term is no longer available');
    expect(request).not.toHaveBeenCalled();
  });

  it('posts the canonical SectionRef and returns the created watch', async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, watch }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    );
    const client = createClassWatchClient(request);

    await expect(client.create({ term: '2267', class_nbr: '12345' })).resolves.toEqual(watch);
    expect(request).toHaveBeenCalledWith('/api/class-watches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: '2267', class_nbr: '12345' }),
    });
  });

  it('uses the API error message when creation is rejected', async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ success: false, error: 'You are already watching this class' }),
        {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }
      )
    );

    await expect(
      createClassWatchClient(request).create({ term: '2267', class_nbr: '12345' })
    ).rejects.toThrow('You are already watching this class');
  });

  it('uses one fallback for non-JSON, malformed, and mismatched success responses', async () => {
    const nonJsonRequest = vi
      .fn()
      .mockResolvedValue(new Response('upstream unavailable', { status: 503 }));
    const missingWatchRequest = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    );
    const mismatchedWatchRequest = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, watch: { ...watch, class_nbr: '99999' } }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    );

    await expect(
      createClassWatchClient(nonJsonRequest).create({ term: '2267', class_nbr: '12345' })
    ).rejects.toThrow('Failed to add class watch');
    await expect(
      createClassWatchClient(missingWatchRequest).create({ term: '2267', class_nbr: '12345' })
    ).rejects.toThrow('Failed to add class watch');
    await expect(
      createClassWatchClient(mismatchedWatchRequest).create({
        term: '2267',
        class_nbr: '12345',
      })
    ).rejects.toThrow('Failed to add class watch');
  });

  it('uses the same fallback for network failures and empty API errors', async () => {
    const networkFailure = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const emptyError = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: '   ' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })
    );

    await expect(
      createClassWatchClient(networkFailure).create({ term: '2267', class_nbr: '12345' })
    ).rejects.toThrow('Failed to add class watch');
    await expect(
      createClassWatchClient(emptyError).create({ term: '2267', class_nbr: '12345' })
    ).rejects.toThrow('Failed to add class watch');
  });
});
