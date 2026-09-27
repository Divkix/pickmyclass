import { buildLlmsTxt } from '@/lib/seo/llms';
import { plainTextResponse } from '@/lib/seo/text-response';

export function GET() {
  return plainTextResponse(buildLlmsTxt());
}
