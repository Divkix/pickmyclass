/**
 * Resend Webhook Handler
 *
 * Handles email delivery events from Resend:
 * - email.bounced: Hard bounces indicate invalid email addresses
 * - email.complained: Spam complaints trigger auto-unsubscribe
 * - email.delivered: Success confirmation (optional logging)
 *
 * Security: Verifies webhook signature from Resend
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { getServiceClient } from '@/lib/supabase/service'

/**
 * Resend webhook event types
 */
interface ResendWebhookEvent {
  type: 'email.bounced' | 'email.complained' | 'email.delivered' | 'email.opened' | 'email.clicked'
  created_at: string
  data: {
    email_id: string
    from: string
    to: string[]
    subject: string
    created_at: string
    // Bounce-specific fields
    bounce_type?: 'hard' | 'soft'
    bounce_message?: string
  }
}

/**
 * Verify Resend webhook signature
 * Signature is HMAC-SHA256 of request body using webhook secret
 */
function verifyWebhookSignature(
  body: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) {
    console.warn('[Resend Webhook] Missing signature header')
    return false
  }

  // Calculate expected signature
  const expectedSignature = createHmac('sha256', secret).update(body).digest('hex')

  // Constant-time comparison to prevent timing attacks
  if (signature.length !== expectedSignature.length) {
    return false
  }

  let mismatch = 0
  for (let i = 0; i < signature.length; i++) {
    mismatch |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i)
  }

  return mismatch === 0
}

/**
 * Get user ID from email address using Supabase Auth API
 */
async function getUserIdFromEmail(email: string): Promise<string | null> {
  const supabase = getServiceClient()

  // Use Supabase Admin API to get user by email
  // Service role client has admin privileges
  const { data, error } = await supabase.auth.admin.listUsers()

  if (error) {
    console.error('[Resend Webhook] Error fetching users:', error)
    return null
  }

  // Find user with matching email
  const user = data.users.find(u => u.email === email)

  if (!user) {
    console.warn(`[Resend Webhook] User not found for email: ${email}`)
    return null
  }

  return user.id
}

/**
 * Handle hard bounce event
 * Mark email as bounced and disable notifications
 */
async function handleBounce(event: ResendWebhookEvent): Promise<void> {
  const recipientEmail = event.data.to[0]

  console.log(
    `[Resend Webhook] Bounce detected for ${recipientEmail} (type: ${event.data.bounce_type})`
  )

  // Only handle hard bounces (invalid email addresses)
  if (event.data.bounce_type !== 'hard') {
    console.log('[Resend Webhook] Ignoring soft bounce')
    return
  }

  // Get user ID from email
  const userId = await getUserIdFromEmail(recipientEmail)
  if (!userId) {
    console.warn('[Resend Webhook] Cannot mark bounce - user not found')
    return
  }

  // Mark email as bounced and disable notifications
  const supabase = getServiceClient()
  const { error } = await supabase
    .from('user_profiles')
    .update({
      email_bounced: true,
      email_bounced_at: new Date().toISOString(),
      notifications_enabled: false,
    })
    .eq('user_id', userId)

  if (error) {
    console.error('[Resend Webhook] Error updating bounce status:', error)
    throw error
  }

  console.log(`[Resend Webhook] Marked email as bounced for user ${userId}`)
}

/**
 * Handle spam complaint event
 * Auto-unsubscribe user per CAN-SPAM requirements
 */
async function handleSpamComplaint(event: ResendWebhookEvent): Promise<void> {
  const recipientEmail = event.data.to[0]

  console.log(`[Resend Webhook] Spam complaint from ${recipientEmail}`)

  // Get user ID from email
  const userId = await getUserIdFromEmail(recipientEmail)
  if (!userId) {
    console.warn('[Resend Webhook] Cannot process spam complaint - user not found')
    return
  }

  // Mark as spam complained and auto-unsubscribe
  const supabase = getServiceClient()
  const { error } = await supabase
    .from('user_profiles')
    .update({
      spam_complained: true,
      spam_complained_at: new Date().toISOString(),
      notifications_enabled: false,
      unsubscribed_at: new Date().toISOString(),
    })
    .eq('user_id', userId)

  if (error) {
    console.error('[Resend Webhook] Error updating spam complaint status:', error)
    throw error
  }

  console.log(`[Resend Webhook] Auto-unsubscribed user ${userId} due to spam complaint`)
}

/**
 * POST handler for Resend webhooks
 */
export async function POST(request: NextRequest) {
  try {
    // Get webhook secret from environment
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET

    if (!webhookSecret) {
      console.error('[Resend Webhook] RESEND_WEBHOOK_SECRET not configured')
      return NextResponse.json(
        { success: false, error: 'Webhook not configured' },
        { status: 500 }
      )
    }

    // Get request body as text for signature verification
    const body = await request.text()
    const signature = request.headers.get('resend-signature')

    // Verify webhook signature
    if (!verifyWebhookSignature(body, signature, webhookSecret)) {
      console.warn('[Resend Webhook] Invalid signature')
      return NextResponse.json(
        { success: false, error: 'Invalid signature' },
        { status: 401 }
      )
    }

    // Parse event
    const event: ResendWebhookEvent = JSON.parse(body)

    console.log(`[Resend Webhook] Received event: ${event.type}`)

    // Handle different event types
    switch (event.type) {
      case 'email.bounced':
        await handleBounce(event)
        break

      case 'email.complained':
        await handleSpamComplaint(event)
        break

      case 'email.delivered':
        // Optional: Log successful deliveries
        console.log(`[Resend Webhook] Email delivered: ${event.data.email_id}`)
        break

      default:
        console.log(`[Resend Webhook] Unhandled event type: ${event.type}`)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Resend Webhook] Error processing webhook:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}

/**
 * GET handler - return webhook configuration info
 */
export async function GET() {
  return NextResponse.json({
    name: 'PickMyClass Resend Webhook',
    events: ['email.bounced', 'email.complained', 'email.delivered'],
    status: process.env.RESEND_WEBHOOK_SECRET ? 'configured' : 'not configured',
  })
}
