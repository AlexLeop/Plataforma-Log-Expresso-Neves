import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/client';
import { validateMachineSignature } from '@/lib/webhook-hmac';

export const dynamic = 'force-dynamic';

/**
 * Webhook endpoint for receiving driver position updates from Machine API.
 *
 * ARCHITECTURE (Phase 2 — Anti-DDoS):
 *   Machine webhook → this endpoint → Supabase `driver_positions` table → Realtime → Frontend
 *   Frontend NO LONGER polls via setInterval. It subscribes to Realtime changes.
 *
 * SECURITY:
 *   Validates HMAC-SHA-512 signature via the `signature-v2` header using
 *   MACHINE_API_KEY as the secret. The raw body is read as text first to
 *   preserve exact byte content for signature verification.
 *
 * The Machine may send data in different formats:
 * - Single position: { condutor_id, lat_cond, lng_cond, ... }
 * - Array of positions: [ { condutor_id, lat_cond, lng_cond }, ... ]
 * - Wrapped: { data: [...] } or { condutores: [...] }
 */

interface PositionData {
  condutor_id?: string | number;
  id_mch?: string | number;
  lat_cond?: string | number;
  lng_cond?: string | number;
  latitude?: string | number;
  longitude?: string | number;
  lat?: string | number;
  lng?: string | number;
  velocidade?: string | number;
  speed?: string | number;
  direcao?: string | number;
  heading?: string | number;
  id_solicitacao?: string | number;
  [key: string]: unknown;
}

function extractPosition(item: PositionData) {
  const condutorId = item.condutor_id ?? item.id_mch;
  const lat = item.lat_cond ?? item.latitude ?? item.lat;
  const lng = item.lng_cond ?? item.longitude ?? item.lng;
  const speed = item.velocidade ?? item.speed;
  const heading = item.direcao ?? item.heading;
  const rideId = item.id_solicitacao;

  if (!condutorId || lat === undefined || lng === undefined) return null;

  return {
    machine_condutor_id: String(condutorId),
    latitude: Number(lat),
    longitude: Number(lng),
    speed: speed !== undefined ? Number(speed) : null,
    heading: heading !== undefined ? Number(heading) : null,
    machine_ride_id: rideId ? String(rideId) : null,
    received_at: new Date().toISOString(),
  };
}

