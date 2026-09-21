'use client';

import { ArrowRight, CheckCircle2, ExternalLink, Lightbulb, Mail, Sparkles } from 'lucide-react';
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { trackAnalyticsEvent } from '@/lib/analytics/client';
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

const stepTitles = {
  1: 'Welcome to PickMyClass',
  2: 'Add your first class',
  3: "You're all set",
} as const satisfies Record<Step, string>;

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
  onSkipped: (state: OnboardingState) => void;
  onCompleted?: (watch: ClassWatchRow) => void;
  onSkipError?: (message: string) => void;
}

interface OnboardingFlowHandle {
  requestClose: () => void;
}

interface OnboardingFlowProps {
  onSkipped: (state: OnboardingState) => void;
  onCompleted?: (watch: ClassWatchRow) => void;
  onSkipError?: (message: string) => void;
  ref?: Ref<OnboardingFlowHandle>;
}

export function OnboardingModal({
  open,
  onSkipped,
  onCompleted,
  onSkipError,
}: OnboardingModalProps) {
  const flowRef = useRef<OnboardingFlowHandle>(null);
  const [session, setSession] = useState(0);
  const [previousOpen, setPreviousOpen] = useState(open);

  if (open !== previousOpen) {
    setPreviousOpen(open);

    if (open) setSession((current) => current + 1);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) flowRef.current?.requestClose();
      }}
    >
      <DialogContent
        className="sm:max-w-[480px]"
        aria-describedby="onboarding-step-description"
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          flowRef.current?.requestClose();
        }}
        onPointerDownOutside={(e) => {
          e.preventDefault();
          flowRef.current?.requestClose();
        }}
      >
        <OnboardingFlow
          key={session}
          ref={flowRef}
          onSkipped={onSkipped}
          onCompleted={onCompleted}
          onSkipError={onSkipError}
        />
      </DialogContent>
    </Dialog>
  );
}

function OnboardingFlow({ ref, onSkipped, onCompleted, onSkipError }: OnboardingFlowProps) {
  const [step, setStep] = useState<Step>(1);
  const [skipping, setSkipping] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdWatch, setCreatedWatch] = useState<ClassWatchRow | null>(null);
  const [popularClass, setPopularClass] = useState<PopularClass | null>(null);
  const [popularLoading, setPopularLoading] = useState(true);
  const [prefillClassNbr, setPrefillClassNbr] = useState('');
  const skippingRef = useRef(false);
  const completedRef = useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const announcement = `Step ${step} of 3: ${stepTitles[step]}`;

  useEffect(() => {
    trackAnalyticsEvent('onboarding_started', {});
    const controller = new AbortController();
    fetch('/api/onboarding/popular-class', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Failed to load popular class');
        }

        return response.json();
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        // SAFETY: /api/onboarding/popular-class returns { popularClass?: PopularClass | null } per API contract
        setPopularClass((data as { popularClass?: PopularClass | null }).popularClass ?? null);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setPopularClass(null);
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setPopularLoading(false);
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const id = setTimeout(() => {
      titleRef.current?.focus();
    }, 0);

    return () => clearTimeout(id);
  }, [step]);

  const handleSkip = async () => {
    if (skippingRef.current) return;
    skippingRef.current = true;
    setSkipping(true);

    try {
      const response = await fetch('/api/user/onboarding', { method: 'POST' });
      // SAFETY: response.json() matches Partial<OnboardingState> with optional error per API contract
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
    trackAnalyticsEvent('onboarding_completed', {});
    setStep((current) => (current === 2 ? 3 : current));
  };

  const handleConfirmClose = () => {
    if (completedRef.current) return;

    if (createdWatch) {
      completedRef.current = true;
      onCompleted?.(createdWatch);
    }
  };

  const handleTrackPopular = () => {
    if (!popularClass) return;
    setPrefillClassNbr(popularClass.class_nbr);
    trackAnalyticsEvent('onboarding_popular_class_tracked', {
      class_nbr: popularClass.class_nbr,
      term: popularClass.term,
    });
    setStep(2);
  };

  const requestClose = () => {
    if (step === 3) {
      handleConfirmClose();

      return;
    }

    void handleSkip();
  };

  useImperativeHandle(ref, () => ({ requestClose }));

  return (
    <>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
      {step === 1 && (
        <StepOne
          titleRef={titleRef}
          popularLoading={popularLoading}
          popularClass={popularClass}
          skipping={skipping}
          onSkip={handleSkip}
          onTrackPopular={handleTrackPopular}
          onContinue={() => setStep(2)}
        />
      )}

      {step === 2 && (
        <StepTwo
          titleRef={titleRef}
          skipping={skipping}
          creating={creating}
          prefillClassNbr={prefillClassNbr}
          onCreated={handleWatchCreated}
          onSubmittingChange={setCreating}
          onSkip={handleSkip}
          onBack={() => setStep(1)}
        />
      )}

      {step === 3 && <StepThree titleRef={titleRef} onDone={handleConfirmClose} />}
    </>
  );
}

