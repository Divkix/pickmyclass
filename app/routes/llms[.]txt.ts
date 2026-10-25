import { createFileRoute } from "@tanstack/react-router";
import { methodNotAllowed } from "@/lib/api/response";
import { buildLlmsTxt } from "@/lib/seo/llms";
import { plainTextResponse } from "@/lib/seo/text-response";

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: { GET: () => plainTextResponse(buildLlmsTxt()), ANY: methodNotAllowed },
  },
});
