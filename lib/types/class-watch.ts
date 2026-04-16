import type { Database } from '@/lib/supabase/database.types';

export type ClassWatchRow = Database['public']['Tables']['class_watches']['Row'];
export type ClassStateRow = Database['public']['Tables']['class_states']['Row'];
