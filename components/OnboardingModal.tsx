'use client';

import { ArrowRight, CheckCircle2, ExternalLink, Lightbulb, Mail } from 'lucide-react';
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
  // Synchronous guard: Radix fires onPointerDownOutside and onInteractOutside
  // for the same backdrop event, and setSkipping is async, so a ref is the only
  // way to prevent a double POST.
  const skippingRef = useRef(false);
  // Same idea for the confirmation close: Escape + backdrop + a double-click on
  // "Done" can all fire before the parent lowers `open`, which would call
  // onCompleted twice and duplicate the watch in the dashboard list.
  const completedRef = useRef(false);

  // Track funnel start once per open. Reset to step 1 whenever the modal opens.
  useEffect(() => {
    if (open) {
      setStep(1);
      setCreatedWatch(null);
      completedRef.current = false;
      posthog.capture('onboarding_started');
    }
  }, [open]);

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

  const handleCreateWatch = async (data: { term: string; class_nbr: string }) => {
    setCreating(true);
    try {
      const response = await fetch('/api/class-watches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const result = (await response.json()) as { watch?: ClassWatchRow; error?: string };
      if (!response.ok) {
        throw new Error(result.error || 'Failed to add class watch');
      }
      if (!result.watch) {
        throw new Error('Failed to add class watch');
      }
      setCreatedWatch(result.watch);
      posthog.capture('onboarding_completed');
      // Only advance if the user hasn't navigated away from step 2 (e.g. via
      // Back) while the request was in flight.
      setStep((current) => (current === 2 ? 3 : current));
    } finally {
      setCreating(false);
    }
  };

  const handleConfirmClose = () => {
    if (completedRef.current) return;
    if (createdWatch) {
      completedRef.current = true;
      onCompleted?.(createdWatch);
    }
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
        {step === 1 && (
          <>
            <DialogHeader>
              <DialogTitle className="text-2xl">Welcome to PickMyClass</DialogTitle>
              <DialogDescription>
                Let&apos;s set up your first class alert. It takes about 30 seconds.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
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
              <DialogTitle className="text-2xl">Add your first class</DialogTitle>
              <DialogDescription>
                Enter the 5-digit class number and pick the term you want to watch.
              </DialogDescription>
            </DialogHeader>

            <div className="py-2">
              <SimplifiedWatchForm
                onSubmit={handleCreateWatch}
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
              <DialogTitle className="text-2xl">You&apos;re all set!</DialogTitle>
              <DialogDescription>
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
