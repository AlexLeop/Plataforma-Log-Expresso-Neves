import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    // 1. Validação de Segurança de Entrada (Token do Nola)
    const authHeader = req.headers.get('authorization');
    let nolaToken = process.env.NOLA_CLIENT_TOKEN || '';

    // Remove aspas se existirem (comum em arquivos .env lidos manualmente)
    nolaToken = nolaToken.replace(/^["']|["']$/g, '');

    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== nolaToken) {
      return NextResponse.json({ erro: 'Não autorizado. Token inválido ou ausente.' }, { status: 401 });
    }

    // 2. Extração e Normalização do Corpo da Requisição
    const body = await req.json();
    
    // Normalização: se o Nola enviar campos no formato "interno", 
    // convertemos para o formato que a Machine API espera.
    const machineBody: Record<string, any> = {
      empresa_id: body.empresa_id,
      forma_pagamento: body.forma_pagamento || body.tipo_pagamento || 'F',
      observacao: body.observacao || '',
      agendamento: body.agendamento || null,
    };

    // Mapeamento do Ponto de Coleta (Partida)
    if (body.endereco_coleta || body.lat_coleta) {
      machineBody.partida = {
        endereco: body.endereco_coleta || '',
        lat: body.lat_coleta || '',
        lng: body.lng_coleta || '',
        // Campos extras que a Machine costuma pedir, mesmo que vazios
        bairro: body.bairro_coleta || '',
        cidade: body.cidade_coleta || '',
        estado: body.estado_coleta || 'RJ',
      };
    } else if (body.partida) {
      // Já está no formato Machine
      machineBody.partida = body.partida;
    }

    // Mapeamento das Paradas
    if (Array.isArray(body.paradas)) {
      machineBody.paradas = body.paradas.map((p: any) => {
        // Se já tiver os campos da Machine, mantém. 
        // Caso contrário, mapeia do formato "interno".
        return {
          endereco_parada: p.endereco_parada || p.endereco || '',
          lat_parada: p.lat_parada || p.lat || '',
          lng_parada: p.lng_parada || p.lng || '',
          complemento_parada: p.complemento_parada || p.numero || '',
          nome_cliente_parada: p.nome_cliente_parada || p.nome || '',
          telefone_cliente_parada: p.telefone_cliente_parada || p.telefone || '',
          observacao_parada: p.observacao_parada || p.observacao || '',
          bairro_parada: p.bairro_parada || '',
          cidade_parada: p.cidade_parada || '',
          estado_parada: p.estado_parada || '',
        };
      });
    }

    const empresaId = machineBody.empresa_id;

    if (!empresaId) {
      return NextResponse.json({ erro: 'O campo empresa_id é obrigatório.' }, { status: 400 });
    }

    // 3. Validação de Escopo (Autorização da Empresa)
    const authorizedIdsStr = process.env.AUTHORIZED_NOLA_COMPANY_IDS || '';
    const authorizedIds = authorizedIdsStr.split(',').map(id => id.trim().replace(/^["']|["']$/g, ''));

    if (!authorizedIds.includes(String(empresaId))) {
      return NextResponse.json(
        { erro: 'Empresa não autorizada a utilizar a integração Nola via este gateway.' }, 
        { status: 403 }
      );
    }

    // 4. Injeção de Credenciais e Repasse para a Machine
    const machineApiKey = process.env.MACHINE_API_KEY;
    const centralUser = process.env.MACHINE_USERNAME || '';
    const centralPass = process.env.MACHINE_PASSWORD || '';
    const basicAuth = Buffer.from(`${centralUser}:${centralPass}`).toString('base64');
    
    const baseUrl = process.env.MACHINE_API_BASE_URL || 'https://api.taximachine.com.br';
    console.log(`[Proxy Nola] Repassando solicitação da empresa ${empresaId} para a Machine...`);

    const machineResponse = await fetch(`${baseUrl}/api/integracao/abrirSolicitacao`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': machineApiKey || '',
        'Authorization': `Basic ${basicAuth}`,
      },
      body: JSON.stringify(machineBody),
    });

    const responseText = await machineResponse.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      data = responseText;
    }

    // 5. Mapeamento de Erros e Retorno
    if (!machineResponse.ok) {
      console.error('[Proxy Nola] Erro retornado pela Machine:', data);
      return NextResponse.json(
        { erro: 'A Machine rejeitou a solicitação.', detalhes: data },
        { status: machineResponse.status }
      );
    }

    return NextResponse.json(data, { status: 200 });

  } catch (error: any) {
    console.error('[Proxy Nola] Erro interno:', error);
    return NextResponse.json(
      { erro: 'Erro interno de processamento do Gateway.', detalhes: error.message },
      { status: 500 }
    );
  }
}
