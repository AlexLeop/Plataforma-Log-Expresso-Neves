/**
 * Formata uma data como YYYY-MM-DD usando o fuso local.
 * NUNCA use d.toISOString().split('T')[0] pois converte para UTC,
 * causando deslocamento de 1 dia em fusos negativos (ex: BRT = UTC-3).
 */
export function toLocalDateISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
