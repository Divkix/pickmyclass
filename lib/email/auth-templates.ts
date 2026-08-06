import { escapeHtml } from '@/lib/utils/escape-html';

type SupabaseAuthEmailAction = 'signup' | 'recovery' | 'email_change' | 'invite' | 'magiclink';

export interface SupabaseSendEmailHookPayload {
  user: {
    id: string;
    email?: string;
    new_email?: string;
  };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
    token_new: string;
    token_hash_new: string;
    old_email: string;
    old_phone: string;
    provider: string;
    factor_type: string;
  };
}

export interface AuthEmailMessage {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
}

interface BuildActionLinkOptions {
  supabaseUrl: string;
  tokenHash: string;
  actionType: SupabaseAuthEmailAction;
  redirectTo: string;
}

interface BuildAuthEmailOptions {
  supabaseUrl: string;
  from: string;
}

interface MessageContent {
  title: string;
  intro: string;
  button: string;
  subject: string;
}

const contentByAction: Record<SupabaseAuthEmailAction, MessageContent> = {
  signup: {
    subject: 'Verify your PickMyClass email',
    title: 'Verify your email',
    intro: 'Confirm your email address to start monitoring ASU classes with PickMyClass.',
    button: 'Verify email',
  },
  recovery: {
    subject: 'Reset your PickMyClass password',
    title: 'Reset your password',
    intro: 'Use this secure link to choose a new PickMyClass password.',
    button: 'Reset password',
  },
  email_change: {
    subject: 'Confirm your PickMyClass email change',
    title: 'Confirm your email change',
    intro: 'Confirm this email address change for your PickMyClass account.',
    button: 'Confirm email change',
  },
  invite: {
    subject: 'You have been invited to PickMyClass',
    title: 'Accept your invitation',
    intro: 'Use this secure link to finish setting up your PickMyClass account.',
    button: 'Accept invitation',
  },
  magiclink: {
    subject: 'Sign in to PickMyClass',
    title: 'Sign in to PickMyClass',
    intro: 'Use this secure link to sign in to your PickMyClass account.',
    button: 'Sign in',
  },
};

function getActionType(actionType: string): SupabaseAuthEmailAction | null {
  return Object.hasOwn(contentByAction, actionType)
    ? (actionType as SupabaseAuthEmailAction)
    : null;
}

export function buildSupabaseActionLink({
  supabaseUrl,
  tokenHash,
  actionType,
  redirectTo,
}: BuildActionLinkOptions): string {
  const url = new URL('/auth/v1/verify', supabaseUrl);
  url.searchParams.set('token_hash', tokenHash);
  url.searchParams.set('type', actionType);
  url.searchParams.set('redirect_to', redirectTo);
  return url.toString();
}

function buildMessage({
  to,
  from,
  actionType,
  link,
  token,
}: {
  to: string;
  from: string;
  actionType: SupabaseAuthEmailAction;
  link: string;
  token: string;
}): AuthEmailMessage {
  const content = contentByAction[actionType];
  const safeLink = escapeHtml(link);
  const safeToken = escapeHtml(token);

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
      <h1 style="font-size:24px;line-height:1.25;margin:0 0 16px;">${content.title}</h1>
      <p style="font-size:16px;line-height:1.6;margin:0 0 24px;">${content.intro}</p>
      <p style="margin:0 0 24px;">
        <a href="${safeLink}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:700;">${content.button}</a>
      </p>
      <p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 16px;">
        If the button does not work, copy and paste this link into your browser:
      </p>
      <p style="font-size:13px;line-height:1.5;word-break:break-all;color:#334155;margin:0 0 24px;">${safeLink}</p>
      <p style="font-size:13px;line-height:1.5;color:#64748b;margin:0;">
        Verification code: ${safeToken}
      </p>
    </div>
  </body>
</html>`;

  const text = `${content.title}

${content.intro}

${link}

Verification code: ${token}`;

  return {
    to,
    from,
    subject: content.subject,
    html,
    text,
  };
}

export function buildAuthEmailMessages(
  payload: SupabaseSendEmailHookPayload,
  options: BuildAuthEmailOptions
): AuthEmailMessage[] {
  const actionType = getActionType(payload.email_data.email_action_type);

  // Unknown action types (e.g. Supabase `*_notification` variants) are not
  // mapped to a template — never fall back to a bogus magiclink email.
  if (!actionType) {
    return [];
  }

  if (actionType === 'email_change') {
    const messages: AuthEmailMessage[] = [];

    if (payload.user.email && payload.email_data.token_hash_new) {
      messages.push(
        buildMessage({
          to: payload.user.email,
          from: options.from,
          actionType,
          token: payload.email_data.token,
          link: buildSupabaseActionLink({
            supabaseUrl: options.supabaseUrl,
            tokenHash: payload.email_data.token_hash_new,
            actionType,
            redirectTo: payload.email_data.redirect_to,
          }),
        })
      );
    }

    const newEmail = payload.user.new_email;
    if (newEmail && payload.email_data.token_hash) {
      messages.push(
        buildMessage({
          to: newEmail,
          from: options.from,
          actionType,
          token: payload.email_data.token_new || payload.email_data.token,
          link: buildSupabaseActionLink({
            supabaseUrl: options.supabaseUrl,
            tokenHash: payload.email_data.token_hash,
            actionType,
            redirectTo: payload.email_data.redirect_to,
          }),
        })
      );
    }

    return messages;
  }

  if (!payload.user.email) {
    return [];
  }

  return [
    buildMessage({
      to: payload.user.email,
      from: options.from,
      actionType,
      token: payload.email_data.token,
      link: buildSupabaseActionLink({
        supabaseUrl: options.supabaseUrl,
        tokenHash: payload.email_data.token_hash,
        actionType,
        redirectTo: payload.email_data.redirect_to,
      }),
    }),
  ];
}
