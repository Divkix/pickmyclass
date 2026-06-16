/**
 * Mock for vinext/server/app-router-entry used in vitest.
 *
 * vinext's app-router-entry imports from virtual: modules (virtual:vinext-rsc-entry,
 * virtual:vinext-cache-adapters) that only exist when the vinext Vite plugin is active.
 * This mock replaces the entire module so tests can control handler.fetch().
 */
export default {
  fetch: async (_request: Request): Promise<Response> => {
    return new Response('Not mocked', { status: 500 });
  },
};
