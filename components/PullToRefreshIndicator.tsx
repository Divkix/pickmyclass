'use client'

import { Loader2 } from 'lucide-react'

export interface PullToRefreshIndicatorProps {
  pullDistance: number
  isRefreshing: boolean
  threshold: number
}

/**
 * Visual indicator component for pull-to-refresh functionality
 * Shows a spinner that rotates based on pull distance
 */
export function PullToRefreshIndicator({
  pullDistance,
  isRefreshing,
  threshold,
}: PullToRefreshIndicatorProps) {
  // Calculate opacity and rotation
  const opacity = Math.min(pullDistance / threshold, 1)
  const rotation = isRefreshing ? 0 : (pullDistance / threshold) * 360
  const height = Math.min(pullDistance, 80)

  // Determine message
  const getMessage = () => {
    if (isRefreshing) return 'Refreshing...'
    if (pullDistance >= threshold) return 'Release to refresh'
    if (pullDistance > 0) return 'Pull to refresh'
    return ''
  }

  const message = getMessage()

  // Don't render if not pulling and not refreshing
  if (pullDistance === 0 && !isRefreshing) return null

  return (
    <div
      className="fixed top-0 left-1/2 -translate-x-1/2 z-50 pointer-events-none transition-all duration-100 ease-out"
      style={{
        opacity,
        height: `${height}px`,
      }}
    >
      <div className="flex flex-col items-center justify-center h-full gap-2 pt-4">
        <div
          className={`transition-transform duration-200 ${
            isRefreshing ? 'animate-spin' : ''
          }`}
          style={{
            transform: isRefreshing ? 'none' : `rotate(${rotation}deg)`,
          }}
        >
          <Loader2 className="size-6 text-primary" />
        </div>
        {message && (
          <span className="text-xs font-medium text-muted-foreground">
            {message}
          </span>
        )}
      </div>
    </div>
  )
}
