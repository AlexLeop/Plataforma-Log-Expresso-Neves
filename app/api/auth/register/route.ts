import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/client';
import { machinePost, machineGet, MACHINE_ENDPOINTS } from '@/lib/machine-api';
import { onboardingRegisterSchema } from '@/lib/validations/company';
import { generateWhiteLabelAlias } from '@/lib/email-alias';

export const dynamic = 'force-dynamic';

// ─── Rate Limiting (in-memory) ───────────────────────────────
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS = 3;
const requestLog = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = requestLog.get(ip) || [];
  const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  requestLog.set(ip, recent);
  if (recent.length >= MAX_REQUESTS) return true;
  recent.push(now);
  requestLog.set(ip, recent);
  return false;
}

function getClientIP(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

// Cleanup stale entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of requestLog.entries()) {
    const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (recent.length === 0) requestLog.delete(ip);
    else requestLog.set(ip, recent);
  }
}, 10 * 60 * 1000);

/**
 * POST /api/auth/register — Full Onboarding with Shadow Registration
 *
 * Orchestrated flow:
 *   A. Create user in Supabase Auth
 *   B. Insert company in Supabase DB
 *   C. Create company in Machine API
 *   D. Link machine_empresa_id + create user record
 *   E. Generate shadow alias + create setup_task
 *   F. Return success
 *
 * ROLLBACK: If Machine fails, we delete the Supabase Auth user + company.
 *
 * FINANCIAL INTEGRITY: This endpoint does NOT touch manual_entries,
 * credit_queue, or any financial tables.
 */
