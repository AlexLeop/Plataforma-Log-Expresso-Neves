import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    // 1. Validação de Segurança de Entrada (Token do Nola)
    const authHeader = req.headers.get('authorization');
    const nolaToken = process.env.NOLA_CLIENT_TOKEN;

    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== nolaToken) {
      return NextResponse.json({ erro: 'Não autorizado. Token inválido ou ausente.' }, { status: 401 });
    }

    // 2. Extração e Validação do Corpo da Requisição
    const body = await req.json();
    const empresaId = body.empresa_id;

    if (!empresaId) {
      return NextResponse.json({ erro: 'O campo empresa_id é obrigatório.' }, { status: 400 });
    }

    // 3. Validação de Escopo (Autorização da Empresa)
    // Lê os IDs liberados para uso do Nola no .env (ex: "ID1,ID2,ID3")
    const authorizedIdsStr = process.env.AUTHORIZED_NOLA_COMPANY_IDS || '';
    const authorizedIds = authorizedIdsStr.split(',').map(id => id.trim());

    // Se a variável estiver vazia, ou o ID não constar na lista bloqueia.
    // Desta forma, o Nola não conseguirá abrir OS para outros lojistas pela sua API
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
      // Enviamos o body original do Nola intacto, sem misturar a chave
      body: JSON.stringify(body),
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
