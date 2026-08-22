import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign Up — PickMyClass',
  description: 'Create a PickMyClass account to get notified when seats open in your ASU classes.',
  robots: {
    index: false,
    follow: false,
  },
};

export default function SignUpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
