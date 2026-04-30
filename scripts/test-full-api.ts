/**
 * Teste completo: busca dados reais dos 3 endpoints principais
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

const API_KEY = process.env.MACHINE_API_KEY!;
const USERNAME = process.env.MACHINE_USERNAME!;
const PASSWORD = process.env.MACHINE_PASSWORD!;
const BASE = 'https://api.taximachine.com.br';

const basicAuth = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');

function headers() {
  return {
    'api-key': API_KEY,
    'Authorization': `Basic ${basicAuth}`,
    'Content-Type': 'application/json',
  };
}

async function fetchJson(path: string, params: Record<string, string> = {}) {
  const url = new URL(`${BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), { headers: headers() });
  const data = await res.json();
  return { status: res.status, data };
}

async function main() {
  console.log('='.repeat(70));
  console.log('TESTE COMPLETO — MACHINE API (PRODUÇÃO)');
  console.log('='.repeat(70));

  // 1. CONDUTORES
  console.log('\n📋 1. CONDUTORES (GET /condutor)');
  const drivers = await fetchJson('/api/integracao/condutor', { limite: '5' });
  console.log(`   Status: ${drivers.status}`);
  const driverList = drivers.data?.response || (Array.isArray(drivers.data) ? drivers.data : []);
  console.log(`   Registros: ${driverList.length}`);
  if (driverList.length > 0) {
    console.log(`   Campos: ${Object.keys(driverList[0]).join(', ')}`);
    console.log(`   Primeiro:`, JSON.stringify(driverList[0], null, 2));
  }

  // 2. EMPRESAS
  console.log('\n📋 2. EMPRESAS (GET /empresa)');
  const companies = await fetchJson('/api/integracao/empresa');
  console.log(`   Status: ${companies.status}`);
  const companyList = companies.data?.response || (Array.isArray(companies.data) ? companies.data : []);
  console.log(`   Registros: ${companyList.length}`);
  if (companyList.length > 0) {
    console.log(`   Campos: ${Object.keys(companyList[0]).join(', ')}`);
    for (const c of companyList.slice(0, 5)) {
      console.log(`   → ${c.id || c.empresa_id}: ${c.nome || c.name || c.razao_social || JSON.stringify(c).substring(0, 100)}`);
    }
  }

  // 3. SOLICITAÇÕES (corridas)
  console.log('\n📋 3. SOLICITAÇÕES (GET /solicitacao)');
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const rides = await fetchJson('/api/integracao/solicitacao', {
    data_hora_solicitacao_min: weekAgo.toISOString(),
    data_hora_solicitacao_max: now.toISOString(),
    limite: '5',
    pagina: '1',
  });
  console.log(`   Status: ${rides.status}`);
  const rideList = rides.data?.response || (Array.isArray(rides.data) ? rides.data : []);
  console.log(`   Registros: ${rideList.length}`);
  if (rideList.length > 0) {
    console.log(`   Campos: ${Object.keys(rideList[0]).join(', ')}`);
    console.log(`   Primeira corrida:`, JSON.stringify(rideList[0], null, 2));
  }

  // Se o response wrapper é diferente, mostrar a estrutura bruta
  if (rideList.length === 0 && rides.data) {
    console.log(`   Estrutura bruta: ${JSON.stringify(rides.data).substring(0, 500)}`);
  }

  console.log('\n✅ Teste completo.\n');
}

main().catch(console.error);
