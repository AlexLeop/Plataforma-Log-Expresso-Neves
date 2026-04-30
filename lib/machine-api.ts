/**
 * Machine API Client — Centralized module for all Machine API interactions.
 * 
 * All routes should use this module instead of hardcoding env vars and URLs.
 * To update the Machine API base URL or auth, change it here only.
 * 
 * Features:
 * - Automatic retry with exponential backoff (3 attempts)
 * - Structured error handling
 * - Request/response logging
 */

// ─── Configuration ───────────────────────────────────────────────

function getConfig() {
  const API_KEY = process.env.MACHINE_API_KEY;
  const BASE_URL = process.env.MACHINE_API_BASE_URL;
  const USERNAME = process.env.MACHINE_USERNAME;
  const PASSWORD = process.env.MACHINE_PASSWORD;

  if (!API_KEY || !BASE_URL || !USERNAME || !PASSWORD) {
    throw new Error('Machine API credentials not configured. Check .env.local');
  }

  return { API_KEY, BASE_URL, USERNAME, PASSWORD };
}

function getAuthHeaders() {
  const { API_KEY, USERNAME, PASSWORD } = getConfig();
  const basicAuth = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');

  return {
    'api-key': API_KEY,
    'Authorization': `Basic ${basicAuth}`,
    'Content-Type': 'application/json',
  };
}

// ─── Retry Configuration ─────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000; // 1s, 2s, 4s

/** Status codes that should NOT be retried (client errors) */
const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404, 405, 422]);

function shouldRetry(status: number, attempt: number): boolean {
  if (attempt >= MAX_RETRIES) return false;
  if (status === 0) return true; // Network error — always retry
  if (NON_RETRYABLE_STATUSES.has(status)) return false;
  return status >= 500 || status === 429; // Server errors + rate limit
}

function getRetryDelay(attempt: number): number {
  // Exponential backoff with jitter: 1s, 2s, 4s ± random
  const baseDelay = BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * 500; // 0-500ms jitter
  return baseDelay + jitter;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Endpoints (centralized) ─────────────────────────────────────

export const MACHINE_ENDPOINTS = {
  // Companies
  empresa: '/api/integracao/empresa',
  cadastrarEmpresa: '/api/integracao/cadastrarEmpresa',
  atualizarEmpresas: '/api/integracao/atualizarEmpresas',

  // Drivers
  condutor: '/api/integracao/condutor',

  // Rides
  solicitacao: '/api/integracao/solicitacao',
  solicitacaoStatus: '/api/integracao/solicitacaoStatus',
  abrirSolicitacao: '/api/integracao/abrirSolicitacao',
  cancelar: '/api/integracao/cancelar',
  estimarSolicitacao: '/api/integracao/estimarSolicitacao',
  consultarProgramada: '/api/integracao/consultarProgramada',
  obterLinkRastreio: '/api/integracao/obterLinkRastreio', // append /:id

  // Credits
  saldoCreditosEmpresa: '/api/integracao/saldoCreditosEmpresa',
  saldoCreditosCondutor: '/api/integracao/saldoCreditosCondutor',
  recarregarCreditosCondutor: '/api/integracao/recarregarCreditosCondutor',
  sacarCreditosCondutor: '/api/integracao/sacarCreditosCondutor',

  // Webhooks
  cadastrarWebhook: '/api/integracao/cadastrarWebhook',
} as const;

// ─── Core fetch helpers ──────────────────────────────────────────

export type MachineResponse<T = unknown> = {
  ok: true;
  status: number;
  data: T;
} | {
  ok: false;
  status: number;
  error: string;
  details?: unknown;
  retries?: number;
};

/**
 * Internal fetch with automatic retry and exponential backoff.
 */
async function machineFetch<T>(
  method: 'GET' | 'POST' | 'PUT',
  endpoint: string,
  body?: unknown,
  queryParams?: Record<string, string>,
): Promise<MachineResponse<T>> {
  const { BASE_URL } = getConfig();
  const headers = getAuthHeaders();

  let url = `${BASE_URL}${endpoint}`;
  if (queryParams) {
    const params = new URLSearchParams(queryParams);
    url += `?${params.toString()}`;
  }

  let lastError: MachineResponse<T> | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = getRetryDelay(attempt - 1);
      console.warn(`[MachineAPI] Retry ${attempt}/${MAX_RETRIES} for ${method} ${endpoint} in ${Math.round(delay)}ms`);
      await sleep(delay);
    }

    try {
      const fetchOptions: RequestInit = { method, headers };
      if (body && (method === 'POST' || method === 'PUT')) {
        fetchOptions.body = JSON.stringify(body);
      }

      const startMs = Date.now();
      const response = await fetch(url, fetchOptions);
      const elapsedMs = Date.now() - startMs;
      const text = await response.text();

      if (!response.ok) {
        console.error(`[MachineAPI] ${method} ${endpoint} → ${response.status} (${elapsedMs}ms):`, text.slice(0, 300));

        let parsed;
        try { parsed = JSON.parse(text); } catch { parsed = text; }

        const errorResponse: MachineResponse<T> = {
          ok: false,
          status: response.status,
          error: `Machine API ${response.status}`,
          details: parsed,
          retries: attempt,
        };

        if (shouldRetry(response.status, attempt)) {
          lastError = errorResponse;
          continue;
        }

        return errorResponse;
      }

      // Success
      if (attempt > 0) {
        console.log(`[MachineAPI] ${method} ${endpoint} → ${response.status} (${elapsedMs}ms) [recovered after ${attempt} retries]`);
      } else {
        console.log(`[MachineAPI] ${method} ${endpoint} → ${response.status} (${elapsedMs}ms)`);
      }

      let data: T;
      try { data = JSON.parse(text); } catch { data = text as unknown as T; }
      return { ok: true, status: response.status, data };

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Network error';
      console.error(`[MachineAPI] ${method} ${endpoint} → Network error (attempt ${attempt + 1}):`, errorMsg);

      lastError = {
        ok: false,
        status: 0,
        error: errorMsg,
        retries: attempt,
      };

      if (!shouldRetry(0, attempt)) break;
    }
  }

  // All retries exhausted
  return lastError || {
    ok: false,
    status: 0,
    error: 'All retries exhausted',
    retries: MAX_RETRIES,
  };
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Makes a GET request to the Machine API with automatic retry.
 */
export async function machineGet<T = unknown>(
  endpoint: string,
  queryParams?: Record<string, string>,
): Promise<MachineResponse<T>> {
  return machineFetch<T>('GET', endpoint, undefined, queryParams);
}

/**
 * Makes a POST request to the Machine API with automatic retry.
 */
export async function machinePost<T = unknown>(
  endpoint: string,
  body: unknown,
): Promise<MachineResponse<T>> {
  return machineFetch<T>('POST', endpoint, body);
}

/**
 * Makes a PUT request to the Machine API with automatic retry.
 */
export async function machinePut<T = unknown>(
  endpoint: string,
  body: unknown,
): Promise<MachineResponse<T>> {
  return machineFetch<T>('PUT', endpoint, body);
}
