import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { Plugin } from 'vite-plus';
import {
  failOpenSourcemapUpload,
  shouldUploadPosthogSourcemaps,
} from '@/lib/analytics/sourcemap-upload';

type Handler = (...args: any[]) => any;

function handlerOf(hook: Plugin['renderChunk'] | Plugin['writeBundle']): Handler {
  if (!hook) throw new Error('hook missing');

  // SAFETY: tests invoke hooks with minimal fake contexts/chunks; the wrapper only forwards them.
  return (hook instanceof Function ? hook : hook.handler) as Handler;
}

async function outputDir(files: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'posthog-sourcemaps-'));

  await Promise.all(files.map((file) => writeFile(join(dir, file), 'x')));

  return dir;
}

describe('shouldUploadPosthogSourcemaps', () => {
  it('never uploads on ordinary builds', () => {
    expect(shouldUploadPosthogSourcemaps(false, 'phx_key', '12345')).toBe(false);
  });

  it('skips upload when the deploy flag is set but credentials are missing', () => {
    expect(shouldUploadPosthogSourcemaps(true, undefined, undefined)).toBe(false);
    expect(shouldUploadPosthogSourcemaps(true, '', '12345')).toBe(false);
    expect(shouldUploadPosthogSourcemaps(true, 'phx_key', '')).toBe(false);
  });

  it('uploads when the deploy flag and both credentials are present', () => {
    expect(shouldUploadPosthogSourcemaps(true, 'phx_key', '12345')).toBe(true);
  });
});

describe('failOpenSourcemapUpload', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('keeps hook options such as order and sequential', () => {
    const wrapped = failOpenSourcemapUpload({
      name: 'posthog-rollup-plugin',
      renderChunk: { order: 'post', handler: () => null },
      writeBundle: { sequential: true, handler: async () => {} },
    });

    expect(wrapped.renderChunk).toMatchObject({ order: 'post' });
    expect(wrapped.writeBundle).toMatchObject({ sequential: true });
  });

  it('passes renderChunk results through when PostHog is reachable', async () => {
    const wrapped = failOpenSourcemapUpload({
      name: 'posthog-rollup-plugin',
      renderChunk: { order: 'post', handler: async (code: string) => ({ code: `${code}//id` }) },
    });

    await expect(handlerOf(wrapped.renderChunk).call({}, 'code', {})).resolves.toEqual({
      code: 'code//id',
    });
  });

  it('does not fail the build when release resolve throws, and deletes hidden maps', async () => {
    const upload = vi.fn();

    const wrapped = failOpenSourcemapUpload({
      name: 'posthog-rollup-plugin',
      renderChunk: {
        order: 'post',
        handler: async () => {
          throw new Error('posthog-cli release resolve failed');
        },
      },
      writeBundle: { sequential: true, handler: upload },
    });

    const dir = await outputDir(['a.js', 'a.js.map', 'b.js']);

    await expect(handlerOf(wrapped.renderChunk).call({}, 'code', {})).resolves.toBeNull();
    await handlerOf(wrapped.writeBundle).call({}, { dir }, { 'a.js': {}, 'b.js': {} });

    expect(upload).not.toHaveBeenCalled();
    expect((await readdir(dir)).sort()).toEqual(['a.js', 'b.js']);
    expect(console.warn).toHaveBeenCalledWith(
      '[posthog]',
      expect.stringContaining('source-map release resolve failed')
    );
  });

  it('does not fail the build when the upload throws, and deletes hidden maps', async () => {
    const wrapped = failOpenSourcemapUpload({
      name: 'posthog-rollup-plugin',
      writeBundle: {
        sequential: true,
        handler: async () => {
          throw new Error('upload failed with code 1');
        },
      },
    });

    const dir = await outputDir(['a.js', 'a.js.map']);

    await expect(
      handlerOf(wrapped.writeBundle).call({}, { dir }, { 'a.js': {} })
    ).resolves.toBeUndefined();

    expect(await readdir(dir)).toEqual(['a.js']);
    expect(console.warn).toHaveBeenCalledWith(
      '[posthog]',
      expect.stringContaining('source-map upload failed')
    );
  });

  it('leaves output alone after a successful upload', async () => {
    const upload = vi.fn(async () => {});

    const wrapped = failOpenSourcemapUpload({
      name: 'posthog-rollup-plugin',
      writeBundle: { sequential: true, handler: upload },
    });

    const dir = await outputDir(['a.js', 'a.js.map']);

    await handlerOf(wrapped.writeBundle).call({}, { dir }, { 'a.js': {} });

    expect(upload).toHaveBeenCalledTimes(1);
    expect((await readdir(dir)).sort()).toEqual(['a.js', 'a.js.map']);
  });
});
