import { type NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { z } from 'zod';
import { getServiceClient } from '@/lib/supabase/service';

/**
 * Resend webhook event payload (subset used by PickMyClass).
 * Supports both current and legacy bounce payload formats.
 */
const resendWebhookEventSchema = z.object({
  type: z.enum([
    'email.bounced',
    'email.complained',
    'email.delivered',
    'email.opened',
    'email.clicked',
  ]),
  created_at: z.string().optional(),
  data: z
    .object({
      email_id: z.string().optional(),
      from: z.string().optional(),
      to: z.array(z.string()).default([]),
      subject: z.string().optional(),
      created_at: z.string().optional(),
      // Legacy Resend payload shape (old handler expected this)
      bounce_type: z.string().optional(),
      // Current Resend payload shape
      bounce: z
        .object({
          message: z.string().optional(),
          subType: z.string().optional(),
          type: z.string().optional(),
        })
        .optional(),
    })
    .passthrough(),
});

type ResendWebhookEvent = z.infer<typeof resendWebhookEventSchema>;

/**
 * Verify webhook signature and return parsed payload if valid.
 * Uses Svix headers (svix-id, svix-timestamp, svix-signature) for verification.
 */
function verifyAndParseWebhookPayload(
  request: NextRequest,
  body: string,
  webhookSecret: string
): unknown | null {
  const svixId = request.headers.get('svix-id');
  const svixTimestamp = request.headers.get('svix-timestamp');
  const svixSignature = request.headers.get('svix-signature');

  if (svixId && svixTimestamp && svixSignature) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY || 'placeholder-for-webhook-verify');
      return resend.webhooks.verify({
        payload: body,
        headers: {
          id: svixId,
          timestamp: svixTimestamp,
          signature: svixSignature,
        },
        webhookSecret,
      });
    } catch (error) {
      console.warn('[Resend Webhook] Svix signature verification failed:', error);
      return null;
    }
  }

  console.warn('[Resend Webhook] Missing Svix signature headers');
  return null;
}

/**
 * Extract the primary recipient email from a webhook event.
 */
function getPrimaryRecipient(event: ResendWebhookEvent): string | null {
  const recipient = event.data.to.find((email) => email.trim().length > 0);
  return recipient ? recipient.trim().toLowerCase() : null;
}

/**
 * Determine whether a bounce event represents a hard/permanent bounce.
 */
function isHardBounce(event: ResendWebhookEvent): boolean {
  const legacyType = event.data.bounce_type?.toLowerCase();
  if (legacyType === 'hard') return true;
  if (legacyType === 'soft') return false;

  const modernType = event.data.bounce?.type?.toLowerCase();
  if (!modernType) return false;

  // Resend currently uses "Permanent"/"Transient" in bounce.type
  return modernType === 'permanent' || modernType === 'hard';
}

/**
 * Get user ID from email address using Supabase Auth API.
 */
async function getUserIdFromEmail(email: string): Promise<string | null> {
  const supabase = getServiceClient();

  const normalizedEmail = email.trim().toLowerCase();

  // Query auth.users table via service role
  // Uses 'as any' cast because generated types only include public/graphql_public schemas,
  // but auth schema is accessible via service role client
  // biome-ignore lint/suspicious/noExplicitAny: Supabase generated types don't expose auth schema
  const { data: user, error } = (await (supabase as any)
    .schema('auth')
    .from('users')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle()) as { data: { id: string } | null; error: Error | null };

  if (error || !user?.id) {
    console.warn(`[Resend Webhook] User not found for email: ${normalizedEmail}`);
    if (error) {
      console.error('[Resend Webhook] Error fetching user by email:', error);
    }
    return null;
  }

  return user.id;
}

/**
 * Handle hard bounce event
 * Mark email as bounced and disable notifications
 */
async function handleBounce(event: ResendWebhookEvent): Promise<void> {
  const recipientEmail = getPrimaryRecipient(event);
  if (!recipientEmail) {
    console.warn('[Resend Webhook] Bounce event missing recipient');
    return;
  }

  console.log(
    `[Resend Webhook] Bounce detected for ${recipientEmail} (type: ${event.data.bounce_type ?? event.data.bounce?.type ?? 'unknown'})`
  );

  // Only handle hard/permanent bounces (invalid email addresses).
  if (!isHardBounce(event)) {
    console.log('[Resend Webhook] Ignoring soft bounce');
    return;
  }

  // Get user ID from email
  const userId = await getUserIdFromEmail(recipientEmail);
  if (!userId) {
    console.warn('[Resend Webhook] Cannot mark bounce - user not found');
    return;
  }

  // Mark email as bounced and disable notifications
  const supabase = getServiceClient();
  const { error } = await supabase
    .from('user_profiles')
    .update({
      email_bounced: true,
      email_bounced_at: new Date().toISOString(),
      notifications_enabled: false,
    })
    .eq('user_id', userId);

  if (error) {
    console.error('[Resend Webhook] Error updating bounce status:', error);
    throw error;
  }

  console.log(`[Resend Webhook] Marked email as bounced for user ${userId}`);
}

