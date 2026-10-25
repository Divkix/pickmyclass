import { SignIn } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";
import { Header } from "@/components/Header";
import { pageHead } from "@/lib/seo/head";

const appearance = { variables: { colorPrimary: "#7a0019", colorBackground: "#fff8e7" } };

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
