/**
 * Script de diagnóstico detalhado para o 400 Bad Request
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

const API_KEY = process.env.MACHINE_API_KEY!;
const USERNAME = process.env.MACHINE_USERNAME!;
const PASSWORD = process.env.MACHINE_PASSWORD!;

const basicAuth = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
const BASE = 'https://api.taximachine.com.br';

async function diagnose(label: string, url: string, headers: Record<string, string>) {
  console.log(`\n--- ${label} ---`);
  console.log(`URL: ${url}`);
  console.log(`Headers:`, JSON.stringify(headers, null, 2));

  try {
    const res = await fetch(url, { headers });
    const text = await res.text();
    console.log(`Status: ${res.status}`);
    console.log(`Response Headers:`, JSON.stringify(Object.fromEntries(res.headers.entries()), null, 2));
    console.log(`Body: ${text.substring(0, 500)}`);
  } catch (err) {
    console.log(`Error: ${err}`);
  }
}

async function main() {
  // Teste 1: api-key no header correto
  await diagnose('api-key header + Basic Auth', `${BASE}/api/integracao/condutor`, {
    'api-key': API_KEY,
    'Authorization': `Basic ${basicAuth}`,
    'Content-Type': 'application/json',
  });

  // Teste 2: Tentar api-key como query param
  await diagnose('api-key como query param', `${BASE}/api/integracao/condutor?api-key=${API_KEY}`, {
    'Authorization': `Basic ${basicAuth}`,
    'Content-Type': 'application/json',
  });

  // Teste 3: Tentar com header "x-api-key"
  await diagnose('x-api-key header', `${BASE}/api/integracao/condutor`, {
    'x-api-key': API_KEY,
    'Authorization': `Basic ${basicAuth}`,
    'Content-Type': 'application/json',
  });

  // Teste 4: Tentar com header "apikey" (sem hífen)
  await diagnose('apikey header', `${BASE}/api/integracao/condutor`, {
    'apikey': API_KEY,
    'Authorization': `Basic ${basicAuth}`,
    'Content-Type': 'application/json',
  });

  // Teste 5: Tentar api-key como senha do Basic Auth
  const apiKeyAsAuth = Buffer.from(`${USERNAME}:${API_KEY}`).toString('base64');
  await diagnose('api-key como password do Basic Auth', `${BASE}/api/integracao/condutor`, {
    'Authorization': `Basic ${apiKeyAsAuth}`,
    'Content-Type': 'application/json',
  });

  // Teste 6: GET empresa sem parâmetros
  await diagnose('GET /empresa (sem params)', `${BASE}/api/integracao/empresa`, {
    'api-key': API_KEY,
    'Authorization': `Basic ${basicAuth}`,
    'Content-Type': 'application/json',
  });

  // Teste 7: Tentar api-vendas com condutor
  await diagnose('api-vendas /condutor', `https://api-vendas.taximachine.com.br/api/integracao/condutor`, {
    'api-key': API_KEY,
    'Authorization': `Basic ${basicAuth}`,
    'Content-Type': 'application/json',
  });

  console.log('\n✅ Diagnóstico completo.\n');
}

main().catch(console.error);
