/**
 * Plain-text response for the generated agent files (`/llms.txt`,
 * `/llms-full.txt`). Content only changes on deploy, so an hour of browser and
 * edge caching is safe.
 */
export function plainTextResponse(body: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  });
}
