/**
 * Unsubscribe API Endpoint
 *
 * Handles one-click unsubscribe from email notifications (CAN-SPAM compliance).
 * Accepts signed tokens to verify authenticity.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe-token'
import { getServiceClient } from '@/lib/supabase/service'
import { z } from 'zod'
import { createHash } from 'crypto'

/**
 * Validation schema for token query parameter
 */
const tokenSchema = z.object({
  token: z.string().min(1, 'Token is required'),
})

/**
 * Hash the token for storage (don't store raw tokens)
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Check if token has already been used and mark it as used atomically
 * Returns true if token was successfully marked as used (first use)
 * Returns false if token was already used
 */
async function tryUseToken(
  token: string,
  userId: string
): Promise<{ success: boolean; alreadyUsed: boolean }> {
  const supabase = getServiceClient()
  const tokenHash = hashToken(token)

  // Try to insert - will fail if token already used (unique constraint)
  const { error } = await supabase.from('used_unsubscribe_tokens').insert({
    token_hash: tokenHash,
    user_id: userId,
  })

  if (error) {
    // Unique constraint violation = token already used
    if (error.code === '23505') {
      return { success: false, alreadyUsed: true }
    }
    // Other error - fail closed for security
    console.error('[Unsubscribe] Error recording token use:', error)
    return { success: false, alreadyUsed: false }
  }

  return { success: true, alreadyUsed: false }
}

/**
 * GET handler for web-based unsubscribe
 * Renders an HTML page with unsubscribe confirmation
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const token = searchParams.get('token')

  // Validate token parameter
  const validation = tokenSchema.safeParse({ token })

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
    )
  }

  // Verify token
  const userId = verifyUnsubscribeToken(validation.data.token)

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
    )
  }

  // Check if token was already used
  const { success: tokenSuccess, alreadyUsed } = await tryUseToken(validation.data.token, userId)

  if (alreadyUsed) {
    return new NextResponse(
      `
<!DOCTYPE html>
<html>
<head>
  <title>Already Unsubscribed</title>
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
    .info { color: #2563eb; }
  </style>
</head>
<body>
  <h1 class="info">Already Processed</h1>
  <p>This unsubscribe link has already been used.</p>
  <p>You can manage your notification preferences from your account settings.</p>
  <p><a href="/">Return to PickMyClass</a></p>
</body>
</html>
      `.trim(),
      {
        status: 400,
        headers: { 'Content-Type': 'text/html' },
      }
    )
  }

  // If token recording failed (not due to duplicate), fail closed
  if (!tokenSuccess) {
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
    )
  }

  // Unsubscribe user
  try {
    const supabase = getServiceClient()

    const { error } = await supabase
      .from('user_profiles')
      .update({
        notifications_enabled: false,
        unsubscribed_at: new Date().toISOString(),
      })
      .eq('user_id', userId)

    if (error) {
      console.error('[Unsubscribe] Database error:', error)
      throw error
    }

    console.log(`[Unsubscribe] User ${userId} unsubscribed successfully`)

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
  <h1 class="success">Unsubscribed Successfully</h1>
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
    )
  } catch (error) {
    console.error('[Unsubscribe] Error processing unsubscribe:', error)

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
    )
  }
}

/**
 * POST handler for one-click unsubscribe (RFC 8058)
 * Used by email clients that support List-Unsubscribe-Post
 */
export async function POST(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const token = searchParams.get('token')

  // Validate token parameter
  const validation = tokenSchema.safeParse({ token })

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
    )
  }

  // Verify token
  const userId = verifyUnsubscribeToken(validation.data.token)

  if (!userId) {
    return NextResponse.json(
      { success: false, error: 'Invalid or expired token' },
      { status: 400 }
    )
  }

  // Check if token was already used
  const { success: tokenSuccess, alreadyUsed } = await tryUseToken(validation.data.token, userId)

  if (alreadyUsed) {
    return NextResponse.json(
      { success: false, error: 'Token already used' },
      { status: 400 }
    )
  }

  // If token recording failed (not due to duplicate), fail closed
  if (!tokenSuccess) {
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }

  // Unsubscribe user
  try {
    const supabase = getServiceClient()

    const { error } = await supabase
      .from('user_profiles')
      .update({
        notifications_enabled: false,
        unsubscribed_at: new Date().toISOString(),
      })
      .eq('user_id', userId)

    if (error) {
      console.error('[Unsubscribe] Database error:', error)
      throw error
    }

    console.log(`[Unsubscribe] User ${userId} unsubscribed via POST`)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Unsubscribe] Error processing unsubscribe:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