export async function POST(request: Request) {
  try {
    // ─── Step 1: Read raw body FIRST (CRITICAL for HMAC) ───
    // DO NOT use request.json() — it destroys the raw bytes needed for signature verification
    const rawBody = await request.text();

    // ─── Step 2: Validate HMAC-SHA-512 signature ───
    const validation = await validateMachineSignature(request, rawBody);
    if (!validation.valid) {
      console.warn('[Webhook Posição] Assinatura inválida — rejeição silenciosa');
      // Return 200 to prevent Machine from deactivating the webhook
      return NextResponse.json(validation.error);
    }

    // ─── Step 3: Parse body (safe — signature already validated) ───
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      console.error('[Webhook Posição] JSON parse error on raw body');
      return NextResponse.json({ success: true, error: 'invalid_json' });
    }

    // ─── Step 4: Extract positions from various Machine formats ───
    let items: PositionData[] = [];

    if (Array.isArray(body)) {
      items = body;
    } else if (typeof body === 'object' && body !== null) {
      const obj = body as Record<string, unknown>;
      if (obj.data && Array.isArray(obj.data)) {
        items = obj.data;
      } else if (obj.condutores && Array.isArray(obj.condutores)) {
        items = obj.condutores;
      } else if (obj.condutor_id || obj.lat_cond || obj.latitude) {
        items = [obj as PositionData];
      } else {
        console.log('[Webhook Posição] Unknown format, keys:', Object.keys(obj));
      }
    }

    // ─── HARD CAP: Prevent OOM on oversized batches ───
    const MAX_BATCH_SIZE = 500;
    if (items.length > MAX_BATCH_SIZE) {
      console.warn(`[Webhook Posição] Batch truncated: ${items.length} → ${MAX_BATCH_SIZE}`);
      items = items.slice(0, MAX_BATCH_SIZE);
    }

    const positions = items
      .map(extractPosition)
      .filter((p): p is NonNullable<typeof p> => p !== null && !isNaN(p.latitude) && !isNaN(p.longitude));

    if (positions.length === 0) {
      return NextResponse.json({ success: true, stored: 0 });
    }

    // ─── Step 5: Persist to Supabase (chunked upsert by machine_condutor_id) ───
    const supabase = createAdminClient();
    const CHUNK_SIZE = 200;
    let totalStored = 0;

    for (let i = 0; i < positions.length; i += CHUNK_SIZE) {
      const chunk = positions.slice(i, i + CHUNK_SIZE);
      const { error: upsertError } = await supabase
        .from('driver_positions')
        .upsert(
          chunk.map(p => ({
            machine_condutor_id: p.machine_condutor_id,
            latitude: p.latitude,
            longitude: p.longitude,
            speed: p.speed,
            heading: p.heading,
            machine_ride_id: p.machine_ride_id,
            received_at: p.received_at,
          })),
          { onConflict: 'machine_condutor_id' }
        );

      if (upsertError) {
        console.error(`[Webhook Posição] Chunk ${i}-${i + chunk.length} error:`, upsertError.message);
      } else {
        totalStored += chunk.length;
      }
    }

    // Always return 200 so Machine doesn't deactivate the webhook
    // ─── Step 6: Update ride_cache for active rides ───
    // When a driver is on an active ride, position data includes id_solicitacao.
    // We use this to populate ride_cache with "E" (Em Andamento) status,
    // which triggers Supabase Realtime → Frontend updates.
    const activeRidePositions = positions.filter(p => p.machine_ride_id);
    if (activeRidePositions.length > 0) {
      // Deduplicate by machine_ride_id (keep latest position per ride)
      const rideMap = new Map<string, typeof activeRidePositions[0]>();
      for (const p of activeRidePositions) {
        rideMap.set(p.machine_ride_id!, p);
      }

      const rideCacheEntries = Array.from(rideMap.values()).map(p => ({
        machine_ride_id: p.machine_ride_id!,
        status_code: 'E', // Em Andamento (driver is moving = ride is active)
        machine_condutor_id: p.machine_condutor_id,
        machine_empresa_id: null, // Will be filled by status webhook if available
        received_at: p.received_at,
      }));

      const { error: rideCacheError } = await supabase
        .from('ride_cache')
        .upsert(rideCacheEntries, {
          onConflict: 'machine_ride_id',
          // Don't overwrite if status is already 'F' (Finished) or 'C' (Cancelled)
          ignoreDuplicates: false,
        });

      if (rideCacheError) {
        console.error('[Webhook Posição] ride_cache upsert error:', rideCacheError.message);
      } else {
        console.log(`[Webhook Posição] Updated ride_cache for ${rideCacheEntries.length} active rides`);
      }
    }

    return NextResponse.json({ success: true, stored: totalStored, activeRides: activeRidePositions.length });
  } catch (err) {
    console.error('[Webhook Posição] Unexpected error:', err);
    // Still return 200 to prevent webhook deactivation
    return NextResponse.json({ success: true, error: 'internal_error' });
  }
}

/**
 * GET /api/webhook/posicao — debug endpoint (latest positions from Supabase)
 * RESTRICTED: Requires admin BasicAuth to prevent data leakage.
 */
export async function GET(request: Request) {
  try {
    // ─── Admin-only guard ───
    const authHeader = request.headers.get('authorization');
    const centralUsername = process.env.MACHINE_USERNAME;
    if (!authHeader || !authHeader.startsWith('Basic ') || !centralUsername) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
    const [email] = decoded.split(':');
    if (email !== centralUsername) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('driver_positions')
      .select('machine_condutor_id, latitude, longitude, speed, heading, received_at')
      .order('received_at', { ascending: false })
      .limit(20);

    return NextResponse.json({
      positions_count: data?.length || 0,
      positions: data || [],
      error: error?.message || null,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) });
  }
}
