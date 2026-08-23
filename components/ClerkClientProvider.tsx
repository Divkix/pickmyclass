'use client';

import { ClerkProvider } from '@clerk/react';
import { CLERK_PUBLISHABLE_KEY } from '@/lib/clerk/config';

export function ClerkClientProvider({ children }: { children: React.ReactNode }) {
  return <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>{children}</ClerkProvider>;
}