/**
 * Handle spam complaint event
 * Auto-unsubscribe user per CAN-SPAM requirements
 */
async function handleSpamComplaint(event: ResendWebhookEvent): Promise<void> {
  const recipientEmail = getPrimaryRecipient(event);
  if (!recipientEmail) {
    console.warn('[Resend Webhook] Spam complaint event missing recipient');
    return;
  }

  console.log(`[Resend Webhook] Spam complaint from ${recipientEmail}`);

  // Get user ID from email
  const userId = await getUserIdFromEmail(recipientEmail);
  if (!userId) {
    console.warn('[Resend Webhook] Cannot process spam complaint - user not found');
    return;
  }

  // Mark as spam complained and auto-unsubscribe
  const supabase = getServiceClient();
  const { error } = await supabase
    .from('user_profiles')
    .update({
      spam_complained: true,
      spam_complained_at: new Date().toISOString(),
      notifications_enabled: false,
      unsubscribed_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  if (error) {
    console.error('[Resend Webhook] Error updating spam complaint status:', error);
    throw error;
  }

  console.log(`[Resend Webhook] Auto-unsubscribed user ${userId} due to spam complaint`);
}

/**
 * Handle email opened event
 * Records engagement and re-enables notifications if user was disabled due to low engagement
 */
async function handleEmailOpened(event: ResendWebhookEvent): Promise<void> {
  const recipientEmail = getPrimaryRecipient(event);
  if (!recipientEmail) {
    console.warn('[Resend Webhook] Engagement event missing recipient');
    return;
  }

  console.log(`[Resend Webhook] Email opened by ${recipientEmail}`);

  // Get user ID from email
  const userId = await getUserIdFromEmail(recipientEmail);
  if (!userId) {
    console.warn('[Resend Webhook] Cannot record email open - user not found');
    return;
  }

  // Record engagement open via atomic RPC function
  const supabase = getServiceClient();
  const { error } = await supabase.rpc('record_engagement_open', {
    p_user_id: userId,
  });

  if (error) {
    console.error('[Resend Webhook] Error recording email open:', error);
    throw error;
  }

  console.log(`[Resend Webhook] Recorded email open for user ${userId}`);
}

/**
 * POST handler for Resend webhooks
 */
export async function POST(request: NextRequest) {
  try {
    // Get webhook secret from environment
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error(
        '[Resend Webhook] CRITICAL: RESEND_WEBHOOK_SECRET not configured in environment'
      );
      console.error(
        '[Resend Webhook] Set this in Cloudflare Dashboard: Workers & Pages → Settings → Variables → Encrypt'
      );
      return NextResponse.json(
        { success: false, error: 'Webhook not configured' },
        { status: 500 }
      );
    }

    // Get request body as text for signature verification/parsing
    const body = await request.text();
    const rawPayload = verifyAndParseWebhookPayload(request, body, webhookSecret);

    if (!rawPayload) {
      console.warn('[Resend Webhook] FAILED: Invalid signature or payload');
      return NextResponse.json({ success: false, error: 'Invalid signature' }, { status: 401 });
    }

    const parsedEvent = resendWebhookEventSchema.safeParse(rawPayload);
    if (!parsedEvent.success) {
      console.warn('[Resend Webhook] Ignoring payload with unexpected shape', parsedEvent.error);
      return NextResponse.json({ success: true, ignored: true });
    }

    const event = parsedEvent.data;
    const recipientEmail = getPrimaryRecipient(event);

    console.log(
      `[Resend Webhook] Processing event: ${event.type}${recipientEmail ? ` for ${recipientEmail}` : ''}`
    );

    // Handle different event types
    switch (event.type) {
      case 'email.bounced':
        await handleBounce(event);
        console.log(`[Resend Webhook] ✓ Bounce event processed`);
        break;

      case 'email.complained':
        await handleSpamComplaint(event);
        console.log('[Resend Webhook] ✓ Spam complaint processed');
        break;

      case 'email.delivered':
        // Optional: Log successful deliveries
        console.log(`[Resend Webhook] ✓ Email delivered: ${event.data.email_id}`);
        break;

      case 'email.opened':
      case 'email.clicked':
        // Both events indicate user engagement with email
        await handleEmailOpened(event);
        console.log('[Resend Webhook] ✓ Email engagement recorded');
        break;

      default:
        console.log(`[Resend Webhook] ⚠ Unhandled event type: ${event.type}`);
    }

    console.log(`[Resend Webhook] ✓ Webhook processed successfully`);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Resend Webhook] ✗ ERROR processing webhook:', error);
    console.error(
      '[Resend Webhook] Error details:',
      error instanceof Error ? error.stack : String(error)
    );
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

/**
 * GET handler - return webhook configuration info
 */
export async function GET() {
  return NextResponse.json({
    name: 'PickMyClass Resend Webhook',
    events: [
      'email.bounced',
      'email.complained',
      'email.delivered',
      'email.opened',
      'email.clicked',
    ],
    status: process.env.RESEND_WEBHOOK_SECRET ? 'configured' : 'not configured',
  });
}
