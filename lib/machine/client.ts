import type { MachineRideResponse, MachineDriverResponse } from '@/lib/types';

// ============================================================
// Client para API Machine (Entregas)
// ============================================================

const THROTTLE_MS = 750;

function getMachineCredentials() {
  const baseUrl = process.env.MACHINE_API_BASE_URL;
  const apiKey = process.env.MACHINE_API_KEY;
  const username = process.env.MACHINE_USERNAME;
  const password = process.env.MACHINE_PASSWORD;

  if (!baseUrl || !apiKey || !username || !password) {
    throw new Error('Missing Machine API environment variables');
  }

  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    apiKey,
    basicAuth: Buffer.from(`${username}:${password}`).toString('base64'),
  };
}

// Tipo do wrapper de resposta da Machine
interface MachineResponseWrapper<T> {
  success: boolean;
  response: T;
  errors?: Array<{ code: number; message: string }> | string[];
}

async function machineRequest<T>(
  endpoint: string,
  params: Record<string, string | number | undefined> = {}
): Promise<T> {
  const creds = getMachineCredentials();

  const url = new URL(`${creds.baseUrl}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) url.searchParams.set(key, String(value));
  });

  const response = await fetch(url.toString(), {
    headers: {
      'api-key': creds.apiKey,
      'Authorization': `Basic ${creds.basicAuth}`,
      'Content-Type': 'application/json',
    },
  });

  if (response.status === 429) {
    throw new Error('RATE_LIMITED');
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Machine API error ${response.status}: ${text}`);
  }

  const json = await response.json();

  // Machine retorna { success: true, response: [...] }
  if (json && typeof json === 'object' && 'success' in json) {
    const wrapper = json as MachineResponseWrapper<T>;
    if (!wrapper.success) {
      const errMsg = wrapper.errors
        ? JSON.stringify(wrapper.errors)
        : 'Unknown Machine API error';
      throw new Error(`Machine API: ${errMsg}`);
    }
    return wrapper.response;
  }

  return json as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// Endpoints de Ingestão
// ============================================================

export interface FetchRidesParams {
  empresa_id?: string;
  data_hora_solicitacao_min?: string;
  data_hora_solicitacao_max?: string;
  status_solicitacao?: string;
  pagina?: number;
  limite?: number;
}

export async function fetchRides(
  params: FetchRidesParams
): Promise<MachineRideResponse[]> {
  const result = await machineRequest<MachineRideResponse[]>(
    '/api/integracao/solicitacao',
    {
      empresa_id: params.empresa_id,
      data_hora_solicitacao_min: params.data_hora_solicitacao_min,
      data_hora_solicitacao_max: params.data_hora_solicitacao_max,
      status_solicitacao: params.status_solicitacao,
      pagina: params.pagina,
      limite: params.limite ?? 100,
    }
  );

  return Array.isArray(result) ? result : [];
}

export async function fetchAllRidesForCompany(
  empresaId: string,
  windowStart: string,
  windowEnd: string,
  maxPages: number = 3
): Promise<MachineRideResponse[]> {
  const allRides: MachineRideResponse[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const rides = await fetchRides({
      empresa_id: empresaId,
      data_hora_solicitacao_min: windowStart,
      data_hora_solicitacao_max: windowEnd,
      status_solicitacao: 'F',
      pagina: page,
      limite: 100,
    });

    allRides.push(...rides);

    if (rides.length < 100) break; // Última página
    await sleep(THROTTLE_MS);
  }

  return allRides;
}

export async function fetchDrivers(
  statusCondutor?: string
): Promise<MachineDriverResponse[]> {
  const result = await machineRequest<MachineDriverResponse[]>(
    '/api/integracao/condutor',
    { status_condutor: statusCondutor }
  );

  return Array.isArray(result) ? result : [];
}

export async function fetchCompanies(): Promise<Record<string, unknown>[]> {
  const result = await machineRequest<Record<string, unknown>[]>(
    '/api/integracao/empresa'
  );

  return Array.isArray(result) ? result : [];
}

// ============================================================
// Endpoints Proxy (para uso do frontend via nosso backend)
// ============================================================

export async function proxyRequest(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: Record<string, unknown>
): Promise<{ status: number; data: unknown }> {
  const creds = getMachineCredentials();

  const url = `${creds.baseUrl}${endpoint}`;
  const options: RequestInit = {
    method,
    headers: {
      'api-key': creds.apiKey,
      'Authorization': `Basic ${creds.basicAuth}`,
      'Content-Type': 'application/json',
    },
  };

  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);

  return { status: response.status, data };
}

export { sleep, THROTTLE_MS };
