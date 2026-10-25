import { checkHealth } from "@/lib/monitoring/health";

export function GET(request: Request): Promise<Response> {
  return checkHealth(request);
}
