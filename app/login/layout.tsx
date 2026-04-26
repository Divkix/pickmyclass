import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign In — PickMyClass',
  description:
    'Sign in to your PickMyClass account to manage your ASU class watchlist and notifications.',
  robots: {
    index: false,
    follow: false,
  },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
