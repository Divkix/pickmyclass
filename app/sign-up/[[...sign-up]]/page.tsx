'use client';
import { SignUp } from '@clerk/clerk-react';

const appearance = { variables: { colorPrimary: '#7a0019', colorBackground: '#fff8e7' } };

export default function SignUpPage() {
  return (
    <SignUp
      routing="path"
      path="/sign-up"
      signInUrl="/sign-in"
      fallbackRedirectUrl="/auth/post-oauth?next=%2Fdashboard"
      appearance={appearance}
    />
  );
}
