/**
 * Supabase Service Role Client
 *
 * This client uses the service_role key which bypasses Row Level Security (RLS).
 * It should ONLY be used in server-side contexts like:
 * - Cloudflare Workers cron jobs
 * - API routes that need admin-level access
 * - Background jobs
 *
 * NEVER expose this client or the service_role key to the browser.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

/**
 * Create a Supabase client with service role privileges
 *
 * This client bypasses RLS and can perform any operation on the database.
 * Use with caution and only in trusted server environments.
 *
 * @param serviceRoleKey - The service_role key from Supabase (required in production)
 * @returns Supabase client with service role privileges
 */
export function createServiceClient(
  serviceRoleKey: string
): SupabaseClient<Database> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  }

  if (!serviceRoleKey) {
    throw new Error('Service role key is required')
  }

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

/**
 * Get a service role client from environment variables
 *
 * Reads SUPABASE_SERVICE_ROLE_KEY from env and creates a client.
 * Throws if the key is not set.
 *
 * @returns Supabase client with service role privileges
 *
 * @example
 * // In a cron job
 * const supabase = getServiceClient()
 * await supabase.from('class_states').update({ ... })
 */
export function getServiceClient(): SupabaseClient<Database> {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set in environment variables. ' +
        'This is required for service role operations.'
    )
  }

  return createServiceClient(serviceRoleKey)
}
