'use client';
import { SignIn } from '@clerk/react';
import { Header } from '@/components/Header';

const appearance = { variables: { colorPrimary: '#7a0019', colorBackground: '#fff8e7' } };

export default function SignInPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <div className="flex flex-1 items-center justify-center p-4 [color-scheme:light]">
        <SignIn
          routing="path"
          path="/sign-in"
          signUpUrl="/sign-up"
          fallbackRedirectUrl="/dashboard"
          appearance={appearance}
        />
      </div>
    </div>
  );
}
