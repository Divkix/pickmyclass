'use client';

import { ArrowRight, Bell, Mail, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { OnboardingState } from '@/lib/onboarding';

export type { OnboardingState };

interface OnboardingModalProps {
  open: boolean;
  /** Called with the updated onboarding state after a successful skip. */
  onSkipped: (state: OnboardingState) => void;
  /** Called when the skip request fails. */
  onSkipError?: (message: string) => void;
}

const STEPS = [
  {
    icon: Mail,
    title: 'Add a class to watch',
    description: 'Paste any ASU class number and we start tracking it instantly.',
  },
  {
    icon: Bell,
    title: 'Get notified the moment a seat opens',
    description: 'No more refreshing MyASU. We check every 30 minutes, 24/7.',
  },
  {
    icon: ShieldCheck,
    title: 'Unsubscribe anytime',
    description: 'One click in any email and you stop hearing from us.',
  },
] as const;

/**
 * First-time onboarding modal. Blocking for new users who have not completed or
 * skipped onboarding. Escape, backdrop click, and the "Skip for now" button all
 * trigger the same skip flow (POST /api/user/onboarding), then call onSkipped.
 */
export function OnboardingModal({ open, onSkipped, onSkipError }: OnboardingModalProps) {
  const [skipping, setSkipping] = useState(false);
  // Synchronous guard: Radix fires onPointerDownOutside and onInteractOutside
  // for the same backdrop event, and setSkipping is async, so a ref is the only
  // way to prevent a double POST.
  const skippingRef = useRef(false);

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

  // Route every close attempt (Escape, backdrop, X, Skip) through the skip flow.
  // Radix does not fire onOpenChange when the parent lowers `open`, so there is
  // no double-call once onSkipped updates the parent state.
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) void handleSkip();
      }}
    >
      <DialogContent
        className="sm:max-w-[480px]"
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          void handleSkip();
        }}
        onPointerDownOutside={(e) => {
          e.preventDefault();
          void handleSkip();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-2xl">Welcome to PickMyClass</DialogTitle>
          <DialogDescription>
            You&apos;re all set. Here&apos;s how to get your first alert.
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-4 py-2">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            return (
              <li key={step.title} className="flex gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </div>
                <div>
                  <p className="font-medium text-sm">
                    {index + 1}. {step.title}
                  </p>
                  <p className="text-sm text-muted-foreground">{step.description}</p>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center pt-2">
          <button
            type="button"
            onClick={() => void handleSkip()}
            disabled={skipping}
            className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline disabled:opacity-50"
          >
            Skip for now
          </button>
          <Link href="/dashboard/add" tabIndex={skipping ? -1 : undefined}>
            <Button variant="gradient" className="gap-2" disabled={skipping}>
              Add your first class
              <ArrowRight className="size-4" />
            </Button>
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
