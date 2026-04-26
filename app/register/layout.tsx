import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Get Started — PickMyClass',
  description:
    'Create a free PickMyClass account and get email alerts when ASU class seats open up.',
  robots: {
    index: false,
    follow: false,
  },
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
