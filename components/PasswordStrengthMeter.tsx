'use client'

import { useMemo } from 'react'

interface PasswordStrengthMeterProps {
  score: number // 0-4 scale from zxcvbn
  feedback?: {
    warning?: string
    suggestions?: string[]
  }
}

/**
 * Password Strength Meter Component
 *
 * Displays visual feedback for password strength using zxcvbn scoring (0-4)
 * - 0-1: Weak (red)
 * - 2: Fair (yellow)
 * - 3: Good (blue)
 * - 4: Strong (green)
 */
export function PasswordStrengthMeter({ score, feedback }: PasswordStrengthMeterProps) {
  const strength = useMemo(() => {
    switch (score) {
      case 0:
      case 1:
        return { label: 'Weak', color: 'bg-red-500', textColor: 'text-red-600 dark:text-red-400' }
      case 2:
        return { label: 'Fair', color: 'bg-yellow-500', textColor: 'text-yellow-600 dark:text-yellow-400' }
      case 3:
        return { label: 'Good', color: 'bg-blue-500', textColor: 'text-blue-600 dark:text-blue-400' }
      case 4:
        return { label: 'Strong', color: 'bg-green-500', textColor: 'text-green-600 dark:text-green-400' }
      default:
        return { label: 'Unknown', color: 'bg-zinc-300', textColor: 'text-zinc-600' }
    }
  }, [score])

  // Calculate percentage width (0-4 maps to 0-100%)
  const widthPercentage = (score / 4) * 100

  return (
    <div className="space-y-2">
      {/* Strength bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${strength.color}`}
            style={{ width: `${widthPercentage}%` }}
          />
        </div>
        <span className={`text-sm font-medium ${strength.textColor}`}>
          {strength.label}
        </span>
      </div>

      {/* Feedback messages */}
      {feedback && (
        <div className="text-xs space-y-1">
          {feedback.warning && (
            <p className="text-yellow-600 dark:text-yellow-400">
              {feedback.warning}
            </p>
          )}
          {feedback.suggestions && feedback.suggestions.length > 0 && (
            <ul className="text-zinc-600 dark:text-zinc-400 list-disc list-inside space-y-0.5">
              {feedback.suggestions.map((suggestion, idx) => (
                <li key={idx}>{suggestion}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
