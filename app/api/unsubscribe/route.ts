/**
 * Unsubscribe API Endpoint
 *
 * Handles one-click unsubscribe from email notifications (CAN-SPAM compliance).
 * Accepts signed tokens to verify authenticity.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe-token';
import { getServiceClient } from '@/lib/supabase/service';

/**
 * Validation schema for token query parameter
 */
const tokenSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

/**
 * GET handler for web-based unsubscribe
 * Renders an HTML page with unsubscribe confirmation
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const token = searchParams.get('token');

  // Validate token parameter
  const validation = tokenSchema.safeParse({ token });

  if (!validation.success) {
    return new NextResponse(
      `
<!DOCTYPE html>
<html>
<head>
  <title>Invalid Unsubscribe Link</title>
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
  </style>
</head>
<body>
  <h1 class="error">Invalid Unsubscribe Link</h1>
  <p>This unsubscribe link is invalid or missing required information.</p>
  <p><a href="/">Return to PickMyClass</a></p>
</body>
</html>
      `.trim(),
      {
        status: 400,
        headers: { 'Content-Type': 'text/html' },
      }
    );
  }

  // Verify token
  const userId = verifyUnsubscribeToken(validation.data.token);

  if (!userId) {
    return new NextResponse(
      `
<!DOCTYPE html>
<html>
<head>
  <title>Invalid Unsubscribe Token</title>
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
  </style>
</head>
<body>
  <h1 class="error">Invalid or Expired Token</h1>
  <p>This unsubscribe link is invalid or has expired.</p>
  <p>You can manage your notification preferences from your account settings.</p>
  <p><a href="/">Return to PickMyClass</a></p>
</body>
</html>
      `.trim(),
      {
        status: 400,
        headers: { 'Content-Type': 'text/html' },
      }
    );
  }

  // Unsubscribe user
  try {
    const supabase = getServiceClient();

    const { error } = await supabase
      .from('user_profiles')
      .update({
        notifications_enabled: false,
        unsubscribed_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    if (error) {
      console.error('[Unsubscribe] Database error:', error);
      throw error;
    }

    console.log(`[Unsubscribe] User ${userId} unsubscribed successfully`);

    return new NextResponse(
      `
<!DOCTYPE html>
<html>
<head>
  <title>Unsubscribed Successfully</title>
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
    .success { color: #059669; }
    a {
      color: #6366f1;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <h1 class="success">✓ Unsubscribed Successfully</h1>
  <p>You've been unsubscribed from all PickMyClass email notifications.</p>
  <p>You can re-enable notifications anytime from your account settings.</p>
  <p><a href="/">Return to PickMyClass</a></p>
</body>
</html>
      `.trim(),
      {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }
    );
  } catch (error) {
    console.error('[Unsubscribe] Error processing unsubscribe:', error);

    return new NextResponse(
      `
<!DOCTYPE html>
<html>
<head>
  <title>Unsubscribe Error</title>
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
  </style>
</head>
<body>
  <h1 class="error">Error Processing Unsubscribe</h1>
  <p>We encountered an error while processing your request.</p>
  <p>Please try again later or contact support.</p>
  <p><a href="/">Return to PickMyClass</a></p>
</body>
</html>
      `.trim(),
      {
        status: 500,
        headers: { 'Content-Type': 'text/html' },
      }
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
  const validation = tokenSchema.safeParse({ token });

  if (!validation.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid input',
        details: validation.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      },
      { status: 400 }
    );
  }

  // Verify token
  const userId = verifyUnsubscribeToken(validation.data.token);

  if (!userId) {
    return NextResponse.json(
      { success: false, error: 'Invalid or expired token' },
      { status: 400 }
    );
  }

  // Unsubscribe user
  try {
    const supabase = getServiceClient();

    const { error } = await supabase
      .from('user_profiles')
      .update({
        notifications_enabled: false,
        unsubscribed_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    if (error) {
      console.error('[Unsubscribe] Database error:', error);
      throw error;
    }

    console.log(`[Unsubscribe] User ${userId} unsubscribed via POST`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Unsubscribe] Error processing unsubscribe:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
