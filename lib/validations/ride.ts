import { z } from 'zod';

// ─── Address (reused by create ride) ─────────────────────────
const addressSchema = z.object({
  endereco: z.string().min(1, 'Endereço da parada é obrigatório'),
  lat: z.union([z.string(), z.number()]).transform(String),
  lng: z.union([z.string(), z.number()]).transform(String),
  numero: z.string().optional().default(''),
  nome: z.string().optional().default(''),
  telefone: z.string().optional().default(''),
  observacao: z.string().optional().default(''),
});

// ─── Ride Creation Schema ────────────────────────────────────
export const rideCreateSchema = z.object({
  empresa_id: z.union([z.string(), z.number()]).transform(String),
  endereco_coleta: z.string().min(1, 'Endereço de coleta é obrigatório'),
  lat_coleta: z.union([z.string(), z.number()]).transform(String),
  lng_coleta: z.union([z.string(), z.number()]).transform(String),
  paradas: z.array(addressSchema).min(1, 'Pelo menos uma parada é obrigatória'),
  tipo_pagamento: z.string().optional().default('F'),
  observacao: z.string().max(500).optional().default(''),
  agendamento: z.string().optional(), // ISO date if scheduled
});

// ─── Ride Cancel Schema ──────────────────────────────────────
export const rideCancelSchema = z.object({
  id_solicitacao: z.union([z.string(), z.number()]).transform(String),
});

// ─── Ride Estimate Schema ────────────────────────────────────
export const rideEstimateSchema = z.object({
  empresa_id: z.union([z.string(), z.number()]).transform(String),
  lat_coleta: z.union([z.string(), z.number()]).transform(String),
  lng_coleta: z.union([z.string(), z.number()]).transform(String),
  lat_entrega: z.union([z.string(), z.number()]).transform(String),
  lng_entrega: z.union([z.string(), z.number()]).transform(String),
});

export type RideCreateInput = z.infer<typeof rideCreateSchema>;
export type RideCancelInput = z.infer<typeof rideCancelSchema>;
export type RideEstimateInput = z.infer<typeof rideEstimateSchema>;
