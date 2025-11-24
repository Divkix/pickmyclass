import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { AuthProvider } from '@/lib/contexts/AuthContext';
import { ThemeProvider } from '@/lib/contexts/ThemeContext';
import { Footer } from '@/components/Footer';
import { BottomNavWrapper } from '@/components/BottomNavWrapper';
import { Toaster } from 'sonner';
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
      </body>
    </html>
  );
}
