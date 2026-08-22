/**
 * Supabase Service Role Client (DEPRECATED)
 *
 * This module is kept only for test mock compatibility. Production code no longer
 * uses it — all database access goes through the Hyperdrive-backed pg query seam
 * in `lib/db/client.ts`. The auth sibling sub-issue will remove this file entirely
 * once Supabase Auth is replaced by Clerk.
 *
 * NEVER expose this client or the service_role key to the browser.
 */

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL } from './config';

export function createServiceClient(serviceRoleKey: string) {
  if (!serviceRoleKey) {
    throw new Error('Service role key is required');
  }

  return createClient(SUPABASE_URL, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

let cachedClient: ReturnType<typeof createServiceClient> | null = null;
let cachedKey: string | null = null;

export function getServiceClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set in environment variables. ' +
        'This is required for service role operations.'
    );
  }

  if (cachedClient && cachedKey === serviceRoleKey) {
    return cachedClient;
  }

  cachedClient = createServiceClient(serviceRoleKey);
  cachedKey = serviceRoleKey;
  return cachedClient;
}
