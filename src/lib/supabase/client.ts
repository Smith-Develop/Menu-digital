'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';
import { env } from '@/lib/env';

let cached: ReturnType<typeof createBrowserClient<Database>> | null = null;

/** Cliente de navegador (sesión en cookies, compartido con el servidor). */
export function createClient() {
  cached ??= createBrowserClient<Database>(env.supabaseUrl, env.supabaseAnonKey);
  return cached;
}
