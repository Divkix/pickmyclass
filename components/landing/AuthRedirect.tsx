'use client';

import { useRedirectIfAuthenticated } from '@/lib/hooks/useRedirectIfAuthenticated';

export function AuthRedirect({ children }: { children: React.ReactNode }) {
  useRedirectIfAuthenticated();

  return <>{children}</>;
}
