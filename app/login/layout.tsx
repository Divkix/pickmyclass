import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign In',
  description:
    'Sign in to PickMyClass to manage your ASU class watchlist and get seat availability alerts.',
  alternates: {
    canonical: '/login',
  },
  robots: {
    index: false,
    follow: true,
  },
  openGraph: {
    title: 'Sign In',
    description:
      'Sign in to PickMyClass to manage your ASU class watchlist and get seat availability alerts.',
  },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
