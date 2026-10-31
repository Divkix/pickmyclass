import { SignIn } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";
import { Header } from "@/components/Header";
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
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main
        id="main"
        tabIndex={-1}
        className="flex flex-1 items-center justify-center p-4 [color-scheme:light]"
      >
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
