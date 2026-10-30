import { Bell, RefreshCw, TrendingUp, User } from "lucide-react";
import { Link } from "@tanstack/react-router";

/** Explains ASU terms before the dashboard example and account setup instructions. */
export function FeaturesSection() {
  return (
    <section className="border-b border-border px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="animation-hidden mb-12 max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Track ASU classes. <span className="text-emphasis">Get email alerts.</span>
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            PickMyClass checks your classes every 30 minutes and emails you when it detects an open
            seat or a named instructor assignment.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3 md:grid-rows-2">
          <article className="animation-hidden flex flex-col justify-between gap-6 rounded-xl border border-primary/20 bg-primary p-7 text-primary-foreground shadow-smooth [animation-delay:100ms] md:col-span-2 md:row-span-2">
            <div className="flex size-12 items-center justify-center rounded-lg bg-primary-foreground/10">
              <RefreshCw className="size-6 text-accent" aria-hidden="true" />
            </div>
            <div className="space-y-3">
              <h3 className="text-2xl font-semibold">Automatic class checks</h3>
              <p className="max-w-md text-base leading-relaxed text-primary-foreground">
                Add/drop is when students add or drop classes in the first days of the semester. We
                automatically check your classes every 30 minutes, day and night.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <span className="rounded-full bg-black/10 px-3 py-1 text-xs font-medium">
                  Every 30 minutes
                </span>
                <span className="rounded-full bg-black/10 px-3 py-1 text-xs font-medium">
                  24/7 monitoring
                </span>
                <span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">
                  Email alerts after checks
                </span>
              </div>
            </div>
          </article>

          <article className="animation-hidden flex flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-smooth [animation-delay:200ms]">
            <div className="flex size-11 items-center justify-center rounded-lg bg-accent/20">
              <User className="size-5 text-primary" aria-hidden="true" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-semibold text-foreground">
                Instructor assignment alerts
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                ASU shows &ldquo;Staff&rdquo; until an instructor is assigned. We email you when a
                check detects a change from Staff to a named instructor.
              </p>
            </div>
          </article>

          <article className="animation-hidden flex flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-smooth [animation-delay:300ms]">
            <div className="flex size-11 items-center justify-center rounded-lg bg-primary/10">
              <TrendingUp className="size-5 text-primary" aria-hidden="true" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-semibold text-foreground">Open seat alerts</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                We email you when a check finds an open seat. You still need to register through
                MyASU; an alert does not reserve a seat. For classes with a waitlist, read the{" "}
                <Link
                  to="/blog/asu-waitlist-guide"
                  className="font-medium text-foreground underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
                >
                  ASU waitlist guide
                </Link>
                .
              </p>
            </div>
          </article>
        </div>

        <div className="animation-hidden mt-4 flex items-center gap-3 rounded-xl border border-dashed border-border bg-muted/30 px-6 py-4 [animation-delay:400ms]">
          <Bell className="size-5 shrink-0 text-primary" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            Emails about changes to your watched classes. No marketing emails or digests.
          </p>
        </div>
      </div>
    </section>
  );
}
