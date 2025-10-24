import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Data Export API - CCPA Compliance
 *
 * Allows users to download all their personal data in JSON format
 * California residents have the right to know what data is collected (CCPA)
 */
export async function GET() {
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

    // Fetch user profile
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single()

    // Fetch all class watches with their current states
    const { data: watches } = await supabase
      .from('class_watches')
      .select(`
        *,
        class_states (
          title,
          instructor_name,
          seats_available,
          seats_capacity,
          location,
          meeting_times,
          last_checked_at
        )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    // Fetch notification history
    const { data: notifications } = await supabase
      .from('notifications_sent')
      .select(`
        *,
        class_watches (
          term,
          subject,
          catalog_nbr,
          class_nbr
        )
      `)
      .eq('class_watches.user_id', user.id)
      .order('sent_at', { ascending: false })

    // Build export data
    const exportData = {
      export_info: {
        exported_at: new Date().toISOString(),
        export_format: 'JSON',
        service: 'PickMyClass',
      },
      user_account: {
        email: user.email,
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at,
        email_confirmed_at: user.email_confirmed_at,
      },
      profile: {
        age_verified_at: profile?.age_verified_at,
        agreed_to_terms_at: profile?.agreed_to_terms_at,
        account_status: profile?.is_disabled ? 'disabled' : 'active',
        disabled_at: profile?.disabled_at,
      },
      class_watches: watches || [],
      notification_history: notifications || [],
      summary: {
        total_watches: watches?.length || 0,
        total_notifications: notifications?.length || 0,
        active_watches: watches?.filter(() => !profile?.is_disabled).length || 0,
      },
    }

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().split('T')[0]
    const filename = `pickmyclass-data-${timestamp}.json`

    // Return JSON file for download
    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Export error:', error)
    return NextResponse.json(
      { error: 'Failed to export data' },
      { status: 500 }
    )
  }
}
