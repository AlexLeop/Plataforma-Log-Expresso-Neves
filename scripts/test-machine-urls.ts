/**
 * Script de teste: Testa múltiplas URLs da Machine API
 * 
 * Executa: npx tsx scripts/test-machine-urls.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

const API_KEY = process.env.MACHINE_API_KEY!;
const USERNAME = process.env.MACHINE_USERNAME!;
const PASSWORD = process.env.MACHINE_PASSWORD!;

const basicAuth = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');

const URLS_TO_TRY = [
  'https://api.taximachine.com.br',
  'https://api-vendas.taximachine.com.br',
  'https://api-trial.taximachine.com.br',
];

const ENDPOINTS_TO_TRY = [
  '/api/integracao/condutor?limite=2',
  '/api/integracao/empresa',
  '/integracao/v1/condutor?limite=2',
  '/integracao/v1/empresa',
];

async function tryUrl(baseUrl: string, endpoint: string): Promise<void> {
  const url = `${baseUrl}${endpoint}`;
  try {
    const response = await fetch(url, {
      headers: {
        'api-key': API_KEY,
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
      },
    });

    const status = response.status;
    if (status === 200) {
      const data = await response.json();
      const count = Array.isArray(data) ? data.length : (data?.data?.length ?? '?');
      console.log(`✅ ${status} | ${url} | ${count} registros`);
      if (Array.isArray(data) && data.length > 0) {
        console.log(`   Campos: ${Object.keys(data[0]).join(', ')}`);
        console.log(`   Amostra: ${JSON.stringify(data[0]).substring(0, 300)}`);
      } else if (data?.data && Array.isArray(data.data) && data.data.length > 0) {
        console.log(`   Campos: ${Object.keys(data.data[0]).join(', ')}`);
        console.log(`   Amostra: ${JSON.stringify(data.data[0]).substring(0, 300)}`);
      } else {
        console.log(`   Resposta: ${JSON.stringify(data).substring(0, 300)}`);
      }
    } else {
      console.log(`❌ ${status} | ${url}`);
    }
  } catch (err) {
    console.log(`💥 ERR | ${url} | ${err instanceof Error ? err.message : err}`);
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('TESTE DE URLS - MACHINE API');
  console.log(`API Key: ${API_KEY.substring(0, 12)}...`);
  console.log(`Auth: Basic (${USERNAME})`);
  console.log('='.repeat(70));

  // Também tentar apenas com api-key e sem Basic Auth
  for (const baseUrl of URLS_TO_TRY) {
    for (const endpoint of ENDPOINTS_TO_TRY) {
      await tryUrl(baseUrl, endpoint);
    }
    console.log('---');
  }

  // Tentar sem Basic Auth (apenas api-key)
  console.log('\n--- SEM Basic Auth (apenas api-key) ---');
  for (const baseUrl of URLS_TO_TRY) {
    const url = `${baseUrl}/api/integracao/condutor?limite=2`;
    try {
      const response = await fetch(url, {
        headers: {
          'api-key': API_KEY,
          'Content-Type': 'application/json',
        },
      });
      const status = response.status;
      if (status === 200) {
        console.log(`✅ ${status} | ${url} (SEM Basic Auth)`);
      } else {
        console.log(`❌ ${status} | ${url} (SEM Basic Auth)`);
      }
    } catch (err) {
      console.log(`💥 ERR | ${url}`);
    }
  }

  console.log('\n✅ Teste completo.\n');
}

main().catch(console.error);
