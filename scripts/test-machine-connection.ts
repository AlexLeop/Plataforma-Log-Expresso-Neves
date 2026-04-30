/**
 * Script de teste: Verifica conexão com a Machine API
 * 
 * Executa: npx tsx scripts/test-machine-connection.ts
 * 
 * Testa:
 * 1. Conexão básica (GET /condutor)
 * 2. Listagem de empresas (GET /empresa)
 * 3. Listagem de corridas recentes (GET /solicitacao)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

const API_KEY = process.env.MACHINE_API_KEY;
const BASE_URL = process.env.MACHINE_API_BASE_URL;
const USERNAME = process.env.MACHINE_USERNAME;
const PASSWORD = process.env.MACHINE_PASSWORD;

console.log('='.repeat(60));
console.log('TESTE DE CONEXÃO - MACHINE API (ENTREGAS)');
console.log('='.repeat(60));
console.log(`API Key: ${API_KEY ? API_KEY.substring(0, 12) + '...' : '❌ NÃO DEFINIDA'}`);
console.log(`Base URL: ${BASE_URL || '❌ NÃO DEFINIDA'}`);
console.log(`Username: ${USERNAME || '(vazio)'}`);
console.log(`Password: ${PASSWORD ? '***' : '(vazio)'}`);
console.log('='.repeat(60));

if (!API_KEY || !BASE_URL) {
  console.error('\n❌ Variáveis MACHINE_API_KEY e MACHINE_API_BASE_URL são obrigatórias');
  console.error('Configure no arquivo platform/.env.local');
  process.exit(1);
}

// Montar headers
function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'api-key': API_KEY!,
    'Content-Type': 'application/json',
  };

  if (USERNAME && PASSWORD) {
    const basicAuth = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
    headers['Authorization'] = `Basic ${basicAuth}`;
  }

  return headers;
}

async function testEndpoint(
  name: string,
  path: string,
  params: Record<string, string> = {}
): Promise<void> {
  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  console.log(`\n🔄 Testando: ${name}`);
  console.log(`   URL: ${url.toString()}`);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: getHeaders(),
    });

    console.log(`   Status: ${response.status} ${response.statusText}`);

    if (response.ok) {
      const data = await response.json();

      // Tentar extrair info útil
      if (Array.isArray(data)) {
        console.log(`   ✅ Sucesso! Retornou ${data.length} registros`);
        if (data.length > 0) {
          console.log(`   Primeiro registro (campos):`, Object.keys(data[0]).join(', '));
          console.log(`   Amostra:`, JSON.stringify(data[0], null, 2).substring(0, 500));
        }
      } else if (data && typeof data === 'object') {
        const keys = Object.keys(data);
        console.log(`   ✅ Sucesso! Campos retornados: ${keys.join(', ')}`);

        // Se tem uma propriedade 'data' como array
        if (Array.isArray(data.data)) {
          console.log(`   Registros em data[]: ${data.data.length}`);
          if (data.data.length > 0) {
            console.log(`   Campos do registro:`, Object.keys(data.data[0]).join(', '));
            console.log(`   Amostra:`, JSON.stringify(data.data[0], null, 2).substring(0, 500));
          }
        } else {
          console.log(`   Resposta:`, JSON.stringify(data, null, 2).substring(0, 500));
        }
      }
    } else {
      const text = await response.text();
      console.log(`   ❌ Erro! Body: ${text.substring(0, 300)}`);

      if (response.status === 401) {
        console.log('   💡 Dica: Verifique se api-key está correta e se precisa de Basic Auth');
      } else if (response.status === 403) {
        console.log('   💡 Dica: Verifique se a conta tem permissão "API - Empresa"');
      } else if (response.status === 429) {
        console.log('   💡 Dica: Rate limit atingido. Aguarde 1 minuto.');
      }
    }
  } catch (err) {
    console.log(`   ❌ Erro de conexão: ${err instanceof Error ? err.message : err}`);
  }
}

async function main() {
  // Teste 1: Listar entregadores (rate limit alto: 200/min)
  await testEndpoint(
    'Listar Entregadores',
    '/api/integracao/condutor',
    { limite: '5' }
  );

  // Teste 2: Listar empresas
  await testEndpoint(
    'Listar Empresas',
    '/api/integracao/empresa'
  );

  // Teste 3: Listar corridas recentes (últimas 24h)
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  await testEndpoint(
    'Listar Corridas (últimas 24h)',
    '/api/integracao/solicitacao',
    {
      data_hora_solicitacao_min: yesterday.toISOString(),
      data_hora_solicitacao_max: now.toISOString(),
      limite: '5',
      pagina: '1',
    }
  );

  // Teste 4: Testar sem Basic Auth (caso a api-key seja suficiente)
  if (!USERNAME && !PASSWORD) {
    console.log('\n' + '='.repeat(60));
    console.log('ℹ️  MACHINE_USERNAME e MACHINE_PASSWORD estão vazios.');
    console.log('Se os testes acima falharam com 401, preencha essas variáveis');
    console.log('no arquivo platform/.env.local e rode novamente.');
    console.log('='.repeat(60));
  }

  console.log('\n✅ Teste completo.\n');
}

main().catch(console.error);
