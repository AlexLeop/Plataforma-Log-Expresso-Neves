/**
 * API Route: /api/webhook/register
 * 
 * Registers webhooks with Machine API:
 *   - tipo: 'status'  → /api/webhook/status (ride status changes)
 *   - tipo: 'posicao' → /api/webhook/posicao (driver GPS every 15s)
 * 
 * Machine API webhook types (from docs):
 *   - 'status'   → fires on status change, driver arrival, stop confirmation
 *   - 'posicao'  → fires every 15s for drivers with rides in A, E, S states
 *   - 'mensagem' → fires on chat messages (not used yet)
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const API_KEY = process.env.MACHINE_API_KEY;
  const BASE_URL = process.env.MACHINE_API_BASE_URL;
  const USERNAME = process.env.MACHINE_USERNAME;
  const PASSWORD = process.env.MACHINE_PASSWORD;

  if (!API_KEY || !BASE_URL || !USERNAME || !PASSWORD) {
    return NextResponse.json({ error: 'Machine API not configured' }, { status: 500 });
  }

  const body = await req.json();
  const { webhookBaseUrl } = body;

  if (!webhookBaseUrl) {
    return NextResponse.json({ error: 'webhookBaseUrl is required' }, { status: 400 });
  }

  const baseUrl = webhookBaseUrl.startsWith('http') ? webhookBaseUrl : `https://${webhookBaseUrl}`;
  const basicAuth = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
  const headers = {
    'api-key': API_KEY,
    'Authorization': `Basic ${basicAuth}`,
    'Content-Type': 'application/json',
  };

  const results: Array<{ type: string; ok: boolean; status: number; response?: unknown; alreadyExists?: boolean }> = [];

  // ─── Register STATUS webhook ───
  try {
    const statusUrl = `${baseUrl}/api/webhook/status`;
    console.log(`[WebhookRegister] Registering STATUS webhook: ${statusUrl}`);

    const res = await fetch(`${BASE_URL}/api/integracao/cadastrarWebhook`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tipo: 'status',
        url: statusUrl,
        responsabilidade: 'corrida',
      }),
    });

    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }

    const alreadyExists = Array.isArray(parsed.errors) &&
      (parsed.errors as Array<{ code: number }>).some(e => e.code === 101);

    results.push({ type: 'status', ok: res.ok || alreadyExists, status: res.status, response: parsed, alreadyExists });
    console.log(`[WebhookRegister] STATUS: ${res.status} alreadyExists=${alreadyExists}`, JSON.stringify(parsed).slice(0, 200));
  } catch (err) {
    results.push({ type: 'status', ok: false, status: 0, response: String(err) });
  }

  // ─── Register POSITION webhook ───
  try {
    const positionUrl = `${baseUrl}/api/webhook/posicao`;
    console.log(`[WebhookRegister] Registering POSITION webhook: ${positionUrl}`);

    const res = await fetch(`${BASE_URL}/api/integracao/cadastrarWebhook`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tipo: 'posicao',
        url: positionUrl,
        responsabilidade: 'corrida',
      }),
    });

    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }

    const alreadyExists = Array.isArray(parsed.errors) &&
      (parsed.errors as Array<{ code: number }>).some(e => e.code === 101);

    results.push({ type: 'position', ok: res.ok || alreadyExists, status: res.status, response: parsed, alreadyExists });
    console.log(`[WebhookRegister] POSITION: ${res.status} alreadyExists=${alreadyExists}`, JSON.stringify(parsed).slice(0, 200));
  } catch (err) {
    results.push({ type: 'position', ok: false, status: 0, response: String(err) });
  }

  const allOk = results.every(r => r.ok);
  const allExisting = results.every(r => r.alreadyExists);

  return NextResponse.json({
    success: allOk,
    results,
    message: allOk
      ? (allExisting
        ? 'Webhooks ja estavam registrados. Status e posicao ativos.'
        : 'Webhooks registrados com sucesso! Status e posicao ativos.')
      : 'Alguns webhooks falharam. Verifique os detalhes.',
  }, { status: allOk ? 200 : 207 });
}
