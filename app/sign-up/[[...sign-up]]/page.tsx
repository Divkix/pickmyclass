'use client';
import { SignUp } from '@clerk/react';
import { Header } from '@/components/Header';

const appearance = { variables: { colorPrimary: '#7a0019', colorBackground: '#fff8e7' } };

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <div className="flex flex-1 items-center justify-center p-4 [color-scheme:light]">
        <SignUp
          routing="path"
          path="/sign-up"
          signInUrl="/sign-in"
          fallbackRedirectUrl="/auth/post-oauth?next=%2Fdashboard"
          appearance={appearance}
        />
      </div>
    </div>
  );
}
