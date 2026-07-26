import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { Webhook } from 'standardwebhooks';
import {
  buildAuthEmailMessages,
  type SupabaseSendEmailHookPayload,
} from '@/lib/email/auth-templates';
import { SUPABASE_URL } from '@/lib/supabase/config';
import { log } from '@/lib/log';

function normalizeHookSecret(secret: string): string {
  return secret.startsWith('v1,') ? secret.slice(3) : secret;
}

// Intentional exception: response shape is dictated by the Supabase Send Email Hook
// (standardwebhooks protocol) — not the ok()/fail() envelope.
export async function POST(request: Request) {
  const cfEnv = env as unknown as {
    EMAIL?: SendEmail;
    NOTIFICATION_FROM_EMAIL?: string;
    SUPABASE_SEND_EMAIL_HOOK_SECRET?: string;
  };
  const hookSecret = cfEnv.SUPABASE_SEND_EMAIL_HOOK_SECRET;
  const emailBinding = cfEnv.EMAIL;
  const fromEmail = cfEnv.NOTIFICATION_FROM_EMAIL || 'notifications@pickmyclass.app';

  if (!hookSecret || !emailBinding) {
    log('AuthEmailHook').error('Missing required email hook configuration');
    return NextResponse.json({ error: 'Email hook is not configured' }, { status: 500 });
  }

  const payloadText = await request.text();
  let payload: SupabaseSendEmailHookPayload;

  try {
    const webhook = new Webhook(normalizeHookSecret(hookSecret));
    payload = webhook.verify(
      payloadText,
      Object.fromEntries(request.headers)
    ) as SupabaseSendEmailHookPayload;
  } catch (error) {
    log('AuthEmailHook').warn('Invalid webhook signature:', error);
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
  }

  const messages = buildAuthEmailMessages(payload, {
    supabaseUrl: SUPABASE_URL,
    from: fromEmail,
  });

  if (messages.length === 0) {
    log('AuthEmailHook').error('Hook payload did not produce any email messages');
    return NextResponse.json({ error: 'No email recipient found' }, { status: 400 });
  }

  try {
    for (const message of messages) {
      await emailBinding.send(message);
    }
  } catch (error) {
    log('AuthEmailHook').error('Cloudflare Email Sending failed:', error);
    return NextResponse.json({ error: 'Failed to send auth email' }, { status: 502 });
  }

  return NextResponse.json({});
}
