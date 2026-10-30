/// <reference types="vite/client" />
import { ClerkProvider } from "@clerk/tanstack-react-start";
import {
  HeadContent,
  Scripts,
  createRootRoute,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { BottomNav } from "@/components/BottomNav";
import { ErrorPage } from "@/components/ErrorPage";
import { Footer } from "@/components/Footer";
import { NotFound } from "@/components/NotFound";
import { SkipToContent } from "@/components/SkipToContent";
import { JsonLd } from "@/components/landing/JsonLd";
import { AuthProvider } from "@/lib/contexts/AuthContext";
import { NOT_FOUND_HEAD, SITE_LINKS, SITE_META } from "@/lib/seo/head";
import appCss from "../globals.css?url";

export const Route = createRootRoute({
  head: ({ matches }) => ({
    // Later entries win, so a 404 replaces the site title and description.
    meta: matches.some((match) => match._notFound || match.status === "notFound")
      ? [...SITE_META, ...NOT_FOUND_HEAD.meta]
      : SITE_META,
    links: [
      { rel: "stylesheet", href: appCss },
      // Hero text paints before the font arrives otherwise, and the swap shifts layout (CLS).
      {
        rel: "preload",
        href: "/fonts/Geist-Variable.woff2",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      ...SITE_LINKS,
    ],
  }),
  shellComponent: RootDocument,
  errorComponent: ErrorPage,
  notFoundComponent: NotFound,
});

// Router pending state includes lazy chunks. CSS waits 250ms to avoid flashing on fast
// navigations, then hides immediately on completion; the static bar has no motion.
function NavigationProgress() {
  const isPending = useRouterState({ select: (state) => state.status === "pending" });

  return (
    <progress
      aria-label="Loading page"
      aria-hidden={!isPending}
      data-pending={isPending}
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-1 w-full appearance-none border-0 bg-primary opacity-0 transition-opacity duration-0 data-[pending=true]:opacity-100 data-[pending=true]:delay-250 [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-primary"
    />
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  // The gate's per-request nonce, for next-themes' inline script; unset in the browser.
  const nonce = useRouter().options.ssr?.nonce;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="font-sans antialiased flex flex-col min-h-screen">
        <SkipToContent />
        <NavigationProgress />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          nonce={nonce}
        >
          <ClerkProvider>
            <AuthProvider>
              <div className="flex-1 pb-20 md:pb-0">{children}</div>
              <Footer />
              <BottomNav />
              <Toaster position="top-center" richColors />
            </AuthProvider>
          </ClerkProvider>
        </ThemeProvider>
        <script
          src="https://analytics.divkix.me/s.js"
          data-website-id="f2ef7132-055d-4c9a-8040-dcd07f22e84d"
          data-performance="true"
          defer
        />
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "Organization",
            name: "PickMyClass",
            alternateName: ["Pick My Class", "Pick A Class", "PickAClass", "PickaClass"],
            url: "https://pickmyclass.app",
            logo: "https://pickmyclass.app/apple-touch-icon.png",
            description: "Free ASU class seat notification service",
            sameAs: ["https://github.com/Divkix/pickmyclass"],
            contactPoint: {
              "@type": "ContactPoint",
              email: "support@pickmyclass.app",
              contactType: "customer service",
            },
            address: {
              "@type": "PostalAddress",
              addressLocality: "Tempe",
              addressRegion: "AZ",
              addressCountry: "US",
            },
          }}
        />
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: "PickMyClass",
            alternateName: ["Pick My Class", "Pick A Class", "PickAClass"],
            url: "https://pickmyclass.app",
          }}
        />
        <Scripts />
      </body>
    </html>
  );
}
