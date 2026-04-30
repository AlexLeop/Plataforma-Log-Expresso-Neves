'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { authFetch } from '@/app/lib/api-client';

// ============================================================
// Contexto Global — Empresa, Semana, Auth + Role
// ============================================================

export type UserRole = 'admin' | 'lojista' | 'supervisor' | 'coordinator';

interface SessionData {
  user: {
    email: string;
    name: string;
    role: UserRole;
    companies: Array<{ id: number; nome: string }>;
    machine_empresa_id?: string;   // Legacy single-company (backward compat)
    machine_empresa_ids?: string[]; // Multi-company support
  };
  basicAuth: string;
  loginAt: number;
}

export interface CompanyCategory {
  id: string;
  nome: string;
}

export interface CompanyOption {
  id: number;
  nome: string;
  machine_empresa_id?: string;
  endereco?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
  lat?: string;
  lng?: string;
  telefone?: string;
  tipos_pagamento?: string[];
  categorias?: CompanyCategory[];
}

export interface DriverOption {
  id: string;
  nome: string;
  telefone?: string;
  status?: string;
  chave_pix?: string;
}

interface WeekPeriod {
  start: string; // YYYY-MM-DD (segunda)
  end: string;   // YYYY-MM-DD (domingo)
  label: string; // "24/03 – 30/03"
}

interface AppContextType {
  // Auth
  userRole: UserRole;
  userName: string;
  isAdmin: boolean;
  isSupervisor: boolean;
  isAuthenticated: boolean;
  logout: () => void;

  // Empresa
  companies: CompanyOption[];
  selectedCompany: CompanyOption | null;
  setSelectedCompany: (c: CompanyOption | null) => void;
  loadingCompanies: boolean;

  // Drivers
  drivers: DriverOption[];
  loadingDrivers: boolean;

  // Semana
  weekPeriod: WeekPeriod;
  setWeekOffset: (offset: number) => void;
  weekOffset: number;
  goToPreviousWeek: () => void;
  goToNextWeek: () => void;
  goToCurrentWeek: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
}

// Calcula segunda-feira e domingo da semana baseado em um offset (0 = atual)
function getWeekPeriod(offset: number): WeekPeriod {
  const now = new Date();
  const day = now.getDay(); // 0=dom, 1=seg...
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset + (offset * 7));
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  // Formatar usando fuso local (evita bug de toISOString que converte pra UTC)
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fmtBR = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

  return {
    start: fmt(monday),
    end: fmt(sunday),
    label: `${fmtBR(monday)} – ${fmtBR(sunday)}`,
  };
}

const MAX_SESSION_MS = 24 * 60 * 60 * 1000; // 24 horas

