'use client';

import { AuthenticateWithRedirectCallback } from '@clerk/clerk-react';
import { Header } from '@/components/Header';

/**
 * OAuth handshake page. The login/register pages start Google OAuth with
 * clerk-react's `authenticateWithRedirect({ redirectUrl: '/auth/callback',
 * redirectUrlComplete: '/auth/post-oauth?...' })`; Google returns here, this
 * component completes the flow against Clerk's FAPI (setting the session
 * cookies), and clerk-js then navigates to the post-oauth route which handles
 * consent bookkeeping and the final `next` redirect.
 */
export default function AuthCallbackPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4">
          <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Completing sign-in…</p>
        </div>
      </div>
      <AuthenticateWithRedirectCallback />
    </div>
  );
}
