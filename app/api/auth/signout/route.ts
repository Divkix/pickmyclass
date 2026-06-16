import { ok } from '@/lib/api/response';
import { createClient } from '@/lib/supabase/server';

export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();

  return ok(null);
}
