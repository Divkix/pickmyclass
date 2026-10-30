import { ArrowRight, CheckCircle2, Mail } from "lucide-react";
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SimplifiedWatchForm } from "@/components/SimplifiedWatchForm";
import type { OnboardingState } from "@/lib/onboarding";
import { trackBrowserAction } from "@/lib/telemetry/browser";
import type { ClassWatchRow } from "@/lib/types/class-watch";

type Step = 1 | 2;

const stepTitles = {
  1: "Add your first class",
  2: "Your class is being watched",
} as const satisfies Record<Step, string>;

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

/** Starts with class entry, then confirms creation; only completion/skip status is persisted. */
function OnboardingFlow({ ref, onSkipped, onCompleted, onSkipError }: OnboardingFlowProps) {
  const [step, setStep] = useState<Step>(1);
  const [skipping, setSkipping] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdWatch, setCreatedWatch] = useState<ClassWatchRow | null>(null);
  const skippingRef = useRef(false);
  const completedRef = useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const announcement = `Step ${step} of 2: ${stepTitles[step]}`;

  useEffect(() => {
    trackBrowserAction("onboarding_started", {});
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
    onSkipped({
      onboarding_completed_at: null,
      onboarding_skipped_at: new Date().toISOString(),
      needs_onboarding: false,
    });

    try {
      const response = await fetch("/api/user/onboarding", { method: "POST" });

      // SAFETY: response.json() matches Partial<OnboardingState> with optional error per API contract
      const data = (await response.json()) as Partial<OnboardingState> & { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "Failed to skip onboarding");
      }

      onSkipped({
        onboarding_completed_at: data.onboarding_completed_at ?? null,
        onboarding_skipped_at: data.onboarding_skipped_at ?? null,
        needs_onboarding: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to skip onboarding";
      onSkipError?.(message);
    } finally {
      skippingRef.current = false;
      setSkipping(false);
    }
  };

  const handleWatchCreated = (watch: ClassWatchRow) => {
    setCreatedWatch(watch);
    trackBrowserAction("onboarding_completed", {});
    setStep(2);
  };

  const handleConfirmClose = () => {
    if (completedRef.current) return;

    if (createdWatch) {
      completedRef.current = true;
      onCompleted?.(createdWatch);
    }
  };

  const requestClose = () => {
    if (step === 2) {
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
          skipping={skipping}
          creating={creating}
          onCreated={handleWatchCreated}
          onSubmittingChange={setCreating}
          onSkip={handleSkip}
        />
      )}

      {step === 2 && <StepTwo titleRef={titleRef} onDone={handleConfirmClose} />}
    </>
  );
}

interface StepOneProps {
  titleRef: Ref<HTMLHeadingElement>;
  skipping: boolean;
  creating: boolean;
  onCreated: (watch: ClassWatchRow) => void;
  onSubmittingChange: (submitting: boolean) => void;
  onSkip: () => Promise<void>;
}

function StepOne({
  titleRef,
  skipping,
  creating,
  onCreated,
  onSubmittingChange,
  onSkip,
}: StepOneProps) {
  return (
    <>
      <DialogHeader>
        <div
          className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
          aria-hidden="true"
        >
          Step 1 of 2
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
      </div>
    </>
  );
}

interface StepTwoProps {
  titleRef: Ref<HTMLHeadingElement>;
  onDone: () => void;
}

function StepTwo({ titleRef, onDone }: StepTwoProps) {
  return (
    <>
      <DialogHeader>
        <div
          className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
          aria-hidden="true"
        >
          Step 2 of 2
        </div>
        <DialogTitle className="text-2xl" ref={titleRef} tabIndex={-1}>
          Your class is being watched
        </DialogTitle>
        <DialogDescription id="onboarding-step-description">
          You can view or remove it from your dashboard.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-2">
        <div className="flex gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Mail className="size-5" />
          </div>
          <div>
            <p className="font-medium text-sm">We will email you when a seat opens</p>
            <p className="text-sm text-muted-foreground">We check every 30 minutes, every day.</p>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CheckCircle2 className="size-5" />
          </div>
          <div>
            <p className="font-medium text-sm">Or when an instructor is assigned</p>
            <p className="text-sm text-muted-foreground">
              We will email you when ASU replaces &quot;Staff&quot; with the instructor&apos;s name.
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
