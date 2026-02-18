import type { User } from '@supabase/supabase-js';
import { getSupabaseAnonServerClient } from '@/lib/supabase/server';

export async function resolveUserFromAuthorizationHeader(
  authorizationHeader: string | null,
): Promise<User | null> {
  if (!authorizationHeader) {
    return null;
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1];
  if (!token) {
    return null;
  }

  const supabase = getSupabaseAnonServerClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error) {
    return null;
  }

  return data.user ?? null;
}
