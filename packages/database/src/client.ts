import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from '@kakao-cs-bot/config';
import type { Database } from './types';

let _client: SupabaseClient<Database> | null = null;
let _adminClient: SupabaseClient<Database> | null = null;

export function getSupabase(): SupabaseClient<Database> {
  if (_client) return _client;
  const env = getEnv();
  _client = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  return _client;
}

export function getSupabaseAdmin(): SupabaseClient<Database> {
  if (_adminClient) return _adminClient;
  const env = getEnv();
  _adminClient = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  return _adminClient;
}