export async function POST(request: Request) {
  const supabase = createAdminClient();

  // Track created resources for rollback
  let createdAuthUserId: string | null = null;
  let createdCompanyId: string | null = null;

  try {
    // ─── Rate limiting ───
    const ip = getClientIP(request);
    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: 'Muitas tentativas. Tente novamente em 1 hora.' },
        { status: 429 }
      );
    }

    // ─── Validation ───
    const body = await request.json();

    // Honeypot check
    if (body.website && body.website.length > 0) {
      console.log(`[Register] Honeypot triggered from IP: ${ip}`);
      return NextResponse.json({ success: true, message: 'Cadastro realizado com sucesso.' });
    }

    const parsed = onboardingRegisterSchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      return NextResponse.json(
        { error: firstError.message, field: firstError.path.join('.'), details: parsed.error.issues },
        { status: 400 }
      );
    }

    const data = parsed.data;

    // ═══════════════════════════════════════════════════════════
    // PASSO A — Criar usuário no Supabase Auth
    // ═══════════════════════════════════════════════════════════
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true, // Auto-confirm — no email verification needed
      user_metadata: {
        full_name: data.nome_fantasia,
        role: 'lojista',
      },
    });

    if (authError || !authData.user) {
      const msg = authError?.message || 'Erro ao criar usuário';
      // Check for duplicate email
      if (msg.includes('already') || msg.includes('duplicate') || msg.includes('exists')) {
        return NextResponse.json(
          { error: 'Este e-mail já está cadastrado. Faça login ou use outro e-mail.', field: 'email' },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    createdAuthUserId = authData.user.id;
    console.log(`[Register] Passo A concluído: Auth user ${createdAuthUserId}`);

    // ═══════════════════════════════════════════════════════════
    // PASSO B — Inserir empresa na tabela companies
    // ═══════════════════════════════════════════════════════════
    const { data: companyData, error: companyError } = await supabase
      .from('companies')
      .insert({
        name: data.nome_fantasia,
        machine_empresa_id: 'pending', // Placeholder — updated in Passo D after Machine returns real ID
        address: [data.endereco, data.bairro, data.cidade, data.uf].filter(Boolean).join(', ') || null,
        active: false, // Inactive until admin approves
        sync_status: 'pending',
      })
      .select('id')
      .single();

    if (companyError || !companyData) {
      console.error('[Register] Passo B falhou:', companyError?.message, companyError?.details, companyError?.hint, companyError?.code);
      // Rollback A
      await supabase.auth.admin.deleteUser(createdAuthUserId);
      return NextResponse.json(
        { error: `Erro ao registrar empresa: ${companyError?.message || 'dados inválidos'}`, code: companyError?.code, hint: companyError?.hint },
        { status: 500 }
      );
    }

    createdCompanyId = companyData.id;
    console.log(`[Register] Passo B concluído: Company ${createdCompanyId}`);

    // ═══════════════════════════════════════════════════════════
    // PASSO C — Criar empresa na Machine API
    // ═══════════════════════════════════════════════════════════
    const cleanPhone = data.telefone.replace(/\D/g, '');
    const cleanCEP = data.cep ? data.cep.replace(/\D/g, '') : '';
    const cleanDoc = data.documento.replace(/\D/g, '');
    const ddd = cleanPhone.slice(0, 2);
    const phoneNumber = cleanPhone.slice(2);
    const categoriaId = Number(data.categoria_id) || 40065;
    const numero_contrato = String(Math.floor(100000 + Math.random() * 900000));

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
        ...(data.lat && data.lat.trim() !== '' ? { lat: data.lat } : {}),
        ...(data.lng && data.lng.trim() !== '' ? { lng: data.lng } : {}),
      },
      telefone: { ddd, numero: phoneNumber },
      situacao_cadastral: 'S', // Inativa (aguarda aprovação)
      categorias: [categoriaId],
      tipos_pagamento: ['F'],
      cobrar_retorno: false,
      obrigar_finalizacao_com_retorno_pela_empresa: false,
      solicitacao_rapida: {
        habilitar: true,
        categoria: categoriaId,
        tipo_pagamento: 'F',
      },
    };

    const machineResult = await machinePost(MACHINE_ENDPOINTS.cadastrarEmpresa, machineBody);

    if (!machineResult.ok) {
      console.error('[Register] Passo C falhou:', JSON.stringify(machineResult));
      // Rollback B + A
      await supabase.from('companies').delete().eq('id', createdCompanyId);
      await supabase.auth.admin.deleteUser(createdAuthUserId);
      createdCompanyId = null;
      createdAuthUserId = null;

      const machineError = typeof machineResult.details === 'object' && machineResult.details !== null
        ? (machineResult.details as Record<string, unknown>).message ||
          (machineResult.details as Record<string, unknown>).error ||
          machineResult.error
        : machineResult.error;

      return NextResponse.json(
        { error: `Erro ao registrar na plataforma de entregas: ${String(machineError)}`, details: machineResult.details },
        { status: 500 }
      );
    }

    // Machine's cadastrarEmpresa does NOT return the empresa_id.
    // We need to query the empresa by CNPJ to get the ID.
    console.log('[Register] Passo C: Empresa criada na Machine, buscando ID pelo CNPJ...');
    
    // Small delay to let Machine's DB commit
    await new Promise(r => setTimeout(r, 1000));
    
    const lookupResult = await machineGet(MACHINE_ENDPOINTS.empresa, { documento: cleanDoc });
    
    let machineEmpresaId = '';
    if (lookupResult.ok) {
      const lookupData = lookupResult.data as Record<string, unknown>;
      console.log('[Register] Lookup result keys:', Object.keys(lookupData));
      
      // Machine may return the empresa directly or in an array/response wrapper
      if (lookupData.id) {
        machineEmpresaId = String(lookupData.id);
      } else if (lookupData.empresa_id) {
        machineEmpresaId = String(lookupData.empresa_id);
      } else if (Array.isArray(lookupData.response)) {
        const first = (lookupData.response as Record<string, unknown>[])[0];
        if (first?.id) machineEmpresaId = String(first.id);
      } else if (typeof lookupData.response === 'object' && lookupData.response !== null) {
        const resp = lookupData.response as Record<string, unknown>;
        if (resp.id) machineEmpresaId = String(resp.id);
        else if (resp.empresa_id) machineEmpresaId = String(resp.empresa_id);
      }
      
      // If data is an array directly
      if (!machineEmpresaId && Array.isArray(lookupData)) {
        const first = (lookupData as unknown as Record<string, unknown>[])[0];
        if (first?.id) machineEmpresaId = String(first.id);
      }
      
      console.log('[Register] Full lookup data:', JSON.stringify(lookupData).slice(0, 500));
    } else {
      console.error('[Register] Lookup failed:', JSON.stringify(lookupResult));
    }

    // Fallback: use the CNPJ as identifier if we still can't get the ID
    if (!machineEmpresaId || machineEmpresaId === '' || machineEmpresaId === 'undefined') {
      console.warn('[Register] Could not extract empresa_id from Machine. Using CNPJ as fallback identifier.');
      machineEmpresaId = `cnpj_${cleanDoc}`;
    }

    console.log(`[Register] Passo C concluído: Machine empresa_id ${machineEmpresaId}`);

    // ═══════════════════════════════════════════════════════════
    // PASSO D — Vincular machine_empresa_id + criar user record
    // ═══════════════════════════════════════════════════════════
    await supabase
      .from('companies')
      .update({ machine_empresa_id: machineEmpresaId })
      .eq('id', createdCompanyId);

    const { error: userError } = await supabase
      .from('users')
      .upsert({
        id: createdAuthUserId,
        company_id: createdCompanyId,
        email: data.email,
        full_name: data.nome_fantasia,
        role: 'manager', // DB CHECK: 'admin' | 'operator' | 'manager' | 'viewer'
      }, { onConflict: 'id' });

    if (userError) {
      console.error('[Register] Passo D - users upsert failed:', userError.message, userError.code);
    }

    console.log(`[Register] Passo D concluído: Vínculos criados`);

    // ═══════════════════════════════════════════════════════════
    // PASSO E — Gerar Shadow Task com alias de e-mail
    // ═══════════════════════════════════════════════════════════
    // Buscar support_email
    let supportEmail = process.env.DEFAULT_SUPPORT_EMAIL || 'lx.leopoldo@gmail.com';
    try {
      const { data: settingsData } = await supabase
        .from('system_settings')
        .select('support_email')
        .eq('id', 1)
        .single();

      if (settingsData?.support_email) {
        supportEmail = settingsData.support_email;
      }
    } catch {
      console.warn('[Register] Falha ao buscar support_email, usando fallback');
    }

    // Gerar alias
    const aliasEmail = generateWhiteLabelAlias(supportEmail, machineEmpresaId);

    // Criar setup_task
    await supabase
      .from('setup_tasks')
      .insert({
        company_id: createdCompanyId,
        machine_empresa_id: machineEmpresaId,
        generated_alias_email: aliasEmail,
        status: 'pending',
      });

    console.log(`[Register] Passo E concluído: Alias ${aliasEmail}, setup_task criada`);

    // ═══════════════════════════════════════════════════════════
    // PASSO F — Retorno de sucesso
    // ═══════════════════════════════════════════════════════════
    return NextResponse.json({
      success: true,
      message: 'Cadastro realizado com sucesso! Você já pode fazer login.',
      user_id: createdAuthUserId,
      company_id: createdCompanyId,
      machine_empresa_id: machineEmpresaId,
      numero_contrato,
    });

  } catch (err) {
    console.error('[Register] Unexpected error:', err);

    // Best-effort rollback
    if (createdCompanyId) {
      try { await supabase.from('companies').delete().eq('id', createdCompanyId); } catch { /* ignore */ }
    }
    if (createdAuthUserId) {
      try { await supabase.auth.admin.deleteUser(createdAuthUserId); } catch { /* ignore */ }
    }

    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Erro desconhecido no cadastro. Tente novamente.' },
      { status: 500 }
    );
  }
}
