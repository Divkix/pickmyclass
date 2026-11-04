import { SignIn } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Header } from "@/components/Header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { pageHead } from "@/lib/seo/head";

// Keep Clerk's brand colors, with readable fields and touch targets on mobile.
const appearance = {
  variables: { colorPrimary: "#7a0019", colorBackground: "#fff8e7", fontSize: "16px" },
  elements: {
    formFieldInput: { minHeight: "44px", fontSize: "16px" },
    formButtonPrimary: { minHeight: "44px", fontSize: "16px" },
    formFieldInputShowPasswordButton: { minHeight: "44px", minWidth: "44px" },
    socialButtonsBlockButton: { minHeight: "44px" },
  },
};

export const Route = createFileRoute("/sign-in")({
  // The request gate redirects disabled accounts here after signing them out.
  validateSearch: z.object({ error: z.string().optional() }),
  head: () =>
    pageHead({
      absoluteTitle: "Sign In — PickMyClass",
      description:
        "Sign in to your PickMyClass account to manage your ASU class watchlist and notifications.",
      robots: "noindex, nofollow",
    }),
  component: SignInPage,
});

function SignInPage() {
  const { error } = Route.useSearch();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main
        id="main"
        tabIndex={-1}
        className="flex flex-1 flex-col items-center justify-center gap-4 p-4 [color-scheme:light]"
      >
        {error === "account_disabled" && (
          <Alert className="max-w-sm border-destructive/30 bg-destructive/10 text-destructive">
            <AlertDescription>
              <p>This account has been disabled.</p>
              <p>
                Contact{" "}
                <a href="mailto:support@pickmyclass.app" className="text-primary underline">
                  support@pickmyclass.app
                </a>{" "}
                for help.
              </p>
            </AlertDescription>
          </Alert>
        )}
        <SignIn
          routing="path"
          path="/sign-in"
          signUpUrl="/sign-up"
          fallbackRedirectUrl="/dashboard"
          appearance={appearance}
        />
      </main>
    </div>
  );
}
