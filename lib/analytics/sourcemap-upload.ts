import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite-plus';
import { log } from '../log';

/**
 * Build-time PostHog source-map upload is opt-in and fail-open.
 *
 * The deploy script sets POSTHOG_UPLOAD_SOURCEMAPS=true, but Cloudflare Workers
 * Builds uses that same script without POSTHOG_API_KEY / POSTHOG_PROJECT_ID.
 * Missing credentials skip the plugin so the Worker still deploys; upload runs
 * only when both the flag and personal API credentials are present. PostHog API
 * failures during an upload build are caught by failOpenSourcemapUpload below.
 */
export function shouldUploadPosthogSourcemaps(
  uploadRequested: boolean,
  apiKey: string | undefined,
  projectId: string | undefined
): boolean {
  return uploadRequested && Boolean(apiKey) && Boolean(projectId);
}

type RenderChunkHook = NonNullable<Plugin['renderChunk']>;

type RenderChunkHandler = Extract<RenderChunkHook, (...args: never[]) => void>;

type WriteBundleHook = NonNullable<Plugin['writeBundle']>;

type WriteBundleHandler = Extract<WriteBundleHook, (...args: never[]) => void>;

function describeError(error: Error | string): string {
  return error instanceof Error ? error.message : error;
}

/**
 * Makes the PostHog source-map plugin fail-open.
 *
 * @posthog/rollup-plugin calls the PostHog API during the build (`release
 * resolve` in renderChunk, the upload in writeBundle) and rethrows any failure,
 * so an expired personal API key or a PostHog outage would fail the deploy
 * build. Source maps are observability, never a deploy blocker: on failure this
 * warns, ships the bundle without release/chunk ids, and deletes the hidden
 * `.map` files the plugin forced on so they are never served publicly.
 */
export function failOpenSourcemapUpload(plugin: Plugin): Plugin {
  const { renderChunk, writeBundle } = plugin;
  let failed = false;

  function reportFailure(stage: string, error: Error | string): void {
    // Chunks await one shared release lookup, so warn once per build, not per chunk.
    if (!failed) {
      log('posthog').warn(
        `source-map ${stage} failed — continuing without uploaded source maps: ${describeError(error)}`
      );
    }

    failed = true;
  }

  const wrapped: Plugin = { ...plugin };

  if (renderChunk) {
    const original: RenderChunkHandler =
      renderChunk instanceof Function ? renderChunk : renderChunk.handler;

    const handler: RenderChunkHandler = async function (this, ...args) {
      if (failed) return null;

      try {
        return await original.call(this, ...args);
      } catch (error) {
        reportFailure('release resolve', error instanceof Error ? error : String(error));

        return null;
      }
    };

    wrapped.renderChunk = renderChunk instanceof Function ? handler : { ...renderChunk, handler };
  }

  if (writeBundle) {
    const original: WriteBundleHandler =
      writeBundle instanceof Function ? writeBundle : writeBundle.handler;

    const handler: WriteBundleHandler = async function (this, options, bundle) {
      try {
        if (!failed) await original.call(this, options, bundle);
      } catch (error) {
        reportFailure('upload', error instanceof Error ? error : String(error));
      }

      if (failed) {
        const dir = options.dir ?? '.';

        const mapFiles = Object.keys(bundle).flatMap((fileName) =>
          fileName.endsWith('.map') ? [fileName] : [`${fileName}.map`]
        );

        await Promise.all(
          [...new Set(mapFiles)].map((fileName) => rm(resolve(dir, fileName), { force: true }))
        );
      }

      failed = false;
    };

    wrapped.writeBundle = writeBundle instanceof Function ? handler : { ...writeBundle, handler };
  }

  return wrapped;
}
