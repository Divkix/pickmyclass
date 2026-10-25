/**
 * Versioned path for the public health endpoint.
 *
 * Both health paths use the shared handler in `lib/monitoring/health.ts`;
 * agents integrate against the versioned path so a future breaking change
 * can ship as `/api/v2/...` while `v1` keeps answering.
 */
import { checkHealth } from "@/lib/monitoring/health";

export function GET(request: Request): Promise<Response> {
  return checkHealth(request);
}
