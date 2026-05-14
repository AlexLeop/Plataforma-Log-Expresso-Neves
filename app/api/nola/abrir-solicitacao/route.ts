import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    // Extração do corpo da requisição
    const body = await req.json();

    // Injeção de Credenciais e Repasse para a Machine
    const machineApiKey = process.env.MACHINE_API_KEY;
    const centralUser = process.env.MACHINE_USERNAME || '';
    const centralPass = process.env.MACHINE_PASSWORD || '';
    const basicAuth = Buffer.from(`${centralUser}:${centralPass}`).toString('base64');
    
    const baseUrl = process.env.MACHINE_API_BASE_URL || 'https://api.taximachine.com.br';
    console.log(`[Proxy Nola] Repassando solicitação para a Machine...`);

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
