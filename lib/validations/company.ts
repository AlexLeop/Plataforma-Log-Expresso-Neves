import { z } from 'zod';

// ─── CNPJ Validation ─────────────────────────────────────────
function isValidCNPJ(cnpj: string): boolean {
  const digits = cnpj.replace(/\D/g, '');
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false; // all same digit

  // First check digit
  let sum = 0;
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (let i = 0; i < 12; i++) sum += parseInt(digits[i]) * weights1[i];
  let rem = sum % 11;
  if (parseInt(digits[12]) !== (rem < 2 ? 0 : 11 - rem)) return false;

  // Second check digit
  sum = 0;
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (let i = 0; i < 13; i++) sum += parseInt(digits[i]) * weights2[i];
  rem = sum % 11;
  if (parseInt(digits[13]) !== (rem < 2 ? 0 : 11 - rem)) return false;

  return true;
}

// ─── Company Registration Schema (Machine-only, legacy) ──────
export const companyRegisterSchema = z.object({
  nome_fantasia: z.string().min(2, 'Nome fantasia deve ter pelo menos 2 caracteres').max(200),
  documento: z.string()
    .min(14, 'CNPJ inválido')
    .max(20)
    .refine(val => isValidCNPJ(val), { message: 'CNPJ inválido (dígitos verificadores)' }),
  telefone: z.string().min(10, 'Telefone deve ter pelo menos 10 dígitos').max(20),
  endereco: z.string().max(500).optional().default(''),
  complemento: z.string().max(200).optional().default(''),
  bairro: z.string().max(200).optional().default(''),
  cidade: z.string().max(200).optional().default(''),
  uf: z.string().max(2).optional().default(''),
  cep: z.string().max(10).optional().default(''),
  lat: z.string().max(30).optional().default(''),
  lng: z.string().max(30).optional().default(''),
  categoria_id: z.string().max(20).optional(),
  // Honeypot field — bots will fill this
  website: z.string().max(500).optional(),
});

// ─── Full Onboarding Schema (Supabase + Machine) ─────────────
// Used by POST /api/auth/register — includes user credentials
export const onboardingRegisterSchema = companyRegisterSchema.extend({
  email: z.string()
    .email('E-mail inválido')
    .max(255)
    .transform(v => v.toLowerCase().trim()),
  password: z.string()
    .min(6, 'Senha deve ter pelo menos 6 caracteres')
    .max(128),
});

// ─── Company Update Schema ───────────────────────────────────
export const companyUpdateSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  status_empresa: z.enum(['A', 'I'], {
    message: 'Status deve ser "A" (Ativa) ou "I" (Inativa)',
  }),
});

export type CompanyRegisterInput = z.infer<typeof companyRegisterSchema>;
export type OnboardingRegisterInput = z.infer<typeof onboardingRegisterSchema>;
export type CompanyUpdateInput = z.infer<typeof companyUpdateSchema>;

