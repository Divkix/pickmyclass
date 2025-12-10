import type { Metadata } from 'next';
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
  title: 'PickMyClass',
  description: 'Class selection made easy',
  icons: {
    icon: '/favicon.svg',
  },
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
        />
      </body>
    </html>
  );
}
