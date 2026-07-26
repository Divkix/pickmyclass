/**
 * Unsubscribe API Endpoint
 *
 * Handles one-click unsubscribe from email notifications (CAN-SPAM compliance).
 * Accepts signed tokens to verify authenticity.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { unsubscribeTokenSchema } from '@/lib/api/schemas';
import { mapValidationIssues } from '@/lib/api/validation';
import { fail, ok } from '@/lib/api/response';
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe-token';
import { log } from '@/lib/log';
import { captureServerEvent } from '@/lib/posthog-server';
import { getServiceClient } from '@/lib/supabase/service';

/**
 * Redacts a user identifier by hashing it to produce a consistent,
 * non-reversible token for safe logging and tracing.
 */
function redactIdentifier(userId: string): string {
  return createHash('sha256').update(userId).digest('hex');
}

function htmlPage(title: string, content: string, status: number): NextResponse {
  const linkStyles =
    status === 200
      ? `
    a { color: #8C1D40; text-decoration: none; }
    a:hover { text-decoration: underline; }`
      : '';

  return new NextResponse(
    `<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 600px;
      margin: 50px auto;
      padding: 20px;
      text-align: center;
    }
    .error { color: #dc2626; }
    .success { color: #059669; }${linkStyles}
  </style>
</head>
<body>
${content}
</body>
</html>`,
    { status, headers: { 'Content-Type': 'text/html' } }
  );
}

async function unsubscribeUser(userId: string, method: 'GET' | 'POST'): Promise<void> {
  const { error } = await getServiceClient()
    .from('user_profiles')
    .update({
      notifications_enabled: false,
      unsubscribed_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  if (error) {
    log('Unsubscribe').error('Database error:', error);
    throw error;
  }

  const suffix = method === 'POST' ? 'via POST' : 'successfully';
  log('Unsubscribe').info(`User ${redactIdentifier(userId)} unsubscribed ${suffix}`);
  await captureServerEvent({ distinctId: userId, event: 'user_unsubscribed' });
}

/**
 * GET handler for web-based unsubscribe
 * Renders an HTML page with unsubscribe confirmation
 */
// One-click unsubscribe requires GET per RFC 8058 / CAN-SPAM standards
// eslint-disable-next-line react-doctor/nextjs-no-side-effect-in-get-handler
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const token = searchParams.get('token');

  // Validate token parameter
  const validation = unsubscribeTokenSchema.safeParse({ token });

  if (!validation.success) {
    return htmlPage(
      'Invalid Unsubscribe Link',
      `  <h1 class="error">Invalid Unsubscribe Link</h1>
  <p>This unsubscribe link is invalid or missing required information.</p>
  <p><a href="/">Return to PickMyClass</a></p>`,
      400
    );
  }

  // Verify token
  const userId = verifyUnsubscribeToken(validation.data.token);

  if (!userId) {
    return htmlPage(
      'Invalid Unsubscribe Token',
      `  <h1 class="error">Invalid or Expired Token</h1>
  <p>This unsubscribe link is invalid or has expired.</p>
  <p>You can manage your notification preferences from your account settings.</p>
  <p><a href="/">Return to PickMyClass</a></p>`,
      400
    );
  }

  // Unsubscribe user
  try {
    await unsubscribeUser(userId, 'GET');
    return htmlPage(
      'Unsubscribed Successfully',
      `  <h1 class="success">✓ Unsubscribed Successfully</h1>
  <p>You've been unsubscribed from all PickMyClass email notifications.</p>
  <p>You can re-enable notifications anytime from your account settings.</p>
  <p><a href="/">Return to PickMyClass</a></p>`,
      200
    );
  } catch (error) {
    log('Unsubscribe').error('Error processing unsubscribe:', error);
    return htmlPage(
      'Unsubscribe Error',
      `  <h1 class="error">Error Processing Unsubscribe</h1>
  <p>We encountered an error while processing your request.</p>
  <p>Please try again later or contact support.</p>
  <p><a href="/">Return to PickMyClass</a></p>`,
      500
    );
  }
}

/**
 * POST handler for one-click unsubscribe (RFC 8058)
 * Used by email clients that support List-Unsubscribe-Post
 */
export async function POST(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const token = searchParams.get('token');

  // Validate token parameter
  const validation = unsubscribeTokenSchema.safeParse({ token });

  if (!validation.success) {
    return fail('Invalid input', 400, mapValidationIssues(validation.error));
  }

  // Verify token
  const userId = verifyUnsubscribeToken(validation.data.token);

  if (!userId) {
    return fail('Invalid or expired token', 400);
  }

  // Unsubscribe user
  try {
    await unsubscribeUser(userId, 'POST');
    return ok(null);
  } catch (error) {
    log('Unsubscribe').error('Error processing unsubscribe:', error);
    return fail('Internal server error', 500);
  }
}
