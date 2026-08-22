'use client';
import { SignIn } from '@clerk/clerk-react';

const appearance = { variables: { colorPrimary: '#7a0019', colorBackground: '#fff8e7' } };

export default function SignInPage() {
  return (
    <SignIn
      routing="path"
      path="/sign-in"
      signUpUrl="/sign-up"
      fallbackRedirectUrl="/dashboard"
      appearance={appearance}
    />
  );
}
