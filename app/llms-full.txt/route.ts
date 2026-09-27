import { buildLlmsFullTxt } from '@/lib/seo/llms-full';
import { plainTextResponse } from '@/lib/seo/text-response';

export function GET() {
  return plainTextResponse(buildLlmsFullTxt());
}
