import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/client';
import { validateMachineSignature } from '@/lib/webhook-hmac';

export const dynamic = 'force-dynamic';

/**
 * Webhook endpoint for receiving ride STATUS updates from Machine API.
 *
 * ARCHITECTURE:
 *   Machine status webhook → this endpoint → Supabase `ride_cache` table → Realtime → Frontend
 *
 * SECURITY:
 *   Validates HMAC-SHA-512 via `signature-v2` header using MACHINE_API_KEY.
 *
 * NEW MACHINE PAYLOAD FORMAT (documented):
 *   {
 *     "datetime": "2025-08-29T13:20:05Z",
 *     "event_id": "550e8400-e29b-41d4-a716-446655440000",
 *     "request_id": 12345,
 *     "status_code": "A",
 *     "status_label": "ACCEPTED",
 *     "stop_id": 567,
 *     "links": {
 *       "request": "https://api.taximachine.com.br/api/v1/request/12345",
 *       "enterprise": "...",
 *       "driver": "..."
 *     }
 *   }
 *
 * DEPRECATED PAYLOAD FORMAT (still supported):
 *   {
 *     "id_mch": "12345",
 *     "status_solicitacao": "A",
 *     "condutor": { "id": 9999, "nome": "João" },
 *     ...
 *   }
 */

// New format payload
interface NewStatusPayload {
  datetime: string;
  event_id: string;
  request_id: number;
  status_code: string;
  status_label: string;
  stop_id?: number;
  links?: {
    request?: string;
    enterprise?: string;
    driver?: string;
  };
}

// Deprecated format payload  
interface OldStatusPayload {
  id_mch?: string | number;
  id_externo?: string;
  status_solicitacao?: string;
  data_hora_solicitacao?: string;
  condutor?: {
    id?: number;
    nome?: string;
    telefone?: string;
    vtr?: string;
    modelo?: string;
    placa?: string;
  };
  andamento?: {
    data_hora_aceite?: string;
    lat_aceite?: number;
    lng_aceite?: number;
    data_hora_inicio_corrida?: string;
  };
  finalizacao?: {
    data_hora_finalizacao?: string;
    distancia_percorrida_km?: number;
    duracao_min?: number;
    valor_corrida?: number;
    lat?: number;
    lng?: number;
  };
  cancelamento?: {
    data_hora?: string;
    cancelada_por?: string;
    motivo?: string;
  };
  [key: string]: unknown;
}

type StatusPayload = NewStatusPayload | OldStatusPayload;

function isNewFormat(payload: StatusPayload): payload is NewStatusPayload {
  return 'event_id' in payload && 'request_id' in payload && 'status_label' in payload;
}

function extractStatus(item: StatusPayload) {
  if (isNewFormat(item)) {
    // ─── NEW FORMAT ───
    return {
      machine_ride_id: String(item.request_id),
      status_code: item.status_code,
      status_label: item.status_label,
      status_detail: item.stop_id ? `stop_id: ${item.stop_id}` : null,
      machine_condutor_id: null, // Will be enriched via links if needed
      driver_name: null,
      machine_empresa_id: null,
      empresa_name: null,
      latitude: null,
      longitude: null,
      machine_timestamp: item.datetime,
      received_at: new Date().toISOString(),
      raw_payload: item,
    };
  }

  // ─── DEPRECATED FORMAT ───
  const old = item as OldStatusPayload;
  const rideId = old.id_mch;
  const statusCode = old.status_solicitacao;

  if (!rideId || !statusCode) return null;

  const lat = old.finalizacao?.lat ?? old.andamento?.lat_aceite;
  const lng = old.finalizacao?.lng ?? old.andamento?.lng_aceite;
  const machineTimestamp = old.finalizacao?.data_hora_finalizacao
    ?? old.cancelamento?.data_hora
    ?? old.andamento?.data_hora_aceite
    ?? old.data_hora_solicitacao;

  return {
    machine_ride_id: String(rideId),
    status_code: String(statusCode),
    status_label: null,
    status_detail: old.cancelamento?.motivo
      ? `Cancelada por: ${old.cancelamento.cancelada_por} - ${old.cancelamento.motivo}`
      : null,
    machine_condutor_id: old.condutor?.id ? String(old.condutor.id) : null,
    driver_name: old.condutor?.nome || null,
    machine_empresa_id: null,
    empresa_name: null,
    latitude: lat !== undefined ? Number(lat) : null,
    longitude: lng !== undefined ? Number(lng) : null,
    machine_timestamp: machineTimestamp ? new Date(machineTimestamp).toISOString() : null,
    received_at: new Date().toISOString(),
    raw_payload: old,
  };
}

