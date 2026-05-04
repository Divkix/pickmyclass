'use client';

import { motion } from 'framer-motion';
import { Info, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useSwipe } from '@/lib/hooks/useSwipe';
import type { ClassStateRow, ClassWatchRow } from '@/lib/types/class-watch';
import { ClassDetailsDialog } from './ClassDetailsDialog';
import { ClassStateIndicator } from './ClassStateIndicator';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

interface ClassWatchCardProps {
  watch: ClassWatchRow;
  classState: ClassStateRow | null;
  onDelete: (watchId: string) => Promise<void>;
  onRestore?: () => void;
}

export function ClassWatchCard({ watch, classState, onDelete, onRestore }: ClassWatchCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwipeDeleting, setIsSwipeDeleting] = useState(false);
  const deletedWatchRef = useRef<ClassWatchRow | null>(null);
  const swipeDeleteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const classTitle = `${watch.subject} ${watch.catalog_nbr}${classState?.title ? ` - ${classState.title}` : ''}`;

  // Swipe-to-delete functionality
  const { handlers } = useSwipe({
    threshold: 100,
    onSwipeMove: (offset) => {
      // Only allow left swipe (negative offset)
      if (offset < 0) {
        setSwipeOffset(Math.max(offset, -120));
      }
    },
    onSwipeLeft: () => {
      handleSwipeDelete();
    },
    onSwipeEnd: () => {
      // Reset if not deleted
      if (!isSwipeDeleting) {
        setSwipeOffset(0);
      }
    },
  });

  const handleSwipeDelete = async () => {
    setIsSwipeDeleting(true);
    setSwipeOffset(-500); // Slide out animation
    deletedWatchRef.current = watch;

    // Wait for slide animation
    swipeDeleteTimeoutRef.current = setTimeout(async () => {
      try {
        await onDelete(watch.id);

        // Show undo toast
        toast.success('Class watch removed', {
          action: {
            label: 'Undo',
            onClick: async () => {
              await handleUndo();
            },
          },
          duration: 5000,
        });
        setIsSwipeDeleting(false);
        setSwipeOffset(0);
      } catch (error) {
        console.error('Failed to delete watch:', error);
        toast.error('Failed to delete watch. Please try again.');
        setIsSwipeDeleting(false);
        setSwipeOffset(0);
      }
    }, 300);
  };

  const handleUndo = async () => {
    if (!deletedWatchRef.current) return;

    try {
      const response = await fetch('/api/class-watches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          term: deletedWatchRef.current.term,
          subject: deletedWatchRef.current.subject,
          catalog_nbr: deletedWatchRef.current.catalog_nbr,
          class_nbr: deletedWatchRef.current.class_nbr,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to restore watch');
      }

      toast.success('Class watch restored');
      deletedWatchRef.current = null;

      onRestore?.();
    } catch (error) {
      console.error('Failed to restore watch:', error);
      toast.error('Failed to restore watch. Please add it again manually.');
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete(watch.id);
      toast.success('Class watch removed');
      setShowDeleteConfirm(false);
    } catch (error) {
      console.error('Failed to delete watch:', error);
      toast.error('Failed to delete watch. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  useEffect(() => {
    return () => {
      if (swipeDeleteTimeoutRef.current) {
        clearTimeout(swipeDeleteTimeoutRef.current);
      }
    };
  }, []);

  // Calculate background color based on swipe
  const getBackgroundStyle = () => {
    if (swipeOffset < -10) {
      const opacity = Math.min(Math.abs(swipeOffset) / 120, 1);
      return {
        backgroundColor: `hsl(var(--destructive) / ${opacity * 0.1})`,
      };
    }
    return {};
  };

  return (
    <>
      <div className="relative overflow-hidden rounded-xl">
        {/* Delete indicator (revealed on swipe) */}
        {swipeOffset < -10 && (
          <div className="absolute inset-0 flex items-center justify-end pr-6 bg-red-500 rounded-xl">
            <div className="flex items-center gap-2 text-white">
              <Trash2 className="h-5 w-5" />
              <span className="font-semibold">Delete</span>
            </div>
          </div>
        )}

        {/* Card with swipe animation */}
        <motion.div
          animate={{
            x: swipeOffset,
          }}
          transition={{
            type: 'spring',
            stiffness: 500,
            damping: 30,
            mass: 0.5,
          }}
          {...handlers}
          style={{
            touchAction: 'pan-y', // Allow vertical scrolling
            userSelect: 'none',
            WebkitUserSelect: 'none',
          }}
        >
          <Card className="relative" style={getBackgroundStyle()}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle className="text-lg line-clamp-2" title={classTitle}>
                    {watch.subject} {watch.catalog_nbr}
                    {classState?.title && ` - ${classState.title}`}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    Section {watch.class_nbr} • Term {watch.term}
                  </p>
                  {/* Watching indicator with pulse animation */}
                  <div className="flex items-center gap-1.5 mt-2">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-asu-gold opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-asu-gold" />
                    </span>
                    <span className="text-xs text-muted-foreground">Watching for changes</span>
                  </div>
                  {classState?.location && (
                    <p className="text-sm text-muted-foreground">
                      {classState.location}
                      {classState.meeting_times && ` • ${classState.meeting_times}`}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowDetails(true)}
                    className="text-primary hover:text-primary/80 hover:bg-primary/10 h-11 w-11"
                    aria-label={`View class details for ${classTitle}`}
                    title="View class details"
                  >
                    <Info className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={isDeleting}
                    className="text-destructive hover:text-destructive/80 hover:bg-destructive/10 h-11 w-11"
                    aria-label={`Stop watching ${classTitle}`}
                    title="Stop watching this class"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ClassStateIndicator classState={classState} />
              {classState?.last_checked_at && (
                <p className="text-xs text-muted-foreground mt-3">
                  Last checked: {new Date(classState.last_checked_at).toLocaleString()}
                </p>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <ClassDetailsDialog
        watch={watch}
        classState={classState}
        open={showDetails}
        onOpenChange={setShowDetails}
      />

      <DeleteConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        onConfirm={handleDelete}
        title="Stop watching this class?"
        description="We'll stop monitoring this section. You can always add it back."
        confirmText="Stop Watching"
        isDeleting={isDeleting}
      />
    </>
  );
}
