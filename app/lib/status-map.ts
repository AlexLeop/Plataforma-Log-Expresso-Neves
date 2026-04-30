/**
 * Unified STATUS_MAP for ride status codes.
 * Labels match Machine API documentation exactly.
 * Used by both Dashboard and Corridas pages.
 */

export interface StatusInfo {
  label: string;
  badgeClass: string;
  color: string;
  bg: string;
  icon: string;
}

export const STATUS_MAP: Record<string, StatusInfo> = {
  D: { label: 'Distribuindo',      badgeClass: 'badge-info',      color: '#7c3aed', bg: '#ede9fe', icon: '●' },
  G: { label: 'Aguardando Aceite', badgeClass: 'badge-warning',   color: '#d97706', bg: '#fef3c7', icon: '●' },
  P: { label: 'Buscando Condutor', badgeClass: 'badge-secondary', color: '#ea580c', bg: '#fff7ed', icon: '●' },
  N: { label: 'Não Atendida',      badgeClass: 'badge-secondary', color: '#ef4444', bg: '#fef2f2', icon: '●' },
  A: { label: 'Aceita',            badgeClass: 'badge-accent',    color: '#E55C00', bg: '#FFF0E5', icon: '●' },
  E: { label: 'Em Andamento',      badgeClass: 'badge-info',      color: '#0891b2', bg: '#ecfeff', icon: '●' },
  F: { label: 'Finalizada',        badgeClass: 'badge-success',   color: '#16a34a', bg: '#f0fdf4', icon: '●' },
  C: { label: 'Cancelada',         badgeClass: 'badge-secondary', color: '#6b7280', bg: '#f3f4f6', icon: '●' },
  S: { label: 'Em Espera',         badgeClass: 'badge-warning',   color: '#8b5cf6', bg: '#f5f3ff', icon: '●' },
  U: { label: 'Agrupada',          badgeClass: 'badge-info',      color: '#0d9488', bg: '#f0fdfa', icon: '●' },
};

/**
 * Returns the status info for a given status code.
 * Falls back to a generic "unknown" status if not found.
 */
export function getStatusInfo(code: string): StatusInfo {
  const key = String(code).toUpperCase().charAt(0);
  return STATUS_MAP[key] || {
    label: code,
    badgeClass: 'badge-secondary',
    color: '#6b7280',
    bg: '#f3f4f6',
    icon: '?',
  };
}

/** Active status codes (ride is in progress) */
export const ACTIVE_STATUS_CODES = ['D', 'G', 'A', 'E', 'P', 'S'];
