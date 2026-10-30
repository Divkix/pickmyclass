import { SignUp } from "@clerk/tanstack-react-start";
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

export const Route = createFileRoute("/sign-up")({
  head: () =>
    pageHead({
      absoluteTitle: "Sign Up — PickMyClass",
      description:
        "Create a PickMyClass account to get notified when seats open in your ASU classes.",
      robots: "noindex, nofollow",
    }),
  component: SignUpPage,
});

function SignUpPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main
        id="main"
        tabIndex={-1}
        className="flex flex-1 items-center justify-center p-4 [color-scheme:light]"
      >
        <SignUp
          routing="path"
          path="/sign-up"
          signInUrl="/sign-in"
          fallbackRedirectUrl="/auth/post-oauth?next=%2Fdashboard"
          appearance={appearance}
        />
      </main>
    </div>
  );
}
