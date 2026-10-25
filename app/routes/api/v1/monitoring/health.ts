/**
 * Versioned path for the public health endpoint.
 *
 * Both health paths use the shared handler in `lib/monitoring/health.ts`;
 * agents integrate against the versioned path so a future breaking change
 * can ship as `/api/v2/...` while `v1` keeps answering.
 */
import { createFileRoute } from "@tanstack/react-router";
import { methodNotAllowed } from "@/lib/api/response";
import { checkHealth } from "@/lib/monitoring/health";

export const Route = createFileRoute("/api/v1/monitoring/health")({
  server: { handlers: { GET: ({ request }) => checkHealth(request), ANY: methodNotAllowed } },
});
