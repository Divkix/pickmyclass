'use client';

import { ArrowRight, CheckCircle2, ExternalLink, Lightbulb, Mail, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import posthog from 'posthog-js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { SimplifiedWatchForm } from '@/components/SimplifiedWatchForm';
import type { OnboardingState } from '@/lib/onboarding';
import type { ClassWatchRow } from '@/lib/types/class-watch';

export type { OnboardingState };

type Step = 1 | 2 | 3;

const stepTitles: Record<Step, string> = {
  1: 'Welcome to PickMyClass',
  2: 'Add your first class',
  3: "You're all set",
};

/** Display details for the popular-class shortcut (mirrors the API payload). */
interface PopularClassDetails {
  subject: string;
  catalog_nbr: string;
  title: string;
  instructor_name: string;
  seats_available: number;
  seats_capacity: number;
}

interface PopularClass {
  class_nbr: string;
  term: string;
  details: PopularClassDetails;
}

interface OnboardingModalProps {
  open: boolean;
  /** Called with the updated onboarding state after a successful skip. */
  onSkipped: (state: OnboardingState) => void;
  /** Called with the newly created watch once the user dismisses the confirmation step. */
  onCompleted?: (watch: ClassWatchRow) => void;
  /** Called when the skip request fails. */
  onSkipError?: (message: string) => void;
}

/**
 * First-time onboarding modal: a 3-step flow that guides the user from finding
 * a class ID to creating their first watch without leaving the dashboard.
 *
 * Step 1 — Find a class ID (ASU catalog link + guide).
 * Step 2 — Add the watch (simplified form, reuses the dashboard's validation).
 * Step 3 — You're all set (confirmation; closes on the next click).
 *
 * Escape, backdrop click, and the "Skip for now" button all trigger the skip
 * flow (POST /api/user/onboarding), then call onSkipped. Successfully creating
 * a watch advances to step 3; the modal calls onCompleted when it closes so the
 * dashboard can drop the modal and the Finish Setup Card.
 */
export function OnboardingModal({
  open,
  onSkipped,
  onCompleted,
  onSkipError,
}: OnboardingModalProps) {
  const [step, setStep] = useState<Step>(1);
  const [skipping, setSkipping] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdWatch, setCreatedWatch] = useState<ClassWatchRow | null>(null);
  // Popular-class example for step 1. `null` means "no example" (the modal then
  // shows the text-only guide). `popularLoading` distinguishes "still fetching"
  // from "fetched and none available" so we don't flash the guide before the
  // fetch resolves.
  const [popularClass, setPopularClass] = useState<PopularClass | null>(null);
  const [popularLoading, setPopularLoading] = useState(false);
  // Class number carried from the "Track this class" shortcut into the form.
  const [prefillClassNbr, setPrefillClassNbr] = useState('');
  // Synchronous guard: Radix fires onPointerDownOutside and onInteractOutside
  // for the same backdrop event, and setSkipping is async, so a ref is the only
  // way to prevent a double POST.
  const skippingRef = useRef(false);
  // Same idea for the confirmation close: Escape + backdrop + a double-click on
  // "Done" can all fire before the parent lowers `open`, which would call
  // onCompleted twice and duplicate the watch in the dashboard list.
  const completedRef = useRef(false);
  // Ref to the current step title so we can move focus there on step transitions.
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Screen-reader-only announcement for step transitions and the current step number.
  const [announcement, setAnnouncement] = useState('');

  // Track funnel start once per open. Reset to step 1 whenever the modal opens.
  useEffect(() => {
    if (open) {
      setStep(1);
      setCreatedWatch(null);
      setPopularClass(null);
      setPrefillClassNbr('');
      completedRef.current = false;
      posthog.capture('onboarding_started');
      // Load the most-watched class for the current selectable term. Any failure
      // (no selectable term, no watches, ASU 404/error) resolves to null and the
      // step falls back to the text-only guide — the fetch never blocks onboarding.
      setPopularLoading(true);
      fetch('/api/onboarding/popular-class')
        .then((response) => response.json())
        .then((data) => {
          setPopularClass((data as { popularClass?: PopularClass | null }).popularClass ?? null);
        })
        .catch(() => {
          setPopularClass(null);
        })
        .finally(() => {
          setPopularLoading(false);
        });
    }
  }, [open]);

  // Announce step changes and move focus to the new title so screen readers
  // read the updated heading when the user moves between steps.
  useEffect(() => {
    if (!open) return;
    setAnnouncement(`Step ${step} of 3: ${stepTitles[step]}`);
    const id = setTimeout(() => {
      titleRef.current?.focus();
    }, 0);
    return () => clearTimeout(id);
  }, [open, step]);

  const handleSkip = async () => {
    if (skippingRef.current) return;
    skippingRef.current = true;
    setSkipping(true);
    try {
      const response = await fetch('/api/user/onboarding', { method: 'POST' });
      const data = (await response.json()) as Partial<OnboardingState> & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || 'Failed to skip onboarding');
      }
      onSkipped({
        onboarding_completed_at: data.onboarding_completed_at ?? null,
        onboarding_skipped_at: data.onboarding_skipped_at ?? null,
        needs_onboarding: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to skip onboarding';
      onSkipError?.(message);
    } finally {
      skippingRef.current = false;
      setSkipping(false);
    }
  };

  const handleWatchCreated = (watch: ClassWatchRow) => {
    setCreatedWatch(watch);
    posthog.capture('onboarding_completed');
    // Only advance if the user hasn't navigated away from step 2 (e.g. via
    // Back) while the request was in flight.
    setStep((current) => (current === 2 ? 3 : current));
  };

  const handleConfirmClose = () => {
    if (completedRef.current) return;
    if (createdWatch) {
      completedRef.current = true;
      onCompleted?.(createdWatch);
    }
  };

  // Copy the popular example's class number into the simplified form and advance
  // to step 2. The form mounts with `defaultClassNbr` so the field is pre-filled.
  const handleTrackPopular = () => {
    if (!popularClass) return;
    setPrefillClassNbr(popularClass.class_nbr);
    posthog.capture('onboarding_popular_class_tracked', {
      class_nbr: popularClass.class_nbr,
      term: popularClass.term,
    });
    setStep(2);
  };

  // Route every close attempt (Escape, backdrop, X, Skip) through the skip flow.
  // On the confirmation step we instead let the close through as a completion.
  const requestClose = () => {
    if (step === 3) {
      handleConfirmClose();
      return;
    }
    void handleSkip();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
    >
      <DialogContent
        className="sm:max-w-[480px]"
        aria-describedby="onboarding-step-description"
        onEscapeKeyDown={(e) => {
          // On the confirmation step Escape confirms; otherwise it skips.
          if (step === 3) {
            e.preventDefault();
            handleConfirmClose();
          } else {
            e.preventDefault();
            void handleSkip();
          }
        }}
        onPointerDownOutside={(e) => {
          e.preventDefault();
          requestClose();
        }}
      >
        {/* Screen-reader-only live region for step transitions. */}
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {announcement}
        </div>
        {step === 1 && (
          <>
            <DialogHeader>
              <div
                className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
                aria-hidden="true"
              >
                Step 1 of 3
              </div>
              <DialogTitle className="text-2xl" ref={titleRef} tabIndex={-1}>
                Welcome to PickMyClass
              </DialogTitle>
              <DialogDescription id="onboarding-step-description">
                Let&apos;s set up your first class alert. It takes about 30 seconds.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {popularLoading ? (
                <div
                  className="h-28 rounded-md bg-primary/5 border border-primary/20 animate-pulse"
                  aria-hidden="true"
                />
              ) : popularClass ? (
                <div className="rounded-md bg-primary/5 border border-primary/20 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-primary">
                    <Sparkles className="size-4" aria-hidden="true" />
                    <span>Most-watched class right now</span>
                  </div>
                  <div className="text-sm">
                    <p className="font-medium text-foreground">
                      {popularClass.details.subject} {popularClass.details.catalog_nbr}
                    </p>
                    <p className="text-muted-foreground">{popularClass.details.title}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Class #{popularClass.class_nbr}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="gradient"
                    className="w-full gap-2"
                    onClick={handleTrackPopular}
                  >
                    <Sparkles className="size-4" />
                    Track this class
                  </Button>
                </div>
              ) : (
                <div className="flex gap-3 rounded-md bg-primary/5 border border-primary/20 p-3 text-sm">
                  <Lightbulb className="size-4 shrink-0 text-primary mt-0.5" aria-hidden="true" />
                  <p className="text-foreground">
                    Every ASU class section has a <strong>5-digit class number</strong>. Find it on
                    the{' '}
                    <a
                      href="https://catalog.apps.asu.edu/catalog/classes/classlist"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-primary underline hover:text-primary/80 inline-flex items-center gap-1"
                    >
                      ASU Class Search page
                      <ExternalLink className="size-3" />
                    </a>{' '}
                    in the &quot;Class #&quot; column.
                  </p>
                </div>
              )}

              <p className="text-sm text-muted-foreground">
                Once you have a class number, we&apos;ll start tracking it and email you the moment
                a seat opens or an instructor is assigned.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center pt-2">
              <button
                type="button"
                onClick={() => void handleSkip()}
                disabled={skipping}
                className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline disabled:opacity-50"
              >
                Skip for now
              </button>
              <Button
                variant="gradient"
                className="gap-2"
                disabled={skipping}
                onClick={() => setStep(2)}
              >
                I have my class number
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <DialogHeader>
              <div
                className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
                aria-hidden="true"
              >
                Step 2 of 3
              </div>
              <DialogTitle className="text-2xl" ref={titleRef} tabIndex={-1}>
                Add your first class
              </DialogTitle>
              <DialogDescription id="onboarding-step-description">
                Enter the 5-digit class number and pick the term you want to watch.
              </DialogDescription>
            </DialogHeader>

            <div className="py-2">
              <SimplifiedWatchForm
                onCreated={handleWatchCreated}
                onSubmittingChange={setCreating}
                defaultClassNbr={prefillClassNbr}
                submitLabel="Add class"
                submittingLabel="Adding your class..."
              />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center pt-2">
              <button
                type="button"
                onClick={() => void handleSkip()}
                disabled={skipping || creating}
                className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline disabled:opacity-50"
              >
                Skip for now
              </button>
              <Button
                type="button"
                variant="ghost"
                disabled={skipping || creating}
                onClick={() => setStep(1)}
              >
                Back
              </Button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <DialogHeader>
              <div
                className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
                aria-hidden="true"
              >
                Step 3 of 3
              </div>
              <DialogTitle className="text-2xl" ref={titleRef} tabIndex={-1}>
                You&apos;re all set!
              </DialogTitle>
              <DialogDescription id="onboarding-step-description">
                Your first class is being watched. Here&apos;s what happens next.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="flex gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Mail className="size-5" />
                </div>
                <div>
                  <p className="font-medium text-sm">
                    We&apos;ll email you the moment a seat opens
                  </p>
                  <p className="text-sm text-muted-foreground">
                    We check every 30 minutes, 24/7. No more refreshing MyASU.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <CheckCircle2 className="size-5" />
                </div>
                <div>
                  <p className="font-medium text-sm">Or when an instructor is assigned</p>
                  <p className="text-sm text-muted-foreground">
                    You&apos;ll hear from us the instant a &quot;Staff&quot; placeholder is
                    replaced.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="button"
                variant="gradient"
                className="gap-2"
                onClick={handleConfirmClose}
              >
                Done
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
