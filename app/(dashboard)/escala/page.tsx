'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useToast } from '../../components/Toast';
import { authFetch } from '@/app/lib/api-client';
import { toLocalDateISO } from '@/app/lib/date-utils';
import SupervisorLayout, { type SupervisorTab } from '../../components/SupervisorLayout';

// ── Types ──────────────────────────────────────────────────────

interface Driver {
  id: string;
  name: string;
  phone: string | null;
}

interface ScheduleEntry {
  id: string;
  driver_id: string;
  entry_date: string;
  shift_label: string;
  shift_start: string;
  shift_end: string;
  daily_rate: number;
  status: string;
  confirmation_token: string | null;
  confirmed_at: string | null;
  sent_at: string | null;
  notes: string | null;
  driver: Driver;
}

interface Schedule {
  id: string;
  company_id: string;
  week_start: string;
  week_end: string;
  status: string;
  confirmation_limit_hours: number;
  sent_at: string | null;
  notes: string | null;
  schedule_entries: ScheduleEntry[];
}

interface CompanyDriver {
  id: string;
  driver_id: string;
  driver: Driver;
}

interface TurnoConfig {
  id: string;
  label: string;
  inicio: string;
  fim: string;
  diaria: number;
}

interface FaixaHorasConfig {
  id: string;
  label: string;
  horasMinimas: number;
  horasMaximas: number;
  valor: number;
}

interface CompanyConfig {
  report_type: 'producao' | 'garantida' | 'garantida_horas';
  guaranteed_mode_enabled: boolean;
  daily_rate_weekday: number;
  daily_rate_saturday: number;
  daily_rate_sunday: number;
  daily_rate_holiday: number;
  turnos_config: TurnoConfig[];
  faixas_horas_config: FaixaHorasConfig[];
}

// ── Helpers ────────────────────────────────────────────────────

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return toLocalDateISO(d);
}

function getWeekEnd(weekStart: string): string {
  const d = new Date(weekStart + 'T00:00:00');
  d.setDate(d.getDate() + 6);
  return toLocalDateISO(d);
}

function getDatesOfWeek(weekStart: string) {
  const start = new Date(weekStart + 'T00:00:00');
  const dayNames = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const dates: { iso: string; label: string; dayName: string; dayNum: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    dates.push({
      iso: toLocalDateISO(d),
      label: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
      dayName: dayNames[i],
      dayNum: d.getDate(),
    });
  }
  return dates;
}

const todayISO = toLocalDateISO(new Date());

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  sent: 'Enviado',
  confirmed: 'Confirmado',
  no_show: 'Falta',
  cancelled: 'Cancelado',
};

function formatBRL(val: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
}

function getInitials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

// ── Main Page Component ────────────────────────────────────────

interface MachineDriverInfo {
  id: number | string;
  nome: string;
  documento: string;
  telefone: string;
  status: string;
}

interface LinkConfirm {
  machineId: string;
  name: string;
  phone: string;
  cpf: string;
}

interface DriverProduction {
  driverId: string;
  driverName: string;
  days: Record<string, { rides: number; diaria: number; extras: number; advances: number }>;
  totalRides: number;
  totalDiaria: number;
  totalExtras: number;
  totalAdvances: number;
  totalNet: number;
}

