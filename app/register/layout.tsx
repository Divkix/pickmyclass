import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Create Account',
  description:
    'Create a free PickMyClass account to get email alerts when seats open in full ASU classes. Join 2,400+ Sun Devils.',
  alternates: {
    canonical: '/register',
  },
  robots: {
    index: false,
    follow: true,
  },
  openGraph: {
    title: 'Create Account',
    description:
      'Create a free PickMyClass account to get email alerts when seats open in full ASU classes. Join 2,400+ Sun Devils.',
  },
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
