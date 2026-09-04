export default {
  fetch: async (_request: Request): Promise<Response> => {
    return new Response('Not mocked', { status: 500 });
  },
};
