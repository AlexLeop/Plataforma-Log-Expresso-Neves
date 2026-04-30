import { NextResponse } from 'next/server';
import { machinePost, MACHINE_ENDPOINTS } from '@/lib/machine-api';
import { companyRegisterSchema } from '@/lib/validations/company';

export const dynamic = 'force-dynamic';

// ─── Rate Limiting (in-memory) ───────────────────────────────
// Max 3 registrations per IP per hour
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS = 3;
const requestLog = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = requestLog.get(ip) || [];

  // Clean old entries
  const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  requestLog.set(ip, recent);

  if (recent.length >= MAX_REQUESTS) {
    return true;
  }

  recent.push(now);
  requestLog.set(ip, recent);
  return false;
}

// Clean up stale entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of requestLog.entries()) {
    const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (recent.length === 0) {
      requestLog.delete(ip);
    } else {
      requestLog.set(ip, recent);
    }
  }
}, 10 * 60 * 1000);

// ─── Get client IP ──────────────────────────────────────────
function getClientIP(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const real = request.headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}

/**
 * POST /api/machine/companies/register
 * Public endpoint for company self-registration.
 * 
 * Protected by: rate limiting (3/hour/IP), honeypot, CNPJ validation (zod)
 */
export async function POST(request: Request) {
  try {
    // Rate limit check
    const ip = getClientIP(request);
    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: 'Muitas tentativas. Tente novamente em 1 hora.' },
        { status: 429 }
      );
    }

    const body = await request.json();

    // Validate with zod
    const parsed = companyRegisterSchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      return NextResponse.json(
        { error: firstError.message, field: firstError.path.join('.'), details: parsed.error.issues },
        { status: 400 }
      );
    }

    const data = parsed.data;

    // Honeypot check — bots fill hidden fields
    if (data.website && data.website.length > 0) {
      // Silently "succeed" to not tip off the bot
      console.log(`[Register Company] Honeypot triggered from IP: ${ip}`);
      return NextResponse.json({
        success: true,
        data: { id: 0 },
        numero_contrato: '000000',
      });
    }

    // Generate random 6-digit contract number
    const numero_contrato = String(Math.floor(100000 + Math.random() * 900000));

    // Clean formatting from user input
    const cleanPhone = data.telefone.replace(/\D/g, '');
    const cleanCEP = data.cep ? data.cep.replace(/\D/g, '') : '';
    const cleanDoc = data.documento.replace(/\D/g, '');

    // Extract DDD and number from phone (e.g. "21999991234" → ddd: "21", numero: "999991234")
    const ddd = cleanPhone.slice(0, 2);
    const phoneNumber = cleanPhone.slice(2);

    // Category ID
    const categoriaId = Number(data.categoria_id) || 40065;

    // Build Machine API payload — following documented structure
    const machineBody: Record<string, unknown> = {
      documento: cleanDoc,
      tipo_documento: 'CNPJ',
      numero_contrato,
      nome_fantasia: data.nome_fantasia,
      endereco: {
        logradouro: data.endereco || '',
        complemento: data.complemento || null,
        uf: data.uf || '',
        cidade: data.cidade || '',
        bairro: data.bairro || '',
        cep: cleanCEP,
      },
      telefone: {
        ddd,
        numero: phoneNumber,
      },
      situacao_cadastral: 'S', // Inativa por padrão (aguarda aprovação admin)
      categorias: [categoriaId],
      tipos_pagamento: ['F'], // Faturado
      cobrar_retorno: false,
      obrigar_finalizacao_com_retorno_pela_empresa: false,
      solicitacao_rapida: {
        habilitar: true,
        categoria: categoriaId,
        tipo_pagamento: 'F',
      },
    };

    // Only include lat/lng in endereco if they have actual values
    if (data.lat && data.lat.trim() !== '') {
      (machineBody.endereco as Record<string, unknown>).lat = data.lat;
    }
    if (data.lng && data.lng.trim() !== '') {
      (machineBody.endereco as Record<string, unknown>).lng = data.lng;
    }


    const result = await machinePost(MACHINE_ENDPOINTS.cadastrarEmpresa, machineBody);

    if (!result.ok) {
      console.error('[Register Company] Machine API error:', JSON.stringify(result.details));
      // Extract user-friendly error from Machine API response
      const machineError = typeof result.details === 'object' && result.details !== null
        ? (result.details as Record<string, unknown>).message || (result.details as Record<string, unknown>).error || result.error
        : result.error;
      return NextResponse.json(
        { error: String(machineError), details: result.details },
        { status: result.status || 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result.data,
      numero_contrato,
    });
  } catch (err) {
    console.error('[Register Company] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Erro desconhecido' },
      { status: 500 }
    );
  }
}
