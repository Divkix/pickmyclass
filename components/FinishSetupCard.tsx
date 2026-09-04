'use client';

import { ArrowRight, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function FinishSetupCard() {
  return (
    <Card className="mb-6 border-primary/20 bg-primary/5">
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between py-5">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="size-5 shrink-0 text-primary mt-0.5" />
          <div>
            <p className="font-medium text-sm">Finish setting up</p>
            <p className="text-sm text-muted-foreground">
              Add your first class and we&apos;ll alert you the moment a seat opens.
            </p>
          </div>
        </div>
        <Link href="/dashboard/add" className="shrink-0">
          <Button variant="gradient" className="gap-2 w-full sm:w-auto">
            Add a class
            <ArrowRight className="size-4" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
