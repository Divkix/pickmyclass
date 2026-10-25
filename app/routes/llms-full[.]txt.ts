import { createFileRoute } from "@tanstack/react-router";
import { methodNotAllowed } from "@/lib/api/response";
import { buildLlmsFullTxt } from "@/lib/seo/llms-full";
import { plainTextResponse } from "@/lib/seo/text-response";

export const Route = createFileRoute("/llms-full.txt")({
  server: {
    handlers: { GET: () => plainTextResponse(buildLlmsFullTxt()), ANY: methodNotAllowed },
  },
});