interface StepOneProps {
  titleRef: Ref<HTMLHeadingElement>;
  popularLoading: boolean;
  popularClass: PopularClass | null;
  skipping: boolean;
  onSkip: () => void;
  onTrackPopular: () => void;
  onContinue: () => void;
}

function StepOne({
  titleRef,
  popularLoading,
  popularClass,
  skipping,
  onSkip,
  onTrackPopular,
  onContinue,
}: StepOneProps) {
  return (
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
              <p className="text-xs text-muted-foreground mt-1">Class #{popularClass.class_nbr}</p>
            </div>
            <Button
              type="button"
              variant="gradient"
              className="w-full gap-2"
              onClick={onTrackPopular}
            >
              <Sparkles className="size-4" />
              Track this class
            </Button>
          </div>
        ) : (
          <div className="flex gap-3 rounded-md bg-primary/5 border border-primary/20 p-3 text-sm">
            <Lightbulb className="size-4 shrink-0 text-primary mt-0.5" aria-hidden="true" />
            <p className="text-foreground">
              Every ASU class section has a <strong>5-digit class number</strong>. Find it on the{' '}
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
          Once you have a class number, we&apos;ll start tracking it and email you the moment a seat
          opens or an instructor is assigned.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center pt-2">
        <button
          type="button"
          onClick={() => void onSkip()}
          disabled={skipping}
          className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline disabled:opacity-50"
        >
          Skip for now
        </button>
        <Button variant="gradient" className="gap-2" disabled={skipping} onClick={onContinue}>
          I have my class number
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </>
  );
}

interface StepTwoProps {
  titleRef: Ref<HTMLHeadingElement>;
  skipping: boolean;
  creating: boolean;
  prefillClassNbr: string;
  onCreated: (watch: ClassWatchRow) => void;
  onSubmittingChange: (submitting: boolean) => void;
  onSkip: () => void;
  onBack: () => void;
}

function StepTwo({
  titleRef,
  skipping,
  creating,
  prefillClassNbr,
  onCreated,
  onSubmittingChange,
  onSkip,
  onBack,
}: StepTwoProps) {
  return (
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
          onCreated={onCreated}
          onSubmittingChange={onSubmittingChange}
          defaultClassNbr={prefillClassNbr}
          submitLabel="Add class"
          submittingLabel="Adding your class..."
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center pt-2">
        <button
          type="button"
          onClick={() => void onSkip()}
          disabled={skipping || creating}
          className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline disabled:opacity-50"
        >
          Skip for now
        </button>
        <Button type="button" variant="ghost" disabled={skipping || creating} onClick={onBack}>
          Back
        </Button>
      </div>
    </>
  );
}

interface StepThreeProps {
  titleRef: Ref<HTMLHeadingElement>;
  onDone: () => void;
}

function StepThree({ titleRef, onDone }: StepThreeProps) {
  return (
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
            <p className="font-medium text-sm">We&apos;ll email you the moment a seat opens</p>
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
              You&apos;ll hear from us the instant a &quot;Staff&quot; placeholder is replaced.
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button type="button" variant="gradient" className="gap-2" onClick={onDone}>
          Done
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </>
  );
}
