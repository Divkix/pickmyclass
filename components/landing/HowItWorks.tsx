import { Sparkles } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

/** Keep these account and class-number steps aligned with the homepage HowTo JSON-LD. */
export function HowItWorks() {
  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-4xl">
        <div className="animation-hidden mb-16 text-center">
          <h2 className="mb-4 text-3xl font-semibold text-foreground sm:text-4xl">How It Works</h2>
          <p className="text-lg text-muted-foreground">
            Three steps to get email alerts for your ASU classes
          </p>
        </div>

        <div className="relative space-y-12">
          <div className="absolute bottom-5 left-4.5 top-5 w-0.5 bg-primary/25 sm:left-6" />

          <div className="animation-hidden relative flex items-start gap-6 [animation-delay:100ms]">
            <div className="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground shadow-smooth sm:size-12">
              1
            </div>
            <div className="flex-1 space-y-2 pt-1">
              <h3 className="text-xl font-semibold text-foreground sm:text-2xl">
                Create a free account
              </h3>
              <p className="text-base text-muted-foreground sm:text-lg">
                Sign up for a free PickMyClass account.
              </p>
            </div>
          </div>

          <div className="animation-hidden relative flex items-start gap-6 [animation-delay:200ms]">
            <div className="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-lg font-bold text-accent-foreground shadow-smooth sm:size-12">
              2
            </div>
            <div className="flex-1 space-y-2 pt-1">
              <h3 className="text-xl font-semibold text-foreground sm:text-2xl">
                Add your classes
              </h3>
              <p className="text-base text-muted-foreground sm:text-lg">
                Find the 5-digit class number in ASU Class Search. Choose the term and enter that
                number in PickMyClass. You can watch up to 10 classes at a time.
              </p>
            </div>
          </div>

          <div className="animation-hidden relative flex items-start gap-6 [animation-delay:300ms]">
            <div className="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground shadow-smooth sm:size-12">
              3
            </div>
            <div className="flex-1 space-y-2 pt-1">
              <h3 className="text-xl font-semibold text-foreground sm:text-2xl">
                Get email alerts
              </h3>
              <p className="text-base text-muted-foreground sm:text-lg">
                We check every 30 minutes and email you when we detect an open seat or a named
                instructor assignment. Register through MyASU. Read{" "}
                <Link
                  to="/blog/how-to-get-into-full-asu-classes"
                  className="font-medium text-foreground underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
                >
                  strategies to get into full ASU classes
                </Link>
                .
              </p>
            </div>
          </div>
        </div>

        <div className="animation-hidden mt-16 text-center [animation-delay:400ms]">
          <Button asChild size="lg" variant="gradient" className="text-base">
            <Link to="/sign-up">
              <Sparkles className="size-5" />
              Join 2,400+ Sun Devils
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
