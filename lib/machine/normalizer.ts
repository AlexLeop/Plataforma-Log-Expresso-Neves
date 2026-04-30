import type {
  MachineRideResponse,
  MachineDriverResponse,
  NormalizedRide,
  NormalizedDriver,
} from '@/lib/types';

// ============================================================
// Extrair data (YYYY-MM-DD) de um timestamp
// Machine retorna no formato "2026-03-29 16:21:03" (sem T, sem Z)
// ============================================================

function extractDate(timestamp: string | null | undefined): string {
  if (!timestamp) return new Date().toISOString().split('T')[0];

  try {
    // Machine retorna "YYYY-MM-DD HH:MM:SS" (sem T)
    const normalized = timestamp.replace(' ', 'T');
    const date = new Date(normalized);
    if (isNaN(date.getTime())) return new Date().toISOString().split('T')[0];
    return date.toISOString().split('T')[0];
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

// ============================================================
// Normalizar corrida da Machine → schema interno
//
// O valor da corrida (fare_value) é usado TAL QUAL da API.
// Não existe classificação em faixas fixas — os valores
// variam de R$5 a R$15 e são configuráveis na Machine.
// ============================================================

export function normalizeRide(machineData: MachineRideResponse): NormalizedRide {
  const fareValue = parseFloat(
    String(machineData.valor_corrida || machineData.valor || '0')
  );

  const finishedAt = machineData.data_hora_finalizacao || machineData.data_hora_solicitacao;

  return {
    machine_ride_id: String(machineData.id || machineData.solicitacao_id || ''),
    machine_condutor_id: String(
      machineData.condutor_id || machineData.taxista_id || ''
    ),
    status: machineData.status_solicitacao || machineData.status || 'P',
    payment_type: machineData.tipo_pagamento || 'unknown',
    fare_value: fareValue,
    stop_count: machineData.paradas?.length || 1,
    requested_at: machineData.data_hora_solicitacao || null,
    finished_at: finishedAt || null,
    ride_date: extractDate(finishedAt),
    raw_data: machineData as Record<string, unknown>,
  };
}

// ============================================================
// Normalizar motorista da Machine → schema interno
// ============================================================

export function normalizeDriver(machineData: MachineDriverResponse): NormalizedDriver {
  return {
    machine_condutor_id: String(machineData.id || ''),
    name: machineData.nome || 'Sem nome',
    cpf: machineData.cpf || null,
    phone: machineData.telefone || null,
    status: machineData.status || 'active',
    raw_data: machineData as Record<string, unknown>,
  };
}
