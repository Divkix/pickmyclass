import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    template: '%s | PickMyClass Blog',
    default: 'Blog — ASU Class Registration Tips & Guides',
  },
  description:
    'Tips, guides, and strategies for ASU class registration. Learn how to build the perfect schedule and never miss an open seat.',
  alternates: {
    canonical: '/blog',
  },
};

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return children;
}
