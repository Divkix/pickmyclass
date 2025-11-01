import { useRef, useState, useCallback } from 'react'

export interface UseSwipeOptions {
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  threshold?: number
  onSwipeStart?: () => void
  onSwipeMove?: (offset: number) => void
  onSwipeEnd?: () => void
}

export interface UseSwipeReturn {
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void
    onTouchMove: (e: React.TouchEvent) => void
    onTouchEnd: () => void
  }
  offset: number
  isSwiping: boolean
}

/**
 * Custom hook for detecting swipe gestures on touch devices
 *
 * @param options - Configuration options for swipe detection
 * @param options.onSwipeLeft - Callback triggered when swipe left threshold is exceeded
 * @param options.onSwipeRight - Callback triggered when swipe right threshold is exceeded
 * @param options.threshold - Minimum distance in pixels to trigger swipe (default: 100)
 * @param options.onSwipeStart - Callback triggered when touch starts
 * @param options.onSwipeMove - Callback triggered during swipe with current offset
 * @param options.onSwipeEnd - Callback triggered when touch ends
 *
 * @returns Object containing touch event handlers, current offset, and swiping state
 */
export function useSwipe(options: UseSwipeOptions = {}): UseSwipeReturn {
  const {
    onSwipeLeft,
    onSwipeRight,
    threshold = 100,
    onSwipeStart,
    onSwipeMove,
    onSwipeEnd,
  } = options

  const [offset, setOffset] = useState(0)
  const [isSwiping, setIsSwiping] = useState(false)
  const touchStartX = useRef<number>(0)
  const touchCurrentX = useRef<number>(0)

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      touchStartX.current = e.touches[0].clientX
      touchCurrentX.current = e.touches[0].clientX
      setIsSwiping(true)
      onSwipeStart?.()
    },
    [onSwipeStart]
  )

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isSwiping) return

      touchCurrentX.current = e.touches[0].clientX
      const diff = touchCurrentX.current - touchStartX.current

      // Update offset for visual feedback
      setOffset(diff)
      onSwipeMove?.(diff)
    },
    [isSwiping, onSwipeMove]
  )

  const handleTouchEnd = useCallback(() => {
    if (!isSwiping) return

    const swipeDistance = touchCurrentX.current - touchStartX.current
    const absDistance = Math.abs(swipeDistance)

    // Check if threshold was exceeded
    if (absDistance >= threshold) {
      // Trigger haptic feedback if available
      if (navigator.vibrate) {
        navigator.vibrate(50)
      }

      // Determine direction and trigger callback
      if (swipeDistance < 0) {
        onSwipeLeft?.()
      } else {
        onSwipeRight?.()
      }
    }

    // Reset state
    setIsSwiping(false)
    setOffset(0)
    touchStartX.current = 0
    touchCurrentX.current = 0
    onSwipeEnd?.()
  }, [isSwiping, threshold, onSwipeLeft, onSwipeRight, onSwipeEnd])

  return {
    handlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
    offset,
    isSwiping,
  }
}
