/**
 * Evolution Go — WhatsApp message client
 * Sends messages via the Evolution Go API (self-hosted WhatsApp gateway)
 */

const EVOLUTION_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY;
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE_NAME;
const EVOLUTION_INSTANCE_TOKEN = process.env.EVOLUTION_INSTANCE_TOKEN;

interface SendTextPayload {
  number: string;   // e.g. "5521999999999"
  text: string;
  delay?: number;   // ms between sends (anti-spam)
}

interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Normalize phone to E.164-like format for WhatsApp (DDI + DDD + number, digits only)
 * Accepts: (21) 99999-9999, 21999999999, +5521999999999, 5521999999999
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');

  // Already has country code (55)
  if (digits.startsWith('55') && digits.length >= 12) {
    return digits;
  }

  // Missing country code — assume Brazil
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  return digits;
}

/**
 * Resolve the Evolution Go base URL from the configured env var.
 * Users may paste the manager panel URL (e.g. https://host/manager/instances),
 * but we need just the domain root for API calls.
 */
function getBaseUrl(): string | null {
  if (!EVOLUTION_URL) return null;
  // Strip /manager/instances or /manager or trailing slash
  return EVOLUTION_URL.replace(/\/manager(\/instances)?$/i, '').replace(/\/+$/, '');
}

/**
 * Send a text message via Supabase Edge Function → Evolution Go
 *
 * Strategy:
 * 1. Primary: Call the Supabase Edge Function 'send-whatsapp' (no Vercel timeout)
 * 2. Fallback: Call Evolution Go directly (if Supabase Edge Function unavailable)
 */
export async function sendWhatsAppText(
  phone: string,
  text: string,
  delayMs = 500
): Promise<SendResult> {
  const normalizedPhone = normalizePhone(phone);

  if (normalizedPhone.length < 12) {
    return { success: false, error: `Invalid phone: ${phone}` };
  }

  // Try Supabase Edge Function first (no Vercel timeout issues)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseKey) {
    try {
      console.log(`[EvolutionGo] Sending via Supabase Edge Function to ${normalizedPhone}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s for edge fn

      const res = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ phone: normalizedPhone, text, delay: delayMs }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await res.json();
      console.log('[EvolutionGo] Edge Function response:', JSON.stringify(data).slice(0, 300));

      if (data.success) {
        return { success: true, messageId: data.messageId };
      } else {
        return { success: false, error: data.error || 'Edge Function error' };
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.error('[EvolutionGo] Edge Function timed out after 30s');
        return { success: false, error: 'Timeout: Edge Function não respondeu em 30s' };
      }
      console.warn('[EvolutionGo] Edge Function failed, trying direct:', err);
      // Fall through to direct call
    }
  }

  // Fallback: Direct call to Evolution Go
  return sendDirectEvolutionGo(normalizedPhone, text, delayMs);
}

/**
 * Direct call to Evolution Go API (fallback)
 */
async function sendDirectEvolutionGo(
  normalizedPhone: string,
  text: string,
  delayMs: number
): Promise<SendResult> {
  const baseUrl = getBaseUrl();
  if (!baseUrl || !EVOLUTION_KEY || !EVOLUTION_INSTANCE) {
    return { success: false, error: 'Evolution Go not configured' };
  }

  try {
    const payload = {
      id: EVOLUTION_INSTANCE,
      number: normalizedPhone,
      text,
      delay: delayMs,
    };

    const endpoint = `${baseUrl}/send/text`;
    const authKey = EVOLUTION_INSTANCE_TOKEN || EVOLUTION_KEY;

    console.log(`[EvolutionGo] Direct send to ${normalizedPhone} via ${endpoint}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': authKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: `HTTP ${res.status}: ${body}` };
    }

    const data = await res.json();
    const messageId = data?.data?.Info?.ID || data?.key?.id || data?.id;
    const isSuccess = data?.message === 'success' || !!messageId;

    if (!isSuccess) {
      return { success: false, error: `Resposta inesperada: ${JSON.stringify(data).slice(0, 200)}` };
    }

    return { success: true, messageId };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { success: false, error: 'Timeout: Evolution Go não respondeu em 15s' };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/**
 * Build a CONSOLIDATED schedule message for a driver (all days in one message).
 * This avoids WhatsApp anti-spam and provides a better UX.
 */
export interface ScheduleEntry {
  entryDate: string;      // ISO date
  shiftLabel: string;
  shiftStart: string;     // HH:MM
  shiftEnd: string;       // HH:MM
  dailyRate: number;
  confirmUrl: string;
}

export function buildConsolidatedMessage(params: {
  driverName: string;
  companyName: string;
  entries: ScheduleEntry[];
}): string {
  const { driverName, companyName, entries } = params;
  const weekDays = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

  const formatRate = (val: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  // Sort entries by date
  const sorted = [...entries].sort((a, b) => a.entryDate.localeCompare(b.entryDate));

  // Build day lines
  const dayLines = sorted.map(e => {
    const [y, m, d] = e.entryDate.split('-');
    const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
    const dayName = weekDays[dateObj.getDay()];
    return `▸ *${dayName} ${d}/${m}* — ${e.shiftLabel} (${e.shiftStart}-${e.shiftEnd}) — ${formatRate(e.dailyRate)}`;
  });

  // Total value
  const totalRate = sorted.reduce((s, e) => s + e.dailyRate, 0);

  // Use the first entry's confirm URL as the general confirmation
  const confirmUrl = sorted[0]?.confirmUrl || '';

  const lines = [
    `Olá, *${driverName}*! `,
    '',
    `Você foi escalado para *${companyName}*:`,
    '',
    ...dayLines,
    '',
    ` Total: *${formatRate(totalRate)}* (${sorted.length} dia${sorted.length > 1 ? 's' : ''})`,
    '',
    `Confirme sua presença:`,
    confirmUrl,
    '',
    `_Expresso Neves_`,
  ];

  return lines.join('\n');
}

/**
 * Legacy single-day message builder (kept for backwards compatibility)
 */
export function buildScheduleMessage(params: {
  driverName: string;
  companyName: string;
  entryDate: string;
  shiftLabel: string;
  shiftStart: string;
  shiftEnd: string;
  dailyRate: number;
  confirmUrl: string;
}): string {
  return buildConsolidatedMessage({
    driverName: params.driverName,
    companyName: params.companyName,
    entries: [{
      entryDate: params.entryDate,
      shiftLabel: params.shiftLabel,
      shiftStart: params.shiftStart,
      shiftEnd: params.shiftEnd,
      dailyRate: params.dailyRate,
      confirmUrl: params.confirmUrl,
    }],
  });
}
