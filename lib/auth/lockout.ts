import { getServiceClient } from '@/lib/supabase/service'

export const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_DURATION_MINUTES = 15

export interface LockoutStatus {
  isLocked: boolean
  attempts: number
  lockedUntil: Date | null
}

/**
 * Check if an email address is currently locked out
 */
export async function checkLockoutStatus(email: string): Promise<LockoutStatus> {
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('failed_login_attempts')
    .select('*')
    .eq('email', email.toLowerCase())
    .single()

  if (error || !data) {
    return {
      isLocked: false,
      attempts: 0,
      lockedUntil: null,
    }
  }

  const now = new Date()
  const lockedUntil = data.locked_until ? new Date(data.locked_until) : null

  // Check if lockout period has expired
  if (lockedUntil && lockedUntil > now) {
    return {
      isLocked: true,
      attempts: data.attempts ?? 0,
      lockedUntil,
    }
  }

  // Lockout expired, reset attempts
  if (lockedUntil && lockedUntil <= now) {
    await supabase
      .from('failed_login_attempts')
      .delete()
      .eq('email', email.toLowerCase())

    return {
      isLocked: false,
      attempts: 0,
      lockedUntil: null,
    }
  }

  return {
    isLocked: false,
    attempts: data.attempts ?? 0,
    lockedUntil: null,
  }
}

/**
 * Increment failed login attempts for an email address
 * Locks account after MAX_FAILED_ATTEMPTS
 */
export async function incrementFailedAttempts(email: string): Promise<void> {
  const supabase = getServiceClient()
  const normalizedEmail = email.toLowerCase()

  const { data: existing } = await supabase
    .from('failed_login_attempts')
    .select('*')
    .eq('email', normalizedEmail)
    .single()

  const newAttempts = (existing?.attempts ?? 0) + 1
  const shouldLock = newAttempts >= MAX_FAILED_ATTEMPTS

  const updateData: {
    email: string
    attempts: number
    last_attempt_at: string
    locked_until?: string
  } = {
    email: normalizedEmail,
    attempts: newAttempts,
    last_attempt_at: new Date().toISOString(),
  }

  if (shouldLock) {
    const lockoutEnd = new Date()
    lockoutEnd.setMinutes(lockoutEnd.getMinutes() + LOCKOUT_DURATION_MINUTES)
    updateData.locked_until = lockoutEnd.toISOString()
  }

  await supabase
    .from('failed_login_attempts')
    .upsert(updateData, { onConflict: 'email' })
}

/**
 * Clear failed login attempts after successful login
 */
export async function clearFailedAttempts(email: string): Promise<void> {
  const supabase = getServiceClient()

  await supabase
    .from('failed_login_attempts')
    .delete()
    .eq('email', email.toLowerCase())
}

/**
 * Get remaining lockout time in minutes
 */
export function getRemainingLockoutTime(lockedUntil: Date | null): number {
  if (!lockedUntil) return 0

  const now = new Date()
  const diff = lockedUntil.getTime() - now.getTime()
  return Math.ceil(diff / 1000 / 60)
}
