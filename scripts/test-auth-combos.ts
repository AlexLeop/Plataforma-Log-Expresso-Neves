/**
 * Diagnóstico com código do cliente + múltiplas combinações de auth
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

const API_KEY = process.env.MACHINE_API_KEY!;
const USERNAME = process.env.MACHINE_USERNAME!;
const PASSWORD = process.env.MACHINE_PASSWORD!;
const CLIENT_CODE = process.env.MACHINE_CLIENT_CODE || '6816';

const BASE = 'https://api.taximachine.com.br';
const ENDPOINT = '/api/integracao/condutor';

console.log('Password loaded:', JSON.stringify(PASSWORD)); // Debug: verificar se # foi carregado

async function test(label: string, headers: Record<string, string>, url?: string) {
  const finalUrl = url || `${BASE}${ENDPOINT}`;
  console.log(`\n--- ${label} ---`);

  try {
    const res = await fetch(finalUrl, { headers });
    const text = await res.text();
    console.log(`Status: ${res.status}`);
    console.log(`Body: ${text.substring(0, 400)}`);
    if (res.status === 200) {
      console.log('🎉🎉🎉 SUCESSO! 🎉🎉🎉');
    }
  } catch (err) {
    console.log(`Error: ${err}`);
  }
}

async function main() {
  // 1. email:senha (original)
  const auth1 = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
  await test('email:senha', {
    'api-key': API_KEY, 'Authorization': `Basic ${auth1}`, 'Content-Type': 'application/json'
  });

  // 2. codigo_cliente:senha
  const auth2 = Buffer.from(`${CLIENT_CODE}:${PASSWORD}`).toString('base64');
  await test('codigo:senha', {
    'api-key': API_KEY, 'Authorization': `Basic ${auth2}`, 'Content-Type': 'application/json'
  });

  // 3. email:codigo
  const auth3 = Buffer.from(`${USERNAME}:${CLIENT_CODE}`).toString('base64');
  await test('email:codigo', {
    'api-key': API_KEY, 'Authorization': `Basic ${auth3}`, 'Content-Type': 'application/json'
  });

  // 4. codigo:api_key
  const auth4 = Buffer.from(`${CLIENT_CODE}:${API_KEY}`).toString('base64');
  await test('codigo:api_key', {
    'api-key': API_KEY, 'Authorization': `Basic ${auth4}`, 'Content-Type': 'application/json'
  });

  // 5. Sem Basic Auth, apenas api-key + codigo como header
  await test('api-key + codigo como header', {
    'api-key': API_KEY, 'codigo': CLIENT_CODE, 'Content-Type': 'application/json'
  });

  // 6. api-key + central_id como param
  await test('api-key + central_id param', {
    'api-key': API_KEY, 'Content-Type': 'application/json'
  }, `${BASE}${ENDPOINT}?central_id=${CLIENT_CODE}`);

  // 7. Tentar POST com email/senha como body
  console.log('\n--- POST com login no body ---');
  try {
    const res = await fetch(`${BASE}${ENDPOINT}`, {
      method: 'POST',
      headers: { 'api-key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: USERNAME, senha: PASSWORD, codigo: CLIENT_CODE }),
    });
    console.log(`Status: ${res.status}`);
    console.log(`Body: ${(await res.text()).substring(0, 400)}`);
  } catch (err) {
    console.log(`Error: ${err}`);
  }

  // 8. Basic auth com email:senha mas api-key inclui código
  const auth8 = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
  await test('email:senha + api-key com codigo query', {
    'api-key': API_KEY, 'Authorization': `Basic ${auth8}`, 'Content-Type': 'application/json'
  }, `${BASE}${ENDPOINT}?codigo=${CLIENT_CODE}`);

  console.log('\n✅ Completo.\n');
}

main().catch(console.error);
