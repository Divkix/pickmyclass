import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Account Deletion API - CCPA Compliance
 *
 * Soft-deletes user account (sets disabled flag)
 * Data is retained for 30 days for business records, then purged
 * California residents have the right to deletion (CCPA)
 *
 * US-compliant: Soft delete is acceptable in US, unlike GDPR
 */
export async function DELETE() {
  try {
    const supabase = await createClient()

    // Check if user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const deletionTimestamp = new Date().toISOString()

    // Soft delete: Set is_disabled flag and disable notifications
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({
        is_disabled: true,
        disabled_at: deletionTimestamp,
        notifications_enabled: false,
        unsubscribed_at: deletionTimestamp,
      })
      .eq('user_id', user.id)

    if (updateError) {
      console.error('Error disabling account:', updateError)
      return NextResponse.json(
        { error: 'Failed to delete account' },
        { status: 500 }
      )
    }

    // Sign out the user (invalidate session)
    const { error: signOutError } = await supabase.auth.signOut()

    if (signOutError) {
      console.error('Error signing out:', signOutError)
      // Don't fail the request if sign out fails
    }

    return NextResponse.json({
      success: true,
      message: 'Account disabled successfully. Your data will be permanently deleted after 30 days.',
      disabled_at: deletionTimestamp,
      permanent_deletion_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    })
  } catch (error) {
    console.error('Delete account error:', error)
    return NextResponse.json(
      { error: 'Failed to delete account' },
      { status: 500 }
    )
  }
}
