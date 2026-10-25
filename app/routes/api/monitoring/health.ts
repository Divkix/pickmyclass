import { createFileRoute } from "@tanstack/react-router";
import { methodNotAllowed } from "@/lib/api/response";
import { checkHealth } from "@/lib/monitoring/health";

export const Route = createFileRoute("/api/monitoring/health")({
  server: { handlers: { GET: ({ request }) => checkHealth(request), ANY: methodNotAllowed } },
});
