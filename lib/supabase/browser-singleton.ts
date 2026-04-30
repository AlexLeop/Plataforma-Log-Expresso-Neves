/**
 * Singleton Supabase Client for Browser (Realtime subscriptions).
 *
 * CRITICAL: Every `createClient()` call opens a NEW WebSocket connection.
 * Supabase Free = 200 concurrent connections, Pro = 500.
 * With 3 components × N tabs × M users, this exhausts the pool fast.
 *
 * This singleton ensures ALL frontend Realtime subscriptions share
 * a single WebSocket multiplexed across channels.
 *
 * Usage:
 *   import { getRealtimeClient } from '@/lib/supabase/browser-singleton';
 *   const supabase = getRealtimeClient();
 *   const channel = supabase.channel('my-channel').on(...).subscribe();
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let instance: SupabaseClient | null = null;

/**
 * Returns a singleton Supabase client for browser-side Realtime.
 * Safe to call multiple times — only creates one WebSocket.
 *
 * Returns null if environment variables are missing (SSR safety).
 */
export function getRealtimeClient(): SupabaseClient | null {
  if (typeof window === 'undefined') return null;

  if (instance) return instance;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('[RealtimeSingleton] Missing NEXT_PUBLIC_SUPABASE_URL or ANON_KEY');
    return null;
  }

  instance = createClient(supabaseUrl, supabaseAnonKey, {
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
    auth: {
      persistSession: false,
    },
  });

  return instance;
}