function getSession(): SessionData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('logipay:session');
    if (!raw) return null;
    const session = JSON.parse(raw) as SessionData;

    // Expirar sessão após 24h
    if (session.loginAt && Date.now() - session.loginAt > MAX_SESSION_MS) {
      localStorage.removeItem('logipay:session');
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

// Admin-only routes that lojistas cannot access
const ADMIN_ONLY_ROUTES = ['/motoboys', '/empresas', '/sync', '/usuarios'];

// Routes supervisors CAN access (everything else redirects to /escala)
const SUPERVISOR_ALLOWED_ROUTES = ['/escala'];

export function AppProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [session, setSession] = useState<SessionData | null>(null);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<CompanyOption | null>(null);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [loadingDrivers, setLoadingDrivers] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [authChecked, setAuthChecked] = useState(false);
  const loggingOutRef = useRef(false);

  const weekPeriod = getWeekPeriod(weekOffset);

  // Load session from localStorage
  useEffect(() => {
    const s = getSession();
    setSession(s);
    setAuthChecked(true);

    if (!s) {
      router.push('/login');
    } else if (s.user.role === 'supervisor' || s.user.role === 'coordinator') {
      // Supervisor should always start on /escala
      router.push('/escala');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Route guard
  useEffect(() => {
    if (!authChecked || !session) return;

    const role = session.user.role;

    // Lojista guard: block admin-only routes
    if (role === 'lojista' && ADMIN_ONLY_ROUTES.includes(pathname)) {
      router.replace('/');
    }

    // Supervisor guard: only allowed specific routes
    if ((role === 'supervisor' || role === 'coordinator') && !SUPERVISOR_ALLOWED_ROUTES.includes(pathname)) {
      router.replace('/escala');
    }
  }, [pathname, session, authChecked, router]);

  const logout = useCallback(() => {
    loggingOutRef.current = true;
    localStorage.removeItem('logipay:session');
    setSession(null);
    router.push('/login');
  }, [router]);

  const userRole: UserRole = session?.user?.role || 'lojista';
  const userName = session?.user?.name || '';
  const isAdmin = userRole === 'admin';
  const isSupervisor = userRole === 'supervisor' || userRole === 'coordinator';
  const isAuthenticated = !!session;

  // Fetch empresas reais da Machine (now includes categorias + tipos_pagamento)
  useEffect(() => {
    async function load() {
      if (loggingOutRef.current) return;
      try {
        const res = await authFetch('/api/machine/companies');
        if (res.ok) {
          const data = await res.json();
          let list: CompanyOption[] = (data.companies || []).map((c: Record<string, unknown>) => ({
            id: c.id as number,
            nome: c.nome as string,
            endereco: (c.endereco as string) || undefined,
            complemento: (c.complemento as string) || undefined,
            bairro: (c.bairro as string) || undefined,
            cidade: (c.cidade as string) || undefined,
            uf: (c.uf as string) || undefined,
            cep: (c.cep as string) || undefined,
            lat: (c.lat as string) || undefined,
            lng: (c.lng as string) || undefined,
            telefone: (c.telefone as string) || undefined,
            tipos_pagamento: (c.tipos_pagamento as string[]) || [],
            categorias: (c.categorias as CompanyCategory[]) || [],
          }));

          // CRITICAL: Filter companies for non-admin Supabase-auth users.
          // Their session uses admin proxy credentials which returns ALL companies.
          // We MUST filter to only show the user's assigned companies.
          if (!isAdmin) {
            const myIds = session?.user?.machine_empresa_ids || [];
            const legacyId = session?.user?.machine_empresa_id;

            // Use array if available, otherwise fall back to legacy single ID
            const allowedIds = myIds.length > 0 ? myIds : (legacyId ? [legacyId] : []);

            if (allowedIds.length > 0) {
              const filtered = list.filter(c => allowedIds.includes(String(c.id)));
              if (filtered.length > 0) {
                list = filtered;
              }
            }
          }

          setCompanies(list);
          if (list.length > 0 && !selectedCompany) {
            setSelectedCompany(list[0]);
          }
        }
      } catch {
        console.error('Failed to load companies');
      } finally {
        setLoadingCompanies(false);
      }
    }
    if (isAuthenticated) load();
  }, [isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch drivers
  useEffect(() => {
    async function loadDrivers() {
      if (loggingOutRef.current) return;
      try {
        const res = await authFetch('/api/machine/drivers');
        if (res.ok) {
          const data = await res.json();
          const list: DriverOption[] = (data.drivers || []).map((d: Record<string, unknown>) => ({
            id: String(d.id),
            nome: d.nome as string,
            telefone: d.telefone as string,
            status: d.status as string,
            chave_pix: d.chave_pix as string,
          }));
          setDrivers(list);
        }
      } catch {
        console.error('Failed to load drivers');
      } finally {
        setLoadingDrivers(false);
      }
    }
    if (isAuthenticated) loadDrivers();
  }, [isAuthenticated]);

  const goToPreviousWeek = useCallback(() => setWeekOffset(o => o - 1), []);
  const goToNextWeek = useCallback(() => setWeekOffset(o => o + 1), []);
  const goToCurrentWeek = useCallback(() => setWeekOffset(0), []);

  // Show nothing while checking auth
  if (!authChecked) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#F5F3F0',
        color: '#8B8896',
        fontSize: '0.85rem',
      }}>
        Carregando...
      </div>
    );
  }

  return (
    <AppContext.Provider value={{
      userRole, userName, isAdmin, isAuthenticated, logout,
      companies, selectedCompany, setSelectedCompany, loadingCompanies,
      drivers, loadingDrivers, isSupervisor,
      weekPeriod, setWeekOffset, weekOffset, goToPreviousWeek, goToNextWeek, goToCurrentWeek,
    }}>
      {children}
    </AppContext.Provider>
  );
}
