import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { env, serviceRoleKey } from '@/lib/env';

/** Cliente de servidor ligado a la sesión del usuario (respeta RLS). */
export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(entries) {
        try {
          entries.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Se llama desde un Server Component: el middleware ya refresca la sesión.
        }
      },
    },
  });
}

/**
 * Cliente sin sesión, para leer datos públicos (cartas, restaurantes).
 * Evita crear cookies innecesarias en páginas cacheables.
 */
export function createPublicSupabase() {
  return createSupabaseClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Cliente con service_role: SALTA RLS por completo.
 * Úsalo sólo en rutas de servidor ya autorizadas (webhooks, superadmin).
 */
export function createAdminSupabase() {
  return createSupabaseClient<Database>(env.supabaseUrl, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
