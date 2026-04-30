/**
 * Supabase Sync Hook
 * Runs on layout mount to pull data from Supabase → localStorage
 * Only syncs when Supabase env vars are configured
 */
'use client';

import { useEffect, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import { pullConfigFromSupabase } from '../services/company-config';
import { pullEntriesFromSupabase } from '../services/entries-store';
import { pullSnapshotsFromSupabase } from '../services/snapshot-store';

export function useSupabaseSync() {
  const { selectedCompany, weekPeriod } = useAppContext();
  const syncedRef = useRef<string>('');

  useEffect(() => {
    if (!selectedCompany) return;

    // Build a key to avoid re-syncing the same company/week
    const syncKey = `${selectedCompany.id}_${weekPeriod.start}_${weekPeriod.end}`;
    if (syncedRef.current === syncKey) return;
    syncedRef.current = syncKey;

    // Check if Supabase is configured
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl || supabaseUrl === 'https://your-project.supabase.co') return;

    // Pull all data in background
    const sync = async () => {
      await Promise.allSettled([
        pullConfigFromSupabase(selectedCompany.id, selectedCompany.nome),
        pullEntriesFromSupabase(selectedCompany.id, weekPeriod.start, weekPeriod.end),
        pullSnapshotsFromSupabase(selectedCompany.id),
      ]);
    };

    sync();
  }, [selectedCompany, weekPeriod]);
}