export default function EscalaPage() {
  const { selectedCompany, isSupervisor, isAdmin, userName, userRole } = useAppContext();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<SupervisorTab>('dashboard');
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [companyDrivers, setCompanyDrivers] = useState<CompanyDriver[]>([]);
  const [companyUUID, setCompanyUUID] = useState<string | null>(null);
  const [companyConfig, setCompanyConfig] = useState<CompanyConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showAddDriver, setShowAddDriver] = useState(false);
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [selectedShift, setSelectedShift] = useState('');
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [dailyRate, setDailyRate] = useState<number>(60);
  const [customShiftStart, setCustomShiftStart] = useState('08:00');
  const [customShiftEnd, setCustomShiftEnd] = useState('18:00');
  const [expandedDriver, setExpandedDriver] = useState<string | null>(null);
  const [unlinkTarget, setUnlinkTarget] = useState<{ cdId: string; driverName: string; driverId: string } | null>(null);
  const [unlinking, setUnlinking] = useState(false);

  // ── Equipe Search states ─────────────────────────
  const [allMachineDrivers, setAllMachineDrivers] = useState<MachineDriverInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [linkConfirm, setLinkConfirm] = useState<LinkConfirm | null>(null);
  const [linking, setLinking] = useState(false);

  // ── Production states ───────────────────────────
  const [productionData, setProductionData] = useState<DriverProduction[]>([]);
  const [productionLoading, setProductionLoading] = useState(false);
  const [expandedProdDriver, setExpandedProdDriver] = useState<string | null>(null);

  const weekEnd = useMemo(() => getWeekEnd(weekStart), [weekStart]);
  const weekDates = useMemo(() => getDatesOfWeek(weekStart), [weekStart]);

  const weekLabel = useMemo(() => {
    const [, m1, d1] = weekStart.split('-');
    const [, m2, d2] = weekEnd.split('-');
    return `${d1}/${m1} — ${d2}/${m2}`;
  }, [weekStart, weekEnd]);

  // Resolve Machine company ID to Supabase UUID + Load company config
  useEffect(() => {
    async function resolveAndLoadConfig() {
      if (!selectedCompany) return;
      try {
        const companyNameParam = selectedCompany.nome ? `&company_name=${encodeURIComponent(selectedCompany.nome)}` : '';
        const res = await authFetch(`/api/db/configs?company_id=${selectedCompany.id}${companyNameParam}`);
        if (res.ok) {
          const data = await res.json();
          if (data.company_id) setCompanyUUID(data.company_id);
          setCompanyConfig({
            report_type: data.report_type || 'producao',
            guaranteed_mode_enabled: data.guaranteed_mode_enabled ?? true,
            daily_rate_weekday: Number(data.daily_rate_weekday) || 60,
            daily_rate_saturday: Number(data.daily_rate_saturday) || 70,
            daily_rate_sunday: Number(data.daily_rate_sunday) || 80,
            daily_rate_holiday: Number(data.daily_rate_holiday) || 80,
            turnos_config: Array.isArray(data.turnos_config) ? data.turnos_config : [],
            faixas_horas_config: Array.isArray(data.faixas_horas_config) ? data.faixas_horas_config : [],
          });
        }
      } catch { /* ignore */ }
    }
    resolveAndLoadConfig();
  }, [selectedCompany]);

  // Helper: get daily rate based on date and config
  const getDailyRateForDate = useCallback((dateISO: string): number => {
    if (!companyConfig) return 60;
    const d = new Date(dateISO + 'T12:00:00');
    const dow = d.getDay(); // 0=Sun, 6=Sat
    if (dow === 0) return companyConfig.daily_rate_sunday;
    if (dow === 6) return companyConfig.daily_rate_saturday;
    return companyConfig.daily_rate_weekday;
  }, [companyConfig]);

  // When config loads, set default shift and daily rate
  useEffect(() => {
    if (!companyConfig) return;
    const hasTurnos = companyConfig.turnos_config.length > 0;
    if (hasTurnos) {
      const first = companyConfig.turnos_config[0];
      setSelectedShift(first.label);
      setDailyRate(first.diaria || companyConfig.daily_rate_weekday);
      setCustomShiftStart(first.inicio || '08:00');
      setCustomShiftEnd(first.fim || '18:00');
    } else {
      setSelectedShift('Integral');
      setDailyRate(companyConfig.daily_rate_weekday);
      setCustomShiftStart('08:00');
      setCustomShiftEnd('18:00');
    }
  }, [companyConfig]);

  // Load data
  const loadData = useCallback(async () => {
    if (!selectedCompany) return;
    setLoading(true);

    try {
      const driversRes = await authFetch(`/api/db/company-drivers?company_id=${selectedCompany.id}`);
      const driversRaw = await driversRes.json();
      const mappedDrivers: CompanyDriver[] = (Array.isArray(driversRaw) ? driversRaw : []).map((d: { linkId: string; driverUUID: string; driverName: string; driverPhone: string }) => ({
        id: d.linkId,
        driver_id: d.driverUUID,
        driver: { id: d.driverUUID, name: d.driverName, phone: d.driverPhone || null },
      }));
      setCompanyDrivers(mappedDrivers);

      if (companyUUID) {
        const schedRes = await authFetch(`/api/schedules?company_id=${companyUUID}&week_start=${weekStart}`);
        const schedData = await schedRes.json();
        setSchedule(schedData.schedules?.[0] || null);
      } else {
        setSchedule(null);
      }
    } catch (err) {
      console.error('Load error:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedCompany, weekStart, companyUUID]);

  useEffect(() => { loadData(); }, [loadData]);

  // Load Machine drivers for search (once)
  useEffect(() => {
    async function fetchMachineDrivers() {
      try {
        const res = await authFetch('/api/machine/drivers');
        if (res.ok) {
          const data = await res.json();
          setAllMachineDrivers(data.drivers || []);
        }
      } catch { /* silent */ }
    }
    fetchMachineDrivers();
  }, []);

  // ── Production Data Loader ─────────────────────────────────
  const loadProductionData = useCallback(async () => {
    if (!selectedCompany || companyDrivers.length === 0) { setProductionData([]); return; }
    setProductionLoading(true);
    try {
      // Fetch rides from Machine API
      const ridesRes = await authFetch(`/api/machine/rides?empresa_id=${selectedCompany.id}&limite=500`);
      const ridesData = ridesRes.ok ? await ridesRes.json() : { rides: [] };
      const allRides = ridesData.rides || [];

      // Fetch entries from Supabase
      const entriesRes = await authFetch(`/api/db/entries?company_id=${selectedCompany.id}&start=${weekStart}&end=${weekEnd}`);
      const allEntries = entriesRes.ok ? await entriesRes.json() : [];

      // Build production per company driver
      const production: DriverProduction[] = [];

      // Create lookup: Machine driver ID → companyDriver
      const cdByMachineId = new Map<string, CompanyDriver>();
      // Need Machine IDs — load from company-drivers API which returns driverId (machineCondutorId)
      const cdRes = await authFetch(`/api/db/company-drivers?company_id=${selectedCompany.id}`);
      const cdRaw = cdRes.ok ? await cdRes.json() : [];
      interface CdRawItem { linkId: string; driverUUID: string; driverName: string; driverPhone: string; driverId: string }
      const cdList: CdRawItem[] = Array.isArray(cdRaw) ? cdRaw : [];

      for (const cd of cdList) {
        cdByMachineId.set(String(cd.driverId), {
          id: cd.linkId,
          driver_id: cd.driverUUID,
          driver: { id: cd.driverUUID, name: cd.driverName, phone: cd.driverPhone || null },
        });
      }

      // Process each linked driver
      for (const cd of cdList) {
        const machineId = String(cd.driverId);
        const days: Record<string, { rides: number; diaria: number; extras: number; advances: number }> = {};
        let totalRides = 0, totalDiaria = 0, totalExtras = 0, totalAdvances = 0;

        // Init days
        weekDates.forEach(d => { days[d.iso] = { rides: 0, diaria: 0, extras: 0, advances: 0 }; });

        // Count rides from Machine
        for (const ride of allRides) {
          const rideDriverId = String(ride.condutor_id || ride.taxista_id || '');
          if (rideDriverId !== machineId) continue;
          const dateStr = (ride.data_hora_solicitacao || '').split(' ')[0].split('T')[0];
          if (dateStr >= weekStart && dateStr <= weekEnd && days[dateStr]) {
            days[dateStr].rides++;
            totalRides++;
          }
        }

        // Process Supabase entries
        if (Array.isArray(allEntries)) {
          for (const entry of allEntries) {
            if (String(entry.driverId) !== machineId) continue;
            if (!days[entry.date]) continue;
            if (entry.type === 'diaria') {
              days[entry.date].diaria += entry.amount;
              totalDiaria += entry.amount;
            } else if (entry.type === 'extra' || entry.type === 'missao') {
              days[entry.date].extras += entry.amount;
              totalExtras += entry.amount;
            } else if (entry.type === 'adiantamento') {
              days[entry.date].advances += entry.amount;
              totalAdvances += entry.amount;
            }
          }
        }

        // Only include drivers that have some activity
        if (totalRides > 0 || totalDiaria > 0 || totalExtras > 0 || totalAdvances > 0) {
          production.push({
            driverId: machineId,
            driverName: cd.driverName,
            days,
            totalRides,
            totalDiaria,
            totalExtras,
            totalAdvances,
            totalNet: totalDiaria + totalExtras - totalAdvances,
          });
        }
      }

      production.sort((a, b) => b.totalRides - a.totalRides);
      setProductionData(production);
    } catch (err) {
      console.error('Production load error:', err);
    } finally {
      setProductionLoading(false);
    }
  }, [selectedCompany, companyDrivers, weekStart, weekEnd, weekDates]);

  // Load production when tab is active
  useEffect(() => {
    if (activeTab === 'producao') loadProductionData();
  }, [activeTab, loadProductionData]);

  // ── Link Driver Handler ───────────────────────────────────
  async function handleLinkDriver() {
    if (!linkConfirm || !selectedCompany) return;
    setLinking(true);
    try {
      const res = await authFetch('/api/db/company-drivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: selectedCompany.id,
          driverId: linkConfirm.machineId,
          driverName: linkConfirm.name,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Erro ao vincular');
      }
      showToast(`${linkConfirm.name} vinculado com sucesso ✓`, 'success');
      setLinkConfirm(null);
      setSearchQuery('');
      loadData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao vincular', 'error');
    } finally {
      setLinking(false);
    }
  }

  // Navigation
  function prevWeek() {
    const d = new Date(weekStart + 'T00:00:00');
    d.setDate(d.getDate() - 7);
    setWeekStart(toLocalDateISO(d));
  }

  function nextWeek() {
    const d = new Date(weekStart + 'T00:00:00');
    d.setDate(d.getDate() + 7);
    setWeekStart(toLocalDateISO(d));
  }

  function goToCurrentWeek() {
    setWeekStart(getWeekStart(new Date()));
  }

  // Handlers
  async function handleAddEntries() {
    if (!selectedCompany || !selectedDriverId || selectedDays.length === 0) {
      showToast('Selecione o motoboy e pelo menos um dia', 'warning');
      return;
    }

    try {
      let schedId = schedule?.id;
      if (!schedId) {
        if (!companyUUID) {
          showToast('Empresa não resolvida. Recarregue a página.', 'error');
          return;
        }
        const createRes = await authFetch('/api/schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company_id: companyUUID,
            week_start: weekStart,
            week_end: weekEnd,
            created_by_name: userName || 'Supervisor',
            entries: selectedDays.map(date => {
              const hasTurnos = companyConfig && companyConfig.turnos_config && companyConfig.turnos_config.length > 0;
              const turno = hasTurnos ? companyConfig!.turnos_config.find(t => t.label === selectedShift) : null;
              
              const start = turno?.inicio || customShiftStart;
              const end = turno?.fim || customShiftEnd;
              let dailyRate = turno ? getDailyRateForDate(date) : getDailyRateForDate(date);
              if (turno) dailyRate = turno.diaria;
              
              if (companyConfig?.report_type === 'garantida_horas' && companyConfig.faixas_horas_config && companyConfig.faixas_horas_config.length > 0) {
                if (start && end) {
                  const [sh, sm] = start.split(':').map(Number);
                  const [eh, em] = end.split(':').map(Number);
                  let diff = (eh + em/60) - (sh + sm/60);
                  if (diff < 0) diff += 24;
                  
                  const faixa = companyConfig.faixas_horas_config.find(f => diff >= f.horasMinimas && diff <= f.horasMaximas) 
                             || companyConfig.faixas_horas_config[companyConfig.faixas_horas_config.length - 1];
                  if (faixa) dailyRate = faixa.valor;
                }
              }

              return {
                driver_id: selectedDriverId,
                entry_date: date,
                shift_label: turno?.label || 'Integral',
                shift_start: start,
                shift_end: end,
                daily_rate: dailyRate,
              };
            }),
          }),
        });
        const createData = await createRes.json();
        if (!createRes.ok) throw new Error(createData.error);
      } else {
        const updateRes = await authFetch(`/api/schedules/${schedId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entries_to_add: selectedDays.map(date => {
              const hasTurnos = companyConfig && companyConfig.turnos_config && companyConfig.turnos_config.length > 0;
              const turno = hasTurnos ? companyConfig!.turnos_config.find(t => t.label === selectedShift) : null;
              
              const start = turno?.inicio || customShiftStart;
              const end = turno?.fim || customShiftEnd;
              let dailyRate = turno ? getDailyRateForDate(date) : getDailyRateForDate(date);
              if (turno) dailyRate = turno.diaria;

              if (companyConfig?.report_type === 'garantida_horas' && companyConfig.faixas_horas_config && companyConfig.faixas_horas_config.length > 0) {
                if (start && end) {
                  const [sh, sm] = start.split(':').map(Number);
                  const [eh, em] = end.split(':').map(Number);
                  let diff = (eh + em/60) - (sh + sm/60);
                  if (diff < 0) diff += 24;
                  
                  const faixa = companyConfig.faixas_horas_config.find(f => diff >= f.horasMinimas && diff <= f.horasMaximas) 
                             || companyConfig.faixas_horas_config[companyConfig.faixas_horas_config.length - 1];
                  if (faixa) dailyRate = faixa.valor;
                }
              }

              return {
                driver_id: selectedDriverId,
                entry_date: date,
                shift_label: turno?.label || 'Integral',
                shift_start: start,
                shift_end: end,
                daily_rate: dailyRate,
              };
            }),
          }),
        });
        if (!updateRes.ok) {
          const data = await updateRes.json();
          throw new Error(data.error);
        }
      }

      showToast('Motoboy adicionado à escala', 'success');
      setShowAddDriver(false);
      setSelectedDriverId('');
      setSelectedDays([]);
      loadData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao adicionar', 'error');
    }
  }

  async function handleSendSchedule() {
    if (!schedule) return;
    setSending(true);
    try {
      const res = await authFetch(`/api/schedules/${schedule.id}/send`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.failed > 0) {
        const failedDetails = data.details?.filter((d: { success: boolean }) => !d.success).map((d: { driverName: string; error: string }) => `${d.driverName}: ${d.error}`).join('\n');
        showToast(`Enviado: ${data.sent} | Falhou: ${data.failed}\n${failedDetails || ''}`, 'warning');
      } else {
        showToast(`Escala enviada para ${data.sent} motoboy(s)`, 'success');
      }
      loadData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao enviar', 'error');
    } finally {
      setSending(false);
    }
  }

  async function handleResendSchedule() {
    if (!schedule) return;
    setSending(true);
    try {
      // Get all sent and no_show entries (not confirmed/cancelled)
      const sentEntries = (schedule.schedule_entries || []).filter(
        (e: { status: string }) => e.status === 'sent' || e.status === 'no_show'
      );

      if (sentEntries.length === 0) {
        showToast('Nenhuma entrada para reenviar', 'info');
        return;
      }

      let sent = 0;
      let failed = 0;

      // Send each entry individually via /send-entry
      for (const entry of sentEntries) {
        try {
          const res = await authFetch(`/api/schedules/${schedule.id}/send-entry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entry_id: entry.id }),
          });
          const data = await res.json();
          if (res.ok && data.sent > 0) {
            sent++;
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      }

      if (failed > 0) {
        showToast(`Reenviado: ${sent} | Falhou: ${failed}`, 'warning');
      } else {
        showToast(`Escala reenviada para ${sent} entrada(s) ✓`, 'success');
      }
      loadData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao reenviar', 'error');
    } finally {
      setSending(false);
    }
  }

  async function handleMarkNoShow(entryId: string) {
    if (!schedule) return;
    try {
      await authFetch(`/api/schedules/${schedule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry_status_updates: [{ id: entryId, status: 'no_show' }] }),
      });
      showToast('Marcado como falta', 'info');
      loadData();
    } catch { showToast('Erro ao atualizar', 'error'); }
  }

  async function handleRemoveEntry(entryId: string) {
    if (!schedule) return;
    try {
      await authFetch(`/api/schedules/${schedule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries_to_remove: [entryId] }),
      });
      showToast('Entrada removida', 'info');
      loadData();
    } catch { showToast('Erro ao remover', 'error'); }
  }

  async function handleResendEntry(entryId: string) {
    if (!schedule) return;
    setSending(true);
    try {
      // Single atomic call: resets entry + sends notification
      const res = await authFetch(`/api/schedules/${schedule.id}/send-entry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry_id: entryId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.failed > 0) {
        const failedDetails = data.details?.filter((d: { success: boolean }) => !d.success).map((d: { driverName: string; error: string }) => `${d.driverName}: ${d.error}`).join('\n');
        showToast(`Falha ao reenviar: ${failedDetails || 'erro desconhecido'}`, 'error');
      } else {
        showToast('Notificação reenviada com sucesso ✓', 'success');
      }
      loadData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao reenviar', 'error');
    } finally {
      setSending(false);
    }
  }

  // ── Computed Data ──────────────────────────────────────────────

  const entries = schedule?.schedule_entries || [];
  const todayEntries = entries.filter(e => e.entry_date === todayISO);

  const driverMap = useMemo(() => {
    const map = new Map<string, { driver: Driver; entries: Map<string, ScheduleEntry> }>();
    for (const entry of entries) {
      if (!map.has(entry.driver_id)) {
        map.set(entry.driver_id, { driver: entry.driver, entries: new Map() });
      }
      map.get(entry.driver_id)!.entries.set(entry.entry_date, entry);
    }
    return map;
  }, [entries]);

  const stats = useMemo(() => ({
    totalToday: todayEntries.length,
    confirmedToday: todayEntries.filter(e => e.status === 'confirmed').length,
    pendingToday: todayEntries.filter(e => e.status === 'pending' || e.status === 'sent').length,
    noShowToday: todayEntries.filter(e => e.status === 'no_show').length,
    totalWeek: entries.length,
    confirmedWeek: entries.filter(e => e.status === 'confirmed').length,
    pendingWeek: entries.filter(e => e.status === 'pending').length,
    sentWeek: entries.filter(e => e.status === 'sent').length,
  }), [entries, todayEntries]);

  const confirmRate = stats.totalToday > 0 ? Math.round((stats.confirmedToday / stats.totalToday) * 100) : 0;

  const availableDrivers = useMemo(() => {
    const existing = new Set(driverMap.keys());
    return companyDrivers.filter(cd => !existing.has(cd.driver_id));
  }, [companyDrivers, driverMap]);

  // ── No Company Selected ───────────────────────────────────────

  if (!selectedCompany) {
    const shell = (
      <div className="sv-empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.5" style={{ opacity: 0.3 }}>
          <rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 22v-4h6v4" />
        </svg>
        <p className="sv-empty-title">Selecione uma loja</p>
        <p className="sv-empty-sub">Use o seletor no topo para escolher sua unidade</p>
      </div>
    );
    if (isSupervisor) return <SupervisorLayout activeTab={activeTab} onTabChange={setActiveTab}>{shell}</SupervisorLayout>;
    return <div className="page-body">{shell}</div>;
  }

  // ── Dashboard Tab ─────────────────────────────────────────────

  function renderDashboard() {
    const today = new Date();
    const dayNames = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
    const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

    return (
      <div className="sv-dashboard">
        {/* Title Section */}
        <div className="sv-section-hero">
          <h1 className="sv-hero-title">Gestão de Escalas</h1>
          <p className="sv-hero-date">
            {dayNames[today.getDay()]}, {today.getDate()} de {monthNames[today.getMonth()]}
          </p>
        </div>

        {/* CTA */}
        <button className="sv-cta-btn" onClick={() => { setActiveTab('escalas'); setShowAddDriver(true); }}>
          <span className="sv-cta-icon">+</span>
          Nova Escala
        </button>

        {/* Stats Grid */}
        <div className="sv-stats-grid">
          <div className="sv-stat-card">
            <div className="sv-stat-label">Total Hoje</div>
            <div className="sv-stat-value">{stats.totalToday}</div>
          </div>
          <div className="sv-stat-card sv-stat-card--accent">
            <div className="sv-stat-label">Confirmados</div>
            <div className="sv-stat-value">
              {stats.confirmedToday}
              {stats.totalToday > 0 && <span className="sv-stat-percent">{confirmRate}%</span>}
            </div>
          </div>
          <div className="sv-stat-card">
            <div className="sv-stat-label">Pendentes</div>
            <div className="sv-stat-value">{stats.pendingToday}</div>
          </div>
          <div className="sv-stat-card sv-stat-card--success">
            <div className="sv-stat-label">Equipe</div>
            <div className="sv-stat-value">{companyDrivers.length}</div>
          </div>
        </div>

        {/* Live Monitoring */}
        {stats.totalToday > 0 && (
          <div className="sv-monitor-card">
            <div className="sv-monitor-header">
              <span className="sv-monitor-title">Monitoramento em Tempo Real</span>
              <span className="sv-monitor-live"><span className="sv-live-dot" /> AO VIVO</span>
            </div>
            <div className="sv-monitor-body">
              <div className="sv-monitor-info">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" strokeWidth="1.5">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                </svg>
                <div>
                  <div className="sv-monitor-label">Presença Motoboys</div>
                  <div className="sv-monitor-sub">{confirmRate}% de presença confirmada</div>
                </div>
              </div>
              <div className="sv-monitor-count">{stats.confirmedToday}/{stats.totalToday}</div>
            </div>
            <div className="sv-progress-bar">
              <div className="sv-progress-fill" style={{ width: `${confirmRate}%` }} />
            </div>
          </div>
        )}

        {/* Drivers on Today's Schedule */}
        {todayEntries.length > 0 && (
          <div className="sv-section">
            <h3 className="sv-section-title">Escala de Hoje</h3>
            <div className="sv-driver-list">
              {todayEntries.map(entry => (
                <div key={entry.id} className="sv-driver-row">
                  <div className="sv-driver-avatar">{getInitials(entry.driver.name)}</div>
                  <div className="sv-driver-info">
                    <div className="sv-driver-name">{entry.driver.name}</div>
                    <div className="sv-driver-shift">{entry.shift_label} · {entry.shift_start}–{entry.shift_end}</div>
                  </div>
                  <span className={`sv-badge sv-badge--${entry.status}`}>
                    {STATUS_LABELS[entry.status] || entry.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick stats footer */}
        <div className="sv-section">
          <h3 className="sv-section-title">Resumo da Semana ({weekLabel})</h3>
          <div className="sv-week-summary">
            <div className="sv-week-stat">
              <span className="sv-week-stat-value">{stats.totalWeek}</span>
              <span className="sv-week-stat-label">Total</span>
            </div>
            <div className="sv-week-stat">
              <span className="sv-week-stat-value" style={{ color: 'var(--color-success)' }}>{stats.confirmedWeek}</span>
              <span className="sv-week-stat-label">Confirmados</span>
            </div>
            <div className="sv-week-stat">
              <span className="sv-week-stat-value" style={{ color: 'var(--color-warning)' }}>{stats.pendingWeek}</span>
              <span className="sv-week-stat-label">Pendentes</span>
            </div>
            <div className="sv-week-stat">
              <span className="sv-week-stat-value" style={{ color: 'var(--color-info)' }}>{stats.sentWeek}</span>
              <span className="sv-week-stat-label">Enviados</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Escalas Tab ───────────────────────────────────────────────

  function renderEscalas() {
    return (
      <div className="sv-escalas">
        {/* Week Navigator */}
        <div className="sv-week-nav">
          <button className="sv-week-nav-btn" onClick={prevWeek}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <div className="sv-week-nav-center">
            <span className="sv-week-nav-label">{weekLabel}</span>
            <button className="sv-week-nav-reset" onClick={goToCurrentWeek}>Semana atual</button>
          </div>
          <button className="sv-week-nav-btn" onClick={nextWeek}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        </div>

        {/* Action Buttons */}
        <div className="sv-action-row">
          <button className="sv-action-btn sv-action-btn--primary" onClick={() => setShowAddDriver(true)}>
            + Adicionar Motoboy
          </button>
          {schedule && stats.pendingWeek > 0 && (
            <button
              className="sv-action-btn sv-action-btn--send"
              onClick={handleSendSchedule}
              disabled={sending}
            >
              {sending ? 'Enviando...' : `Enviar Escala (${stats.pendingWeek})`}
            </button>
          )}
          {schedule && (stats.sentWeek > 0 || entries.some(e => e.status === 'no_show')) && (
            <button
              className="sv-action-btn sv-action-btn--resend"
              onClick={handleResendSchedule}
              disabled={sending}
              title="Reenviar notificações WhatsApp individualmente"
            >
              {sending ? 'Reenviando...' : `Reenviar (${entries.filter(e => e.status === 'sent' || e.status === 'no_show').length})`}
            </button>
          )}
        </div>

        {/* Loading */}
        {loading ? (
          <div className="sv-empty-state" style={{ padding: '40px 0' }}>
            <div className="sv-spinner" />
            <p className="sv-empty-sub">Carregando escala...</p>
          </div>
        ) : driverMap.size === 0 ? (
          /* Empty State */
          <div className="sv-empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.2" style={{ opacity: 0.3 }}>
              <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <p className="sv-empty-title">Nenhuma escala para esta semana</p>
            <p className="sv-empty-sub">Toque em &quot;Adicionar Motoboy&quot; para montar a escala</p>
          </div>
        ) : (
          /* Driver Cards */
          <div className="sv-driver-cards">
            {Array.from(driverMap.entries()).map(([driverId, { driver, entries: dateEntries }]) => {
              const isExpanded = expandedDriver === driverId;
              const driverEntries = Array.from(dateEntries.values()).sort((a, b) => a.entry_date.localeCompare(b.entry_date));
              const confirmed = driverEntries.filter(e => e.status === 'confirmed').length;
              const total = driverEntries.length;
              const hasActions = driverEntries.some(e => e.status === 'confirmed' || e.status === 'pending');

              return (
                <div key={driverId} className={`sv-driver-card ${isExpanded ? 'sv-driver-card--expanded' : ''}`}>
                  {/* Card Header */}
                  <div
                    className="sv-driver-card-header"
                    onClick={() => setExpandedDriver(isExpanded ? null : driverId)}
                  >
                    <div className="sv-driver-card-left">
                      <div className="sv-driver-avatar">{getInitials(driver.name)}</div>
                      <div>
                        <div className="sv-driver-card-name">{driver.name}</div>
                        {driver.phone && <div className="sv-driver-card-phone">{driver.phone}</div>}
                      </div>
                    </div>
                    <div className="sv-driver-card-right">
                      <span className="sv-driver-card-count">{confirmed}/{total}</span>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                        style={{ transition: 'transform 200ms', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)' }}>
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </div>
                  </div>

                  {/* Day Chips */}
                  <div className="sv-driver-card-days">
                    {weekDates.map(d => {
                      const entry = dateEntries.get(d.iso);
                      const status = entry ? entry.status : 'empty';
                      const isToday = d.iso === todayISO;
                      return (
                        <div key={d.iso} className={`sv-day-chip sv-day-chip--${status} ${isToday ? 'sv-day-chip--today' : ''}`}>
                          <span className="sv-day-chip-name">{d.dayName}</span>
                          <span className="sv-day-chip-num">{d.dayNum}</span>
                          {entry && <span className="sv-day-chip-status">{STATUS_LABELS[entry.status]?.substring(0, 4)}</span>}
                        </div>
                      );
                    })}
                  </div>

                  {/* Expanded Details + Actions */}
                  {isExpanded && (
                    <div className="sv-driver-card-details">
                      {driverEntries.map(entry => (
                        <div key={entry.id} className="sv-detail-row">
                          <div className="sv-detail-info">
                            <span className="sv-detail-date">
                              {weekDates.find(d => d.iso === entry.entry_date)?.dayName} {weekDates.find(d => d.iso === entry.entry_date)?.label}
                            </span>
                            <span className="sv-detail-shift">{entry.shift_label} ({entry.shift_start}–{entry.shift_end})</span>
                            <span className="sv-detail-rate">{formatBRL(entry.daily_rate)}</span>
                          </div>
                          <div className="sv-detail-actions">
                            <span className={`sv-badge sv-badge--${entry.status}`}>{STATUS_LABELS[entry.status]}</span>
                            {entry.status === 'confirmed' && (
                              <button className="sv-detail-action-btn sv-detail-action-btn--danger" onClick={() => handleMarkNoShow(entry.id)}>
                                Falta
                              </button>
                            )}
                            {entry.status === 'pending' && (
                              <button className="sv-detail-action-btn sv-detail-action-btn--remove" onClick={() => handleRemoveEntry(entry.id)}>
                                Remover
                              </button>
                            )}
                            {(entry.status === 'sent' || entry.status === 'no_show') && (
                              <button
                                className="sv-detail-action-btn sv-detail-action-btn--resend"
                                onClick={() => handleResendEntry(entry.id)}
                                disabled={sending}
                              >
                                {sending ? '...' : 'Reenviar'}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Equipe Tab ────────────────────────────────────────────────

  async function handleUnlinkDriver() {
    if (!unlinkTarget) return;
    setUnlinking(true);
    try {
      const res = await authFetch(`/api/company-drivers/${unlinkTarget.cdId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Erro ao desvincular');
      }
      showToast(`${unlinkTarget.driverName} desvinculado com sucesso`, 'success');
      setUnlinkTarget(null);
      loadData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao desvincular', 'error');
    } finally {
      setUnlinking(false);
    }
  }

  function renderEquipe() {
    const q = searchQuery.trim().toLowerCase();
    const linkedMachineIds = new Set(
      allMachineDrivers
        .filter(md => companyDrivers.some(cd => cd.driver.name === md.nome))
        .map(md => String(md.id))
    );
    const searchResults = q.length >= 2
      ? allMachineDrivers.filter(md =>
          md.nome.toLowerCase().includes(q) ||
          (md.documento && md.documento.replace(/\D/g, '').includes(q.replace(/\D/g, '')))
        ).slice(0, 15)
      : [];

    return (
      <div className="sv-equipe">
        <div className="sv-section-hero">
          <h2 className="sv-hero-title" style={{ fontSize: '1.3rem' }}>Equipe</h2>
          <p className="sv-hero-date">{companyDrivers.length} motoboy{companyDrivers.length !== 1 ? 's' : ''} vinculados</p>
        </div>

        {/* Search Bar */}
        <div className="sv-search-bar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="sv-search-input"
            placeholder="Buscar motoboy por nome ou CPF..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="sv-search-clear" onClick={() => setSearchQuery('')}>&times;</button>
          )}
        </div>

        {/* Search Results or Team List */}
        {q.length >= 2 ? (
          <div className="sv-driver-list">
            {searchResults.length === 0 ? (
              <div className="sv-empty-state" style={{ padding: '24px 0' }}>
                <p className="sv-empty-title">Nenhum motoboy encontrado</p>
                <p className="sv-empty-sub">Tente outro nome ou CPF</p>
              </div>
            ) : searchResults.map(md => {
              const isLinked = linkedMachineIds.has(String(md.id));
              const linkedCd = isLinked ? companyDrivers.find(cd => cd.driver.name === md.nome) : null;
              return (
                <div key={md.id} className="sv-driver-row sv-driver-row--equipe">
                  <div className="sv-driver-avatar">{getInitials(md.nome)}</div>
                  <div className="sv-driver-info">
                    <div className="sv-driver-name">{md.nome}</div>
                    <div className="sv-driver-shift">
                      {md.documento ? `CPF: ${md.documento.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')}` : 'Sem CPF'}
                      {md.telefone ? ` · ${md.telefone}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {isLinked ? (
                      <>
                        <span className="sv-badge sv-badge--confirmed" style={{ fontSize: '0.6rem' }}>Vinculado</span>
                        {linkedCd && (
                          <button
                            className="sv-detail-action-btn sv-detail-action-btn--danger"
                            onClick={() => setUnlinkTarget({ cdId: linkedCd.id, driverName: linkedCd.driver.name, driverId: linkedCd.driver_id })}
                            style={{ padding: '4px 8px', fontSize: '0.7rem' }}
                          >&times;</button>
                        )}
                      </>
                    ) : (
                      <button
                        className="sv-detail-action-btn sv-detail-action-btn--send"
                        onClick={() => setLinkConfirm({ machineId: String(md.id), name: md.nome, phone: md.telefone || '', cpf: md.documento || '' })}
                        style={{ padding: '4px 10px', fontSize: '0.7rem' }}
                      >+ Vincular</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : companyDrivers.length === 0 ? (
          <div className="sv-empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.2" style={{ opacity: 0.3 }}>
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
            </svg>
            <p className="sv-empty-title">Nenhum motoboy vinculado</p>
            <p className="sv-empty-sub">Use a busca acima para encontrar e vincular motoboys</p>
          </div>
        ) : (
          <div className="sv-driver-list">
            {companyDrivers.map(cd => {
              const todayEntry = todayEntries.find(e => e.driver_id === cd.driver_id);
              return (
                <div key={cd.id} className="sv-driver-row sv-driver-row--equipe">
                  <div className="sv-driver-avatar">{getInitials(cd.driver.name)}</div>
                  <div className="sv-driver-info">
                    <div className="sv-driver-name">{cd.driver.name}</div>
                    <div className="sv-driver-shift">{cd.driver.phone || 'Sem telefone'}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {todayEntry ? (
                      <span className={`sv-badge sv-badge--${todayEntry.status}`}>
                        {STATUS_LABELS[todayEntry.status]}
                      </span>
                    ) : (
                      <span className="sv-badge sv-badge--off">Sem escala</span>
                    )}
                    <button
                      className="sv-detail-action-btn sv-detail-action-btn--danger"
                      onClick={(e) => { e.stopPropagation(); setUnlinkTarget({ cdId: cd.id, driverName: cd.driver.name, driverId: cd.driver_id }); }}
                      title="Desvincular motoboy"
                      style={{ padding: '4px 8px', fontSize: '0.7rem' }}
                    >&times;</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Link Confirmation Modal */}
        {linkConfirm && (
          <div className="sv-unlink-overlay" onClick={() => !linking && setLinkConfirm(null)}>
            <div className="sv-unlink-modal" onClick={e => e.stopPropagation()}>
              <div className="sv-unlink-icon" style={{ background: '#f0fdf4', color: '#16a34a' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                  <line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" />
                </svg>
              </div>
              <h3 className="sv-unlink-title" style={{ color: '#1e293b' }}>Vincular Motoboy</h3>
              <div style={{ textAlign: 'left', margin: '0 0 16px', padding: '12px 16px', background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.82rem', color: '#1e293b', fontWeight: 600, marginBottom: 8 }}>{linkConfirm.name}</div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: 4 }}>
                  Tel: {linkConfirm.phone || 'Sem telefone'}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  CPF: {linkConfirm.cpf ? linkConfirm.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : 'Não informado'}
                </div>
              </div>
              <p className="sv-unlink-desc">
                Deseja vincular este motoboy a <strong>{selectedCompany?.nome}</strong>?
              </p>
              <div className="sv-unlink-actions">
                <button className="sv-unlink-btn sv-unlink-btn--cancel" onClick={() => setLinkConfirm(null)} disabled={linking}>Cancelar</button>
                <button
                  className="sv-unlink-btn sv-unlink-btn--confirm"
                  style={{ background: '#16a34a', boxShadow: '0 4px 14px rgba(22, 163, 74, 0.3)' }}
                  onClick={handleLinkDriver}
                  disabled={linking}
                >
                  {linking ? (<><span className="sv-unlink-spinner" /> Vinculando...</>) : 'Confirmar Vinculação'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Unlink Confirmation Modal — Premium */}
        {unlinkTarget && (
          <div className="sv-unlink-overlay" onClick={() => !unlinking && setUnlinkTarget(null)}>
            <div className="sv-unlink-modal" onClick={e => e.stopPropagation()}>
              {/* Icon */}
              <div className="sv-unlink-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18" /><path d="M6 6l12 12" />
                </svg>
              </div>

              <h3 className="sv-unlink-title">Desvincular Motoboy</h3>

              <p className="sv-unlink-desc">
                Tem certeza que deseja desvincular <strong>{unlinkTarget.driverName}</strong> desta loja?
              </p>

              <div className="sv-unlink-warning">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <span>Escalas futuras deste motoboy serão canceladas automaticamente</span>
              </div>

              <div className="sv-unlink-actions">
                <button
                  className="sv-unlink-btn sv-unlink-btn--cancel"
                  onClick={() => setUnlinkTarget(null)}
                  disabled={unlinking}
                >
                  Cancelar
                </button>
                <button
                  className="sv-unlink-btn sv-unlink-btn--confirm"
                  onClick={handleUnlinkDriver}
                  disabled={unlinking}
                >
                  {unlinking ? (
                    <><span className="sv-unlink-spinner" /> Desvinculando...</>
                  ) : (
                    'Confirmar Desvinculação'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Produção Tab ──────────────────────────────────────────────

  function renderProducao() {
    return (
      <div className="sv-producao" style={{ padding: '0 16px' }}>
        <div className="sv-section-hero">
          <h2 className="sv-hero-title" style={{ fontSize: '1.3rem' }}>Produção Semanal</h2>
          <p className="sv-hero-date">{selectedCompany?.nome}</p>
        </div>

        {/* Week Navigator */}
        <div className="sv-week-nav">
          <button className="sv-week-nav-btn" onClick={prevWeek}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <div className="sv-week-nav-center">
            <span className="sv-week-nav-label">{weekLabel}</span>
            <button className="sv-week-nav-reset" onClick={goToCurrentWeek}>Semana atual</button>
          </div>
          <button className="sv-week-nav-btn" onClick={nextWeek}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        </div>

        {productionLoading ? (
          <div className="sv-empty-state" style={{ padding: '40px 0' }}>
            <div className="sv-spinner" />
            <p className="sv-empty-sub">Carregando produção...</p>
          </div>
        ) : productionData.length === 0 ? (
          <div className="sv-empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.2" style={{ opacity: 0.3 }}>
              <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
            </svg>
            <p className="sv-empty-title">Sem atividade nesta semana</p>
            <p className="sv-empty-sub">Nenhuma corrida ou lançamento encontrado</p>
          </div>
        ) : (
          <div className="sv-driver-cards">
            {productionData.map(pd => {
              const isExpanded = expandedProdDriver === pd.driverId;
              const activeDays = Object.values(pd.days).filter(d => d.rides > 0 || d.diaria > 0).length;
              return (
                <div key={pd.driverId} className={`sv-driver-card ${isExpanded ? 'sv-driver-card--expanded' : ''}`}>
                  <div className="sv-driver-card-header" onClick={() => setExpandedProdDriver(isExpanded ? null : pd.driverId)}>
                    <div className="sv-driver-card-left">
                      <div className="sv-driver-avatar">{getInitials(pd.driverName)}</div>
                      <div>
                        <div className="sv-driver-card-name">{pd.driverName}</div>
                        <div className="sv-driver-card-phone">
                          {pd.totalRides} entregas · {activeDays} dia{activeDays !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                    <div className="sv-driver-card-right">
                      <span className="sv-driver-card-count" style={{ color: pd.totalNet >= 0 ? 'var(--color-success, #22c55e)' : '#CC5200' }}>
                        {formatBRL(pd.totalNet)}
                      </span>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                        style={{ transition: 'transform 200ms', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)' }}>
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </div>
                  </div>

                  {/* Day Chips */}
                  <div className="sv-driver-card-days">
                    {weekDates.map(d => {
                      const dayData = pd.days[d.iso];
                      const hasActivity = dayData && (dayData.rides > 0 || dayData.diaria > 0);
                      return (
                        <div key={d.iso} className={`sv-day-chip ${hasActivity ? 'sv-day-chip--confirmed' : 'sv-day-chip--empty'}`}>
                          <span className="sv-day-chip-name">{d.dayName}</span>
                          <span className="sv-day-chip-num">{dayData?.rides || 0}</span>
                          {hasActivity && <span className="sv-day-chip-status">ENT</span>}
                        </div>
                      );
                    })}
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="sv-driver-card-details">
                      {weekDates.map(d => {
                        const dayData = pd.days[d.iso];
                        if (!dayData || (dayData.rides === 0 && dayData.diaria === 0 && dayData.extras === 0 && dayData.advances === 0)) return null;
                        const dayNet = dayData.diaria + dayData.extras - dayData.advances;
                        return (
                          <div key={d.iso} className="sv-detail-row" style={{ flexDirection: 'column', gap: 4 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                              <span className="sv-detail-date" style={{ fontWeight: 700 }}>{d.dayName} {d.label}</span>
                              <span style={{ fontWeight: 700, fontSize: '0.78rem', color: dayNet >= 0 ? '#16a34a' : '#CC5200' }}>{formatBRL(dayNet)}</span>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: '0.72rem', color: '#64748b' }}>
                              {dayData.rides > 0 && <span>{dayData.rides} entregas</span>}
                              {dayData.diaria > 0 && <span>Diária: {formatBRL(dayData.diaria)}</span>}
                              {dayData.extras > 0 && <span>Extras: {formatBRL(dayData.extras)}</span>}
                              {dayData.advances > 0 && <span style={{ color: '#CC5200' }}>Adiant.: -{formatBRL(dayData.advances)}</span>}
                            </div>
                          </div>
                        );
                      })}
                      {/* Weekly Totals */}
                      <div className="sv-detail-row" style={{ borderTop: '1px solid #e2e8f0', paddingTop: 10, marginTop: 4 }}>
                        <div className="sv-detail-info" style={{ width: '100%' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', fontWeight: 700 }}>
                            <span>Total Semanal</span>
                            <span style={{ color: pd.totalNet >= 0 ? '#16a34a' : '#CC5200' }}>{formatBRL(pd.totalNet)}</span>
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: '0.68rem', color: '#94a3b8', marginTop: 4 }}>
                            <span>{pd.totalRides} entregas</span>
                            <span>Diárias: {formatBRL(pd.totalDiaria)}</span>
                            {pd.totalExtras > 0 && <span>Extras: {formatBRL(pd.totalExtras)}</span>}
                            {pd.totalAdvances > 0 && <span style={{ color: '#CC5200' }}>Adiant.: -{formatBRL(pd.totalAdvances)}</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────

  const content = (
    <>
      {activeTab === 'dashboard' && renderDashboard()}
      {activeTab === 'escalas' && renderEscalas()}
      {activeTab === 'producao' && renderProducao()}
      {activeTab === 'equipe' && renderEquipe()}

      {/* ── Add Driver Modal ─────────────────────────── */}
      {showAddDriver && (
        <div className="sv-modal-overlay" onClick={() => setShowAddDriver(false)}>
          <div className="sv-modal" onClick={e => e.stopPropagation()}>
            <div className="sv-modal-header">
              <h2 className="sv-modal-title">Adicionar à Escala</h2>
              <button className="sv-modal-close" onClick={() => setShowAddDriver(false)}>&times;</button>
            </div>
            <div className="sv-modal-body">
              {/* Store mode indicator */}
              {companyConfig && (
                <div style={{ marginBottom: 14, padding: '8px 12px', background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                  Modelo: <strong style={{ color: 'var(--color-text-secondary)' }}>
                    {companyConfig.report_type === 'producao' ? 'Produção'
                      : companyConfig.report_type === 'garantida' ? 'Garantida'
                      : 'Garantida por Horas'}
                  </strong>
                  {companyConfig.turnos_config.length > 0 && ` · ${companyConfig.turnos_config.length} turno(s)`}
                </div>
              )}

              {/* Driver select */}
              <div className="sv-form-group">
                <label className="sv-form-label">Motoboy</label>
                <select className="sv-form-input" value={selectedDriverId} onChange={e => setSelectedDriverId(e.target.value)}>
                  <option value="">Selecione...</option>
                  {(availableDrivers.length > 0 ? availableDrivers : companyDrivers).map(cd => (
                    <option key={cd.driver_id} value={cd.driver_id}>
                      {cd.driver.name}{cd.driver.phone ? ` (${cd.driver.phone})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* SHIFT / RATE — adapts to store model */}
              {companyConfig && companyConfig.turnos_config.length > 0 ? (
                /* Mode: Multiple predefined shifts */
                <div className="sv-form-group">
                  <label className="sv-form-label">Turno</label>
                  <select
                    className="sv-form-input"
                    value={selectedShift}
                    onChange={e => {
                      const label = e.target.value;
                      setSelectedShift(label);
                      const turno = companyConfig.turnos_config.find(t => t.label === label);
                      if (turno) {
                        setDailyRate(turno.diaria);
                        setCustomShiftStart(turno.inicio);
                        setCustomShiftEnd(turno.fim);
                      }
                    }}
                  >
                    {companyConfig.turnos_config.map(t => (
                      <option key={t.id} value={t.label}>
                        {t.label} ({t.inicio}–{t.fim}) · {formatBRL(t.diaria)}
                      </option>
                    ))}
                  </select>
                  <div style={{ marginTop: 6, fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                    Diária do turno: <strong>{formatBRL(dailyRate)}</strong>
                  </div>
                </div>
              ) : companyConfig && companyConfig.report_type === 'garantida_horas' ? (
                /* Mode: Garantida por Horas — no shift selection, show faixas info */
                <div className="sv-form-group">
                  <label className="sv-form-label">Horário</label>
                  <div className="sv-form-row">
                    <input type="time" className="sv-form-input" value={customShiftStart} onChange={e => setCustomShiftStart(e.target.value)} />
                    <input type="time" className="sv-form-input" value={customShiftEnd} onChange={e => setCustomShiftEnd(e.target.value)} />
                  </div>
                  <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-sm)', fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                    <strong>Faixas configuradas:</strong>
                    {companyConfig.faixas_horas_config.map(f => (
                      <div key={f.id} style={{ marginTop: 3 }}>
                        {f.label}: {formatBRL(f.valor)}
                      </div>
                    ))}
                    <div style={{ marginTop: 4, fontStyle: 'italic' }}>A diária será calculada ao fechar o dia baseado nas horas trabalhadas.</div>
                  </div>
                </div>
              ) : (
                /* Mode: Produção / Garantida simples — direct rate input */
                <div className="sv-form-row">
                  <div className="sv-form-group" style={{ flex: 1 }}>
                    <label className="sv-form-label">Horário</label>
                    <div className="sv-form-row">
                      <input type="time" className="sv-form-input" value={customShiftStart} onChange={e => setCustomShiftStart(e.target.value)} />
                      <input type="time" className="sv-form-input" value={customShiftEnd} onChange={e => setCustomShiftEnd(e.target.value)} />
                    </div>
                  </div>
                  <div className="sv-form-group" style={{ width: '100px' }}>
                    <label className="sv-form-label">Diária (R$)</label>
                    <input type="number" className="sv-form-input" value={dailyRate} onChange={e => setDailyRate(Number(e.target.value))} min={0} step={5} />
                  </div>
                </div>
              )}

              {/* Day selection */}
              <div className="sv-form-group">
                <label className="sv-form-label">Dias da Semana</label>
                <div className="sv-day-select">
                  {weekDates.map(d => {
                    const rateForDay = getDailyRateForDate(d.iso);
                    const hasTurnos = companyConfig && companyConfig.turnos_config.length > 0;
                    return (
                      <button
                        key={d.iso}
                        type="button"
                        className={`sv-day-select-btn ${selectedDays.includes(d.iso) ? 'active' : ''}`}
                        onClick={() => {
                          setSelectedDays(prev =>
                            prev.includes(d.iso) ? prev.filter(x => x !== d.iso) : [...prev, d.iso]
                          );
                          // If not using predefined shifts, update rate when selecting a single day
                          if (!hasTurnos) setDailyRate(rateForDay);
                        }}
                      >
                        <span className="sv-day-select-name">{d.dayName}</span>
                        <span className="sv-day-select-date">{d.label}</span>
                        {!hasTurnos && companyConfig?.report_type !== 'garantida_horas' && (
                          <span style={{ fontSize: '0.55rem', opacity: 0.6 }}>{formatBRL(rateForDay)}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="sv-select-all-btn"
                  onClick={() => {
                    setSelectedDays(selectedDays.length === weekDates.length ? [] : weekDates.map(d => d.iso));
                  }}
                >
                  {selectedDays.length === weekDates.length ? 'Desmarcar todos' : 'Selecionar todos'}
                </button>
              </div>
            </div>
            <div className="sv-modal-footer">
              <button className="sv-btn sv-btn--secondary" onClick={() => setShowAddDriver(false)}>
                Cancelar
              </button>
              <button
                className="sv-btn sv-btn--primary"
                onClick={handleAddEntries}
                disabled={!selectedDriverId || selectedDays.length === 0}
              >
                Adicionar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  // Supervisors get the mobile-native layout; admin/lojista get the standard page
  if (isSupervisor) {
    return (
      <SupervisorLayout activeTab={activeTab} onTabChange={setActiveTab}>
        {content}
      </SupervisorLayout>
    );
  }

  // Lojista cannot access this page — only admin/supervisor/coordinator
  if (!isAdmin && !isSupervisor) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        minHeight: '60vh', gap: 16, textAlign: 'center', padding: 32,
      }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <h2 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-text)' }}>Acesso Restrito</h2>
        <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '0.85rem', maxWidth: 320 }}>
          A gestão de escalas é exclusiva para administradores, supervisores e coordenadores.
        </p>
      </div>
    );
  }

  // Original admin layout
  return (
    <>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Escala Semanal</h1>
          <p className="page-subtitle">{selectedCompany.nome}</p>
        </div>
      </div>
      <div className="page-body">
        {renderEscalas()}
      </div>
    </>
  );
}
