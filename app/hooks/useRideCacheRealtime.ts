'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useToast } from '../components/Toast';

/**
 * useRideCacheRealtime — Subscribes to Supabase Realtime changes on ride_cache
 *
 * When a ride status changes via the Machine webhook:
 *   1. Displays a toast notification with the new status
 *   2. Plays a subtle notification sound
 *   3. Calls the onStatusChange callback to update local state
 *
 * FINANCIAL INTEGRITY: This hook is read-only. It NEVER touches manual_entries
 * or any financial tables. It only observes ride_cache for UI updates.
 */

export interface RideCacheEvent {
  machine_ride_id: string;
  machine_condutor_id: string | null;
  machine_empresa_id: string | null;
  driver_name: string | null;
  empresa_name: string | null;
  status_code: string;
  status_label: string | null;
  received_at: string;
  updated_at: string;
}

interface UseRideCacheRealtimeOptions {
  /** Filter by empresa_id (optional — if null, receives all) */
  empresaId?: string | number | null;
  /** Callback when a ride status changes */
  onStatusChange?: (event: RideCacheEvent, eventType: 'INSERT' | 'UPDATE') => void;
  /** Enable/disable the subscription */
  enabled?: boolean;
}

// Status mapping for toast notifications
const STATUS_MESSAGES: Record<string, { emoji: string; label: string; type: 'success' | 'info' | 'warning' }> = {
  D: { emoji: '↻', label: 'Distribuindo', type: 'info' },
  G: { emoji: '◎', label: 'Aguardando Aceite', type: 'info' },
  P: { emoji: '◌', label: 'Buscando Condutor', type: 'info' },
  A: { emoji: '✓', label: 'Aceita', type: 'success' },
  E: { emoji: '▸', label: 'Em Andamento', type: 'info' },
  F: { emoji: '●', label: 'Finalizada', type: 'success' },
  C: { emoji: '✕', label: 'Cancelada', type: 'warning' },
  N: { emoji: '△', label: 'Não Atendida', type: 'warning' },
  S: { emoji: '‖', label: 'Em Espera', type: 'info' },
};

/**
 * Play a subtle notification sound using the Web Audio API.
 * No external audio files needed.
 */
function playNotificationSound(statusCode: string) {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    // Different tones for different statuses
    if (statusCode === 'A') {
      // Accepted — happy ascending tone
      oscillator.frequency.setValueAtTime(523, ctx.currentTime);     // C5
      oscillator.frequency.setValueAtTime(659, ctx.currentTime + 0.1); // E5
      oscillator.frequency.setValueAtTime(784, ctx.currentTime + 0.2); // G5
    } else if (statusCode === 'F') {
      // Finished — triumphant double beep
      oscillator.frequency.setValueAtTime(784, ctx.currentTime);     // G5
      oscillator.frequency.setValueAtTime(1047, ctx.currentTime + 0.15); // C6
    } else if (statusCode === 'C' || statusCode === 'N') {
      // Cancelled/Not attended — descending warning
      oscillator.frequency.setValueAtTime(440, ctx.currentTime);     // A4
      oscillator.frequency.setValueAtTime(330, ctx.currentTime + 0.15); // E4
    } else {
      // Default — single soft beep
      oscillator.frequency.setValueAtTime(660, ctx.currentTime);     // E5
    }

    oscillator.type = 'sine';
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.4);

    // Clean up
    setTimeout(() => ctx.close(), 500);
  } catch {
    // Web Audio not available — silent fallback
  }
}

export function useRideCacheRealtime({
  empresaId,
  onStatusChange,
  enabled = true,
}: UseRideCacheRealtimeOptions) {
  const { showToast } = useToast();
  // Track previous statuses to detect actual changes (not re-renders)
  const prevStatusesRef = useRef<Map<string, string>>(new Map());
  // Store latest callback ref to avoid stale closures
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  const handleRealtimeEvent = useCallback(
    (eventType: 'INSERT' | 'UPDATE', newRecord: RideCacheEvent) => {
      const { machine_ride_id, status_code, driver_name } = newRecord;
      const prevStatus = prevStatusesRef.current.get(machine_ride_id);

      // Only notify on actual status changes (not repeated upserts with same status)
      if (prevStatus === status_code && eventType === 'UPDATE') return;

      prevStatusesRef.current.set(machine_ride_id, status_code);

      // Filter by empresa_id if specified
      if (empresaId && newRecord.machine_empresa_id && String(newRecord.machine_empresa_id) !== String(empresaId)) {
        return;
      }

      // Build notification message
      const statusInfo = STATUS_MESSAGES[status_code] || { emoji: '•', label: status_code, type: 'info' as const };
      const rideShort = machine_ride_id.slice(-6);
      const driverStr = driver_name ? ` — ${driver_name}` : '';

      const message = `${statusInfo.emoji} Corrida #${rideShort}: ${statusInfo.label}${driverStr}`;
      showToast(message, statusInfo.type, 5000);

      // Play notification sound
      playNotificationSound(status_code);

      // Call external handler
      onStatusChangeRef.current?.(newRecord, eventType);
    },
    [empresaId, showToast]
  );

  useEffect(() => {
    if (!enabled) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let channel: any = null;
    let mounted = true;

    async function setupRealtime() {
      try {
        const { getRealtimeClient } = await import('@/lib/supabase/browser-singleton');
        const supabase = getRealtimeClient();
        if (!supabase) return;

        channel = supabase
          .channel('ride-cache-realtime')
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'ride_cache' },
            (payload) => {
              if (!mounted) return;
              handleRealtimeEvent('INSERT', payload.new as RideCacheEvent);
            }
          )
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'ride_cache' },
            (payload) => {
              if (!mounted) return;
              handleRealtimeEvent('UPDATE', payload.new as RideCacheEvent);
            }
          )
          .subscribe();
      } catch (err) {
        console.warn('[useRideCacheRealtime] Setup failed:', err);
      }
    }

    setupRealtime();

    return () => {
      mounted = false;
      channel?.unsubscribe?.();
      // TTL cleanup: cap prevStatuses at 200 to prevent unbounded memory growth
      if (prevStatusesRef.current.size > 200) {
        const entries = Array.from(prevStatusesRef.current.entries());
        prevStatusesRef.current = new Map(entries.slice(-200));
      }
    };
  }, [enabled, handleRealtimeEvent]);
}
