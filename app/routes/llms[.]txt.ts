import { createFileRoute } from "@tanstack/react-router";
import { methodNotAllowed } from "@/lib/api/response";
import { buildLlmsTxt } from "@/lib/seo/llms";
import { plainTextResponse } from "@/lib/seo/text-response";

// Keep both llms routes dynamic: public/llms*.txt would shadow /llms.txt and /llms-full.txt.
export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: { GET: () => plainTextResponse(buildLlmsTxt()), ANY: methodNotAllowed },
  },
});
