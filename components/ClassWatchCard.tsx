'use client';

import { motion } from 'framer-motion';
import { Info, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useSwipe } from '@/lib/hooks/useSwipe';
import type { Database } from '@/lib/supabase/database.types';
import { ClassDetailsDialog } from './ClassDetailsDialog';
import { ClassStateIndicator } from './ClassStateIndicator';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

type ClassWatch = Database['public']['Tables']['class_watches']['Row'];
type ClassState = Database['public']['Tables']['class_states']['Row'];

interface ClassWatchCardProps {
  watch: ClassWatch;
  classState: ClassState | null;
  onDelete: (watchId: string) => Promise<void>;
}

export function ClassWatchCard({ watch, classState, onDelete }: ClassWatchCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwipeDeleting, setIsSwipeDeleting] = useState(false);
  const deletedWatchRef = useRef<ClassWatch | null>(null);

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
    setTimeout(async () => {
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

      // Force page refresh to show restored watch
      window.location.reload();
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
    } catch (error) {
      console.error('Failed to delete watch:', error);
      toast.error('Failed to delete watch. Please try again.');
      setIsDeleting(false);
    }
  };

  // Calculate background color based on swipe
  const getBackgroundStyle = () => {
    if (swipeOffset < -10) {
      const opacity = Math.min(Math.abs(swipeOffset) / 120, 1);
      return {
        backgroundColor: `rgba(239, 68, 68, ${opacity * 0.1})`, // red-500 with opacity
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
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                    Section {watch.class_nbr} • Term {watch.term}
                  </p>
                  {classState?.location && (
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
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
                    className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950 h-11 w-11"
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
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950 h-11 w-11"
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
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-3">
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
        description={`You will no longer receive notifications for ${classTitle}. You can always add it back later.`}
        confirmText="Stop Watching"
        isDeleting={isDeleting}
      />
    </>
  );
}
