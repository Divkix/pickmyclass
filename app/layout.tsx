import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Toaster } from 'sonner';
import { BottomNavWrapper } from '@/components/BottomNavWrapper';
import { Footer } from '@/components/Footer';
import { AuthProvider } from '@/lib/contexts/AuthContext';
import { ThemeProvider } from '@/lib/contexts/ThemeContext';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://pickmyclass.app'),
  title: {
    default: 'PickMyClass — Free ASU Class Seat Tracker & Open Seat Alerts',
    template: '%s | PickMyClass',
  },
  description:
    'Free ASU class seat tracker and notification service. Get email alerts when seats open in full ASU classes. Trusted by 2,400+ Sun Devils — checks every 30 minutes.',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    siteName: 'PickMyClass',
    url: 'https://pickmyclass.app/',
    title: 'PickMyClass — Free ASU Class Seat Tracker & Open Seat Alerts',
    description:
      'Free ASU class seat tracker. Get email alerts when seats open in full ASU classes. Trusted by 2,400+ Sun Devils.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'PickMyClass — Free ASU Class Seat Tracker & Open Seat Alerts',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PickMyClass — Free ASU Class Seat Tracker & Open Seat Alerts',
    description:
      'Free ASU class seat tracker. Get email alerts when seats open in full ASU classes. Trusted by 2,400+ Sun Devils.',
    images: ['/og-image.png'],
  },
  alternates: {
    canonical: '/',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: '/favicon.svg',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/manifest.json',
  authors: [{ name: 'PickMyClass' }],
  creator: 'PickMyClass',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#6366F1' },
    { media: '(prefers-color-scheme: dark)', color: '#6366F1' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head />
      <body className="font-sans antialiased flex flex-col min-h-screen">
        <ThemeProvider>
          <AuthProvider>
            <div className="flex-1 pb-20 md:pb-0">{children}</div>
            <Footer />
            <BottomNavWrapper />
            <Toaster position="top-center" richColors />
          </AuthProvider>
        </ThemeProvider>
        <Script
          src="https://analytics.divkix.me/s.js"
          data-website-id="f2ef7132-055d-4c9a-8040-dcd07f22e84d"
          strategy="afterInteractive"
        />
        <script
          type="application/ld+json"
          // static JSON-LD structured data, no user input
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Organization',
              name: 'PickMyClass',
              url: 'https://pickmyclass.app',
              logo: 'https://pickmyclass.app/apple-touch-icon.png',
              description: 'Free ASU class seat notification service',
              contactPoint: {
                '@type': 'ContactPoint',
                email: 'support@pickmyclass.app',
                contactType: 'customer service',
              },
            }),
          }}
        />
        <script
          type="application/ld+json"
          // static JSON-LD structured data, no user input
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebSite',
              name: 'PickMyClass',
              url: 'https://pickmyclass.app',
            }),
          }}
        />
      </body>
    </html>
  );
}
