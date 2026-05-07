import { describe, expect, it } from 'vitest';
import {
  buildAuthEmailMessages,
  buildSupabaseActionLink,
  type SupabaseSendEmailHookPayload,
} from '@/lib/email/auth-templates';

const basePayload: SupabaseSendEmailHookPayload = {
  user: {
    id: 'user-123',
    email: 'student@example.com',
  },
  email_data: {
    token: '123456',
    token_hash: 'hash_abc',
    redirect_to: 'https://pickmyclass.app/auth/callback?next=/dashboard',
    email_action_type: 'signup',
    site_url: 'https://pickmyclass.app',
    token_new: '',
    token_hash_new: '',
    old_email: '',
    old_phone: '',
    provider: '',
    factor_type: '',
  },
};

describe('buildSupabaseActionLink', () => {
  it('builds a signup verification link that redirects through the app callback', () => {
    const link = buildSupabaseActionLink({
      supabaseUrl: 'https://project.supabase.co',
      tokenHash: 'hash_abc',
      actionType: 'signup',
      redirectTo: 'https://pickmyclass.app/auth/callback?next=/dashboard',
    });

    expect(link).toBe(
      'https://project.supabase.co/auth/v1/verify?token_hash=hash_abc&type=signup&redirect_to=https%3A%2F%2Fpickmyclass.app%2Fauth%2Fcallback%3Fnext%3D%2Fdashboard'
    );
  });
});

describe('buildAuthEmailMessages', () => {
  it('creates a signup verification email for the user address', () => {
    const messages = buildAuthEmailMessages(basePayload, {
      supabaseUrl: 'https://project.supabase.co',
      from: 'notifications@pickmyclass.app',
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      to: 'student@example.com',
      from: 'notifications@pickmyclass.app',
      subject: 'Verify your PickMyClass email',
    });
    expect(messages[0].html).toContain('Verify your email');
    expect(messages[0].html).toContain('hash_abc');
    expect(messages[0].text).toContain('https://project.supabase.co/auth/v1/verify');
  });

  it('creates a recovery email with reset-password callback redirect', () => {
    const messages = buildAuthEmailMessages(
      {
        ...basePayload,
        email_data: {
          ...basePayload.email_data,
          email_action_type: 'recovery',
          redirect_to: 'https://pickmyclass.app/auth/callback?next=/reset-password',
        },
      },
      {
        supabaseUrl: 'https://project.supabase.co',
        from: 'notifications@pickmyclass.app',
      }
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].subject).toBe('Reset your PickMyClass password');
    expect(messages[0].text).toContain('type=recovery');
    expect(messages[0].text).toContain('next%3D%2Freset-password');
  });

  it('sends secure email-change messages to current and new addresses with Supabase token mapping', () => {
    const messages = buildAuthEmailMessages(
      {
        ...basePayload,
        user: {
          id: 'user-123',
          email: 'old@example.com',
          new_email: 'new@example.com',
        },
        email_data: {
          ...basePayload.email_data,
          email_action_type: 'email_change',
          token: '111111',
          token_hash: 'new-address-hash',
          token_new: '222222',
          token_hash_new: 'current-address-hash',
          redirect_to: 'https://pickmyclass.app/settings',
        },
      },
      {
        supabaseUrl: 'https://project.supabase.co',
        from: 'notifications@pickmyclass.app',
      }
    );

    expect(messages).toHaveLength(2);
    expect(messages[0].to).toBe('old@example.com');
    expect(messages[0].text).toContain('token_hash=current-address-hash');
    expect(messages[1].to).toBe('new@example.com');
    expect(messages[1].text).toContain('token_hash=new-address-hash');
  });
});