export async function POST(request: Request) {
  try {
    // ─── Step 1: Read raw body FIRST (CRITICAL for HMAC) ───
    const rawBody = await request.text();

    // ─── Step 2: Validate HMAC-SHA-512 signature ───
    const validation = await validateMachineSignature(request, rawBody);
    if (!validation.valid) {
      console.warn('[Webhook Status] Invalid signature — silent rejection');
      return NextResponse.json(validation.error);
    }

    // ─── Step 3: Parse body ───
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      console.error('[Webhook Status] JSON parse error');
      return NextResponse.json({ success: true, error: 'invalid_json' });
    }

    // ─── Step 4: Extract status from payload ───
    // New format sends a single object; deprecated may send arrays
    let items: StatusPayload[] = [];

    if (Array.isArray(body)) {
      items = body;
    } else if (typeof body === 'object' && body !== null) {
      const obj = body as Record<string, unknown>;
      if (obj.data && Array.isArray(obj.data)) {
        items = obj.data;
      } else if (obj.request_id || obj.event_id || obj.id_mch || obj.status_solicitacao) {
        items = [obj as StatusPayload];
      } else {
        console.log('[Webhook Status] Unknown format, keys:', Object.keys(obj));
      }
    }

    // ─── HARD CAP ───
    if (items.length > 500) {
      items = items.slice(0, 500);
    }

    const statuses = items
      .map(extractStatus)
      .filter((s): s is NonNullable<typeof s> => s !== null);

    if (statuses.length === 0) {
      console.log('[Webhook Status] No valid statuses extracted from:', JSON.stringify(body).slice(0, 300));
      return NextResponse.json({ success: true, stored: 0 });
    }

    // ─── Step 5: Enrich new-format events with driver info via links ───
    const API_KEY = process.env.MACHINE_API_KEY;
    const USERNAME = process.env.MACHINE_USERNAME;
    const PASSWORD = process.env.MACHINE_PASSWORD;

    for (const status of statuses) {
      const payload = status.raw_payload;
      if (isNewFormat(payload) && payload.links?.driver && API_KEY && USERNAME && PASSWORD) {
        try {
          const basicAuth = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
          const driverRes = await fetch(payload.links.driver, {
            headers: {
              'api-key': API_KEY,
              'Authorization': `Basic ${basicAuth}`,
            },
          });
          if (driverRes.ok) {
            const driverData = await driverRes.json();
            // Extract driver info from response
            const driver = driverData.condutor || driverData.driver || driverData;
            status.machine_condutor_id = driver.id ? String(driver.id) : status.machine_condutor_id;
            status.driver_name = driver.nome || driver.name || status.driver_name;
          }
        } catch {
          // Non-critical — continue without driver info
        }
      }
    }

    // ─── Step 6: UPSERT into ride_cache ───
    const supabase = createAdminClient();
    let totalStored = 0;

    const CHUNK_SIZE = 200;
    for (let i = 0; i < statuses.length; i += CHUNK_SIZE) {
      const chunk = statuses.slice(i, i + CHUNK_SIZE);
      const { error: upsertError } = await supabase
        .from('ride_cache')
        .upsert(
          chunk.map(s => ({
            machine_ride_id: s.machine_ride_id,
            machine_condutor_id: s.machine_condutor_id,
            machine_empresa_id: s.machine_empresa_id,
            driver_name: s.driver_name,
            empresa_name: s.empresa_name,
            status_code: s.status_code,
            status_label: s.status_label,
            status_detail: s.status_detail,
            latitude: s.latitude,
            longitude: s.longitude,
            machine_timestamp: s.machine_timestamp,
            received_at: s.received_at,
            raw_payload: s.raw_payload,
          })),
          { onConflict: 'machine_ride_id' }
        );

      if (upsertError) {
        console.error(`[Webhook Status] Chunk upsert error:`, upsertError.message);
      } else {
        totalStored += chunk.length;
      }
    }

    console.log(`[Webhook Status] Upserted ${totalStored}/${statuses.length}:`,
      statuses.map(s => `${s.machine_ride_id}=${s.status_code}`).join(', '));

    return NextResponse.json({ success: true, stored: totalStored });
  } catch (err) {
    console.error('[Webhook Status] Unexpected error:', err);
    return NextResponse.json({ success: true, error: 'internal_error' });
  }
}

/**
 * GET /api/webhook/status — debug (latest cached statuses)
 */
export async function GET(request: Request) {
  try {
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
      .from('ride_cache')
      .select('machine_ride_id, machine_condutor_id, driver_name, status_code, status_label, received_at, updated_at')
      .order('received_at', { ascending: false })
      .limit(30);

    return NextResponse.json({
      cached_count: data?.length || 0,
      statuses: data || [],
      error: error?.message || null,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) });
  }
}
