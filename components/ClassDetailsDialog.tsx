'use client';

import { ExternalLink } from 'lucide-react';
import type { ClassStateRow, ClassWatchRow } from '@/lib/types/class-watch';
import { getRateMyProfessorUrl, isValidProfessorName } from '@/lib/utils/ratemyprofessor';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';

interface ClassDetailsDialogProps {
  watch: ClassWatchRow;
  classState: ClassStateRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ClassDetailsDialog({
  watch,
  classState,
  open,
  onOpenChange,
}: ClassDetailsDialogProps) {
  const hasInstructor = classState?.instructor_name && classState.instructor_name !== 'Staff';
  const rmpUrl = getRateMyProfessorUrl(classState?.instructor_name);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {watch.subject} {watch.catalog_nbr}
            {classState?.title && ` - ${classState.title}`}
          </DialogTitle>
          <DialogDescription>
            Section {watch.class_nbr} • Term {watch.term}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Seat Information */}
          {classState && (
            <div className="space-y-2">
              <h3 className="font-semibold text-foreground">Seat Availability</h3>
              <div className="bg-muted rounded-md p-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Seats Available</p>
                    <p className="text-2xl font-bold text-foreground">
                      {classState.seats_available}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Capacity</p>
                    <p className="text-2xl font-bold text-foreground">
                      {classState.seats_capacity}
                    </p>
                  </div>
                  {classState.non_reserved_seats !== null && (
                    <div className="col-span-2">
                      <p className="text-sm text-muted-foreground">Non-Reserved Seats</p>
                      <p className="text-lg font-semibold text-foreground">
                        {classState.non_reserved_seats}
                      </p>
                      {classState.seats_available - classState.non_reserved_seats > 0 && (
                        <p className="text-xs text-warning mt-1">
                          {classState.seats_available - classState.non_reserved_seats} reserved
                          seat(s) available
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Instructor Information */}
          <div className="space-y-2">
            <h3 className="font-semibold text-foreground">Instructor</h3>
            <div className="bg-muted rounded-md p-4">
              <p className="text-lg text-foreground">{classState?.instructor_name || 'TBA'}</p>
              {isValidProfessorName(classState?.instructor_name) && rmpUrl && (
                <Button variant="outline" className="mt-3" asChild>
                  <a
                    href={rmpUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2"
                    aria-label={`View ${classState?.instructor_name} on RateMyProfessor`}
                  >
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    View on RateMyProfessor
                  </a>
                </Button>
              )}
              {!hasInstructor && (
                <p className="text-sm text-muted-foreground mt-2">
                  Instructor hasn&apos;t been assigned yet. We&apos;ll email you the moment ASU
                  updates it.
                </p>
              )}
            </div>
          </div>

          {/* Location & Times */}
          {(classState?.location || classState?.meeting_times) && (
            <div className="space-y-2">
              <h3 className="font-semibold text-foreground">Location & Schedule</h3>
              <div className="bg-muted rounded-md p-4">
                {classState.location && (
                  <div className="mb-2">
                    <p className="text-sm text-muted-foreground">Location</p>
                    <p className="text-foreground">{classState.location}</p>
                  </div>
                )}
                {classState.meeting_times && (
                  <div>
                    <p className="text-sm text-muted-foreground">Meeting Times</p>
                    <p className="text-foreground">{classState.meeting_times}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Last Checked */}
          {classState?.last_checked_at && (
            <div className="text-xs text-muted-foreground text-center pt-2 border-t border-border">
              Last checked: {new Date(classState.last_checked_at).toLocaleString()}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
