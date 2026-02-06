import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Script from 'next/script';
import { Toaster } from 'sonner';
import { BottomNavWrapper } from '@/components/BottomNavWrapper';
import { Footer } from '@/components/Footer';
import { AuthProvider } from '@/lib/contexts/AuthContext';
import { ThemeProvider } from '@/lib/contexts/ThemeContext';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://pickmyclass.app'),
  title: {
    default: 'PickMyClass — ASU Class Seat Notifications | Free for Sun Devils',
    template: '%s | PickMyClass',
  },
  description:
    'Get instant email alerts when seats open in full ASU classes. Trusted by 2,400+ Sun Devils with checks every 30 minutes. Free forever.',
  keywords: [
    'ASU class notifications',
    'Arizona State University',
    'seat availability',
    'class watch',
    'ASU registration',
    'Sun Devils',
    'MyASU',
    'ASU class search',
    'open seats ASU',
    'course alerts',
  ],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    siteName: 'PickMyClass',
    title: 'PickMyClass — ASU Class Seat Notifications',
    description:
      'Get instant email alerts when seats open in full ASU classes. Trusted by 2,400+ Sun Devils.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'PickMyClass — ASU Class Seat Notifications',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PickMyClass — ASU Class Seat Notifications',
    description:
      'Get instant email alerts when seats open in full ASU classes. Trusted by 2,400+ Sun Devils.',
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
  authors: [{ name: 'PickMyClass' }],
  creator: 'PickMyClass',
};

export const viewport: Viewport = {
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
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased flex flex-col min-h-screen`}
      >
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
          // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD structured data, no user input
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Organization',
              name: 'PickMyClass',
              url: 'https://pickmyclass.app',
              logo: 'https://pickmyclass.app/favicon.svg',
              contactPoint: {
                '@type': 'ContactPoint',
                email: 'support@pickmyclass.app',
                contactType: 'customer service',
              },
            }),
          }}
        />
      </body>
    </html>
  );
}
