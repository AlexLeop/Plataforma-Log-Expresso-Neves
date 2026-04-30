'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useToast } from '../../components/Toast';
import { authFetch } from '@/app/lib/api-client';
import Pagination, { usePagination } from '../../components/Pagination';
import {
  setDailyEntry, removeDailyEntry, getDailyEntriesForWeek,
  addManualEntry, getManualEntriesForWeek, deleteManualEntry,
  pullEntriesFromSupabase,
  type ManualEntry, type DailyEntry,
} from '../../services/entries-store';
import { getCompanyConfig, getDiariaForDate, type CompanyConfig, type FaixaHorasConfig } from '../../services/company-config';

interface DriverOption {
  id: string;
  nome: string;
  documento?: string;
}

interface RideDriver {
  id: string;
  nome: string;
}

function formatBRL(val: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
}

function getDatesOfWeek(startISO: string) {
  const start = new Date(startISO + 'T12:00:00');
  const dayNames = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const dates: { iso: string; label: string; dayName: string; isWeekend: boolean }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const dayOfWeek = d.getDay();
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    dates.push({
      iso,
      label: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
      dayName: dayNames[i],
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
    });
  }
  return dates;
}

function formatCPF(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

// ─── CPF Search Modal ──────────────────────────────────────────────
function CpfSearchModal({ onAdd, onClose, existingIds }: {
  onAdd: (driver: DriverOption) => void;
  onClose: () => void;
  existingIds: Set<string>;
}) {
  const [cpf, setCpf] = useState('');
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<DriverOption | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSearch = async () => {
    const digits = cpf.replace(/\D/g, '');
    if (digits.length !== 11) {
      setError('CPF deve conter 11 dígitos');
      return;
    }

    setSearching(true);
    setError('');
    setResult(null);

    try {
      const res = await authFetch('/api/machine/drivers');
      if (!res.ok) {
        setError('Erro ao buscar motoboys');
        return;
      }
      const data = await res.json();
      const drivers = data.drivers || [];

      // Search by CPF (documento field), with and without formatting
      const match = drivers.find((d: DriverOption & { documento?: string }) => {
        const docDigits = (d.documento || '').replace(/\D/g, '');
        return docDigits === digits;
      });

      if (match) {
        setResult({ id: String(match.id), nome: match.nome, documento: match.documento });
      } else {
        setError('Nenhum motoboy encontrado com este CPF. Verifique se o CPF está correto e se o motoboy está cadastrado na Machine.');
      }
    } catch {
      setError('Erro de conexão');
    } finally {
      setSearching(false);
    }
  };

  const alreadyAdded = result ? existingIds.has(result.id) : false;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: 'fadeInUp 0.2s ease',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 16, padding: '28px 32px',
        maxWidth: 460, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#1e293b' }}>
          Buscar Motoboy por CPF
        </h3>
        <p style={{ margin: '8px 0 20px', color: '#64748b', fontSize: '0.85rem', lineHeight: 1.5 }}>
          Informe o CPF do motoboy para adicioná-lo à sua lista de lançamentos.
        </p>

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            ref={inputRef}
            type="text"
            placeholder="000.000.000-00"
            value={cpf}
            onChange={e => setCpf(formatCPF(e.target.value))}
            onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
            style={{
              flex: 1, padding: '10px 14px', borderRadius: 10,
              border: '1px solid #e2e8f0', fontSize: '1rem',
              fontFamily: 'monospace', letterSpacing: 1,
              outline: 'none',
            }}
          />
          <button onClick={handleSearch} disabled={searching} style={{
            padding: '10px 18px', borderRadius: 10, border: 'none',
            background: 'var(--color-primary, #2563eb)', color: '#fff',
            fontSize: '0.85rem', fontWeight: 600, cursor: searching ? 'wait' : 'pointer',
            opacity: searching ? 0.7 : 1,
          }}>
            {searching ? 'Buscando...' : 'Buscar'}
          </button>
        </div>

        {error && (
          <div style={{
            marginTop: 14, padding: '10px 14px', borderRadius: 10,
            background: '#FFF7F0', border: '1px solid #FFD6B3', color: '#E55C00',
            fontSize: '0.8rem',
          }}>
            {error}
          </div>
        )}

        {result && (
          <div style={{
            marginTop: 14, padding: '14px 16px', borderRadius: 12,
            background: '#f0fdf4', border: '1px solid #a7f3d0',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: '0.95rem', color: '#1e293b' }}>
                  {result.nome}
                </p>
                <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: '#64748b', fontFamily: 'monospace' }}>
                  CPF: {formatCPF(result.documento || '')}
                </p>
              </div>
              {alreadyAdded ? (
                <span style={{
                  padding: '6px 14px', borderRadius: 8, fontSize: '0.75rem',
                  fontWeight: 600, background: '#e2e8f0', color: '#64748b',
                }}>
                  Já adicionado
                </span>
              ) : (
                <button onClick={() => { onAdd(result); onClose(); }} style={{
                  padding: '8px 18px', borderRadius: 10, border: 'none',
                  background: '#059669', color: '#fff', fontSize: '0.8rem',
                  fontWeight: 600, cursor: 'pointer',
                }}>
                  + Adicionar
                </button>
              )}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={{
            padding: '10px 20px', borderRadius: 10, border: '1px solid #e2e8f0',
            background: '#f8fafc', color: '#475569', fontSize: '0.85rem',
            fontWeight: 600, cursor: 'pointer',
          }}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────
export default function LancamentosPage() {
  const { selectedCompany, weekPeriod } = useAppContext();
  const { showToast } = useToast();

  // Drivers who had rides for this company/week (auto-detected producers)
  const [producerDrivers, setProducerDrivers] = useState<DriverOption[]>([]);
  // Drivers manually added via CPF search (persisted in localStorage)
  const [addedDrivers, setAddedDrivers] = useState<DriverOption[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem(`logipay:added_drivers:${selectedCompany?.id || 0}`);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const [loadingProducers, setLoadingProducers] = useState(true);
  const [showCpfModal, setShowCpfModal] = useState(false);

  // Persisted state
  const [dailyEntries, setDailyEntries] = useState<Record<string, DailyEntry>>({});
  const [manualEntries, setManualEntries] = useState<ManualEntry[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Turno ativo
  const [activeTurno, setActiveTurno] = useState<string>('');

  // Pagination for manual entries
  const {
    paginatedItems: paginatedManualEntries,
    currentPage: manualCurrentPage,
    setCurrentPage: setManualCurrentPage,
    itemsPerPage: manualPerPage,
    setItemsPerPage: setManualPerPage,
  } = usePagination(manualEntries, 10);

  // Inline editing state
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  const [modalForm, setModalForm] = useState({
    driverId: '',
    date: '',
    type: 'extra' as ManualEntry['type'],
    amount: 0,
    description: '',
  });

  const weekDates = useMemo(() => getDatesOfWeek(weekPeriod.start), [weekPeriod.start]);
  const companyId = selectedCompany?.id || 0;

  // Company config for diária defaults
  const companyConfig = useMemo<CompanyConfig>(() => {
    if (!selectedCompany) return {
      companyId: 0, companyName: '',
      taxaCorridaPerEntrega: 1.60, pisoFixo: 350, pisoPercentual: 0,
      taxaSupervisao: 0, debitoPendente: 0,
      diaria: { weekday: 60, saturday: 70, sunday: 80, holiday: 80 },
      turnos: [],
      extraKm: { mode: 'disabled' as const, minKm: 6, fixedAmount: 3 },
      autoCredit: { enabled: false, cutoffHour: 6, cutoffMinute: 0, creditDescription: '', mode: 'garantida' as const },
      report: { reportType: 'producao' as const, includeTaxaCorridas: true, showDiaria: true, showTxCorridas: true, showEntregas: true },
    };
    return getCompanyConfig(selectedCompany.id, selectedCompany.nome);
  }, [selectedCompany]);

  useEffect(() => {
    if (companyConfig.turnos && companyConfig.turnos.length > 0) {
      if (!activeTurno || activeTurno === 'dia_completo') {
        setActiveTurno(companyConfig.turnos[0].id);
      }
    } else {
      setActiveTurno('dia_completo');
    }
  }, [companyConfig.turnos, activeTurno]);

  // Default diárias for each day in the header
  const defaultDiarias = useMemo(() => {
    return weekDates.map(d => ({
      date: d.iso,
      value: getDiariaForDate(companyConfig, d.iso),
    }));
  }, [weekDates, companyConfig]);

  // Load producer drivers from rides (only this company's rides for this week)
  useEffect(() => {
    async function loadProducers() {
      if (!companyId) return;
      setLoadingProducers(true);
      try {
        const params = new URLSearchParams({
          empresa_id: String(companyId),
          limite: '500',
        });

        const res = await authFetch(`/api/machine/rides?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          const rides = data.rides || [];

          // Extract unique drivers from rides within the week
          const driverMap = new Map<string, string>();
          for (const ride of rides) {
            const dateStr = (ride.data_hora_solicitacao || '').split(' ')[0].split('T')[0];
            if (dateStr >= weekPeriod.start && dateStr <= weekPeriod.end) {
              const driverId = String(ride.condutor_id || ride.taxista_id || '');
              const driverName = ride.nome_condutor || ride.nome_taxista || '';
              if (driverId && driverName) {
                driverMap.set(driverId, driverName);
              }
            }
          }

          const producers = Array.from(driverMap.entries())
            .map(([id, nome]) => ({ id, nome }))
            .sort((a, b) => a.nome.localeCompare(b.nome));

          setProducerDrivers(producers);
        }
      } catch { /* silent */ }
      finally { setLoadingProducers(false); }
    }
    loadProducers();
  }, [companyId, weekPeriod]);

  // Combined driver list = producers + manually added (no duplicates)
  const drivers = useMemo<DriverOption[]>(() => {
    const map = new Map<string, DriverOption>();

    // 1. Producers (from rides)
    producerDrivers.forEach(d => map.set(d.id, d));

    // 2. Manually added via CPF
    addedDrivers.forEach(d => map.set(d.id, d));

    // 3. Drivers that already have saved entries for this week
    Object.values(dailyEntries).forEach(entry => {
      if (!map.has(entry.driverId)) {
        map.set(entry.driverId, { id: entry.driverId, nome: entry.driverName });
      }
    });
    manualEntries.forEach(entry => {
      if (!map.has(entry.driverId)) {
        map.set(entry.driverId, { id: entry.driverId, nome: entry.driverName });
      }
    });

    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [producerDrivers, addedDrivers, dailyEntries, manualEntries]);

  // Handle adding a driver via CPF modal (persists to localStorage)
  const handleAddDriver = useCallback((driver: DriverOption) => {
    setAddedDrivers(prev => {
      if (prev.find(d => d.id === driver.id)) return prev;
      const updated = [...prev, driver];
      try {
        localStorage.setItem(`logipay:added_drivers:${companyId}`, JSON.stringify(updated));
      } catch { /* silent */ }
      return updated;
    });
    showToast(`${driver.nome} adicionado à lista`, 'success');
  }, [showToast, companyId]);

  // Load persisted entries: pull from Supabase first, then read localStorage cache
  const loadPersistedData = useCallback(async () => {
    if (!companyId) return;

    // Pull latest from Supabase into localStorage cache
    await pullEntriesFromSupabase(companyId, weekPeriod.start, weekPeriod.end);

    // Read from cache (now updated with Supabase data)
    const savedDailies = getDailyEntriesForWeek(companyId, weekPeriod.start, weekPeriod.end);
    const map: Record<string, DailyEntry> = {};
    savedDailies.forEach(e => { map[`${e.driverId}:${e.date}:${e.turnoId || 'dia_completo'}`] = e; });
    setDailyEntries(map);

    const savedManuals = getManualEntriesForWeek(companyId, weekPeriod.start, weekPeriod.end);
    setManualEntries(savedManuals);
  }, [companyId, weekPeriod]);

  useEffect(() => { loadPersistedData(); }, [loadPersistedData]);

  // Focus inline edit input
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingCell]);

  // Toggle a daily checkbox — auto-fills with config default for that day
  const toggleDaily = (driver: DriverOption, dateISO: string) => {
    const key = `${driver.id}:${dateISO}:${activeTurno}`;
    const existing = dailyEntries[key];

    if (existing) {
      removeDailyEntry(driver.id, dateISO, companyId, activeTurno === 'dia_completo' ? undefined : activeTurno);
      setDailyEntries(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } else {
      // Find default value
      let defaultValue = getDiariaForDate(companyConfig, dateISO);
      if (activeTurno !== 'dia_completo') {
        const turnoConfig = companyConfig.turnos?.find(t => t.id === activeTurno);
        if (turnoConfig) {
          defaultValue = getDiariaForDate({ ...companyConfig, diaria: turnoConfig.diaria }, dateISO);
        }
      }

      const entry: DailyEntry = {
        driverId: driver.id,
        driverName: driver.nome,
        date: dateISO,
        turnoId: activeTurno === 'dia_completo' ? undefined : activeTurno,
        amount: defaultValue,
        diariaOverride: false,
        companyId,
      };
      setDailyEntry(entry);
      setDailyEntries(prev => ({ ...prev, [key]: entry }));
    }

    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 1500);
    showToast(existing ? 'Diária removida' : 'Diária registrada', existing ? 'info' : 'success');
  };

  // Select a faixa de horas for a driver on a specific date
  const selectFaixa = (driver: DriverOption, dateISO: string, faixa: FaixaHorasConfig | null) => {
    const key = `${driver.id}:${dateISO}:${activeTurno}`;
    if (!faixa) {
      // Remove entry
      removeDailyEntry(driver.id, dateISO, companyId, activeTurno === 'dia_completo' ? undefined : activeTurno);
      setDailyEntries(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      showToast('Faixa removida', 'info');
    } else {
      const entry: DailyEntry = {
        driverId: driver.id,
        driverName: driver.nome,
        date: dateISO,
        turnoId: activeTurno === 'dia_completo' ? undefined : activeTurno,
        amount: faixa.valor,
        diariaOverride: false,
        companyId,
        faixaId: faixa.id,
      };
      setDailyEntry(entry);
      setDailyEntries(prev => ({ ...prev, [key]: entry }));
      showToast(`${faixa.label} → ${formatBRL(faixa.valor)}`, 'success');
    }
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 1500);
  };

  const isHoursMode = companyConfig.report?.reportType === 'garantida_horas';
  const faixas = companyConfig.faixasHoras || [];

  // Start inline editing of a diária value
  const startEdit = (key: string, currentValue: number) => {
    setEditingCell(key);
    setEditValue(String(currentValue));
  };

  // Save inline edit
  const saveEdit = (driverId: string, dateISO: string) => {
    const newAmount = parseFloat(editValue);
    if (isNaN(newAmount) || newAmount < 0) {
      setEditingCell(null);
      return;
    }

    const key = `${driverId}:${dateISO}:${activeTurno}`;
    const existing = dailyEntries[key];
    if (!existing) {
      setEditingCell(null);
      return;
    }

    let defaultValue = getDiariaForDate(companyConfig, dateISO);
    if (activeTurno !== 'dia_completo') {
      const turnoConfig = companyConfig.turnos?.find(t => t.id === activeTurno);
      if (turnoConfig) {
        defaultValue = getDiariaForDate({ ...companyConfig, diaria: turnoConfig.diaria }, dateISO);
      }
    }
    
    const isOverride = Math.abs(newAmount - defaultValue) > 0.01;

    const updated: DailyEntry = {
      ...existing,
      amount: newAmount,
      diariaOverride: isOverride,
    };

    setDailyEntry(updated);
    setDailyEntries(prev => ({ ...prev, [key]: updated }));
    setEditingCell(null);
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 1500);
    showToast(`Diária atualizada: ${formatBRL(newAmount)}`, 'success');
  };

  const cancelEdit = () => { setEditingCell(null); };

  // Add manual entry
  const saveEntry = async () => {
    const driver = drivers.find(d => d.id === modalForm.driverId);
    if (!driver || !modalForm.date || modalForm.amount <= 0) return;

    const entry = await addManualEntry({
      driverId: modalForm.driverId,
      driverName: driver.nome,
      date: modalForm.date,
      type: modalForm.type,
      amount: modalForm.amount,
      description: modalForm.description,
      companyId,
    });

    setManualEntries(prev => [entry, ...prev]);
    setShowModal(false);
    setModalForm({ driverId: '', date: '', type: 'extra', amount: 0, description: '' });
    showToast('Lançamento adicionado', 'success');
  };

  const handleDeleteManual = (id: string) => {
    deleteManualEntry(id);
    setManualEntries(prev => prev.filter(e => e.id !== id));
    showToast('Lançamento excluído', 'info');
  };

  // Totals
  const checkedCount = Object.keys(dailyEntries).length;
  const totalDailyValue = Object.values(dailyEntries).reduce((sum, e) => sum + e.amount, 0);

  const getDriverTotal = (driverId: string) =>
    Object.entries(dailyEntries)
      .filter(([key]) => key.startsWith(`${driverId}:`))
      .reduce((sum, [, entry]) => sum + entry.amount, 0);

  const getDriverDaysCount = (driverId: string) =>
    Object.keys(dailyEntries).filter(key => key.startsWith(`${driverId}:`)).length;

  const typeLabels: Record<string, { label: string; badge: string }> = {
    diaria: { label: 'Diária', badge: 'badge-info' },
    extra: { label: 'Extra', badge: 'badge-success' },
    missao: { label: 'Missão', badge: 'badge-warning' },
    adiantamento: { label: 'Adiantamento', badge: 'badge-danger' },
  };

  const existingDriverIds = useMemo(() => new Set(drivers.map(d => d.id)), [drivers]);

  return (
    <>
      <header className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Lançamentos Manuais</h1>
            <p className="page-subtitle">
              {selectedCompany?.nome} • Diárias, extras, missões e adiantamentos
            </p>
          </div>
          <div className="flex gap-sm">
            {saveStatus === 'saved' && (
              <span className="badge badge-success" style={{ fontSize: '0.7rem', padding: '4px 12px' }}>
                ✓ Salvo
              </span>
            )}
            <button
              className="btn"
              style={{ background: 'white', color: 'var(--color-primary)', fontWeight: 600 }}
              onClick={() => setShowCpfModal(true)}
            >
              Buscar por CPF
            </button>
            <button className="btn" style={{ background: 'white', color: 'var(--color-primary)' }} onClick={() => setShowModal(true)}>
              + Novo Lançamento
            </button>
          </div>
        </div>
      </header>

      <div className="page-body">
        {/* Info badge about driver count */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'var(--space-md)',
          padding: '10px 16px', borderRadius: 10,
          background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.12)',
        }}>
          <span style={{ fontSize: '0.8rem', color: '#475569' }}>
            <strong>{producerDrivers.length}</strong> motoboy(s) produziram nesta semana
            {addedDrivers.length > 0 && (
              <> • <strong style={{ color: '#059669' }}>+{addedDrivers.length}</strong> adicionado(s) manualmente</>
            )}
            {drivers.length === 0 && !loadingProducers && (
              <> — Use <strong>&quot;Buscar por CPF&quot;</strong> para adicionar motoboys</>
            )}
          </span>
        </div>

        {/* Grade de diárias */}
        <div className="card">
          <div className="card-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 className="card-title">DIÁRIAS — SEMANA {weekPeriod.label}</h2>
              <div className="flex items-center gap-sm">
                <span className="badge badge-info" style={{ fontSize: '0.65rem' }}>
                  {companyConfig.diaria.weekday > 0 ? `Seg-Sex: R$ ${companyConfig.diaria.weekday}` : ''}
                  {companyConfig.diaria.saturday > 0 ? ` | Sáb: R$ ${companyConfig.diaria.saturday}` : ''}
                  {companyConfig.diaria.sunday > 0 ? ` | Dom: R$ ${companyConfig.diaria.sunday}` : ''}
                </span>
              </div>
            </div>

            {/* Turno Tabs */}
            {companyConfig.turnos && companyConfig.turnos.length > 0 && (
              <div style={{ display: 'flex', gap: 8, background: '#f8fafc', padding: 4, borderRadius: 8 }}>
                {/* Fallback para caso queira lançar o dia inteiro */}
                <button
                  onClick={() => setActiveTurno('dia_completo')}
                  style={{
                    padding: '6px 12px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600, border: 'none', cursor: 'pointer',
                    background: activeTurno === 'dia_completo' ? '#fff' : 'transparent',
                    color: activeTurno === 'dia_completo' ? '#1e293b' : '#64748b',
                    boxShadow: activeTurno === 'dia_completo' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    transition: 'all 0.2s',
                  }}
                >
                  Dia Inteiro
                </button>
                {companyConfig.turnos.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setActiveTurno(t.id)}
                    style={{
                      padding: '6px 12px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600, border: 'none', cursor: 'pointer',
                      background: activeTurno === t.id ? '#fff' : 'transparent',
                      color: activeTurno === t.id ? '#1e293b' : '#64748b',
                      boxShadow: activeTurno === t.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                      transition: 'all 0.2s',
                    }}
                  >
                    {t.nome} ({t.startTime} - {t.endTime})
                  </button>
                ))}
              </div>
            )}
          </div>

          <p className="text-muted" style={{ fontSize: '0.7rem', marginBottom: 'var(--space-sm)' }}>
            {isHoursMode
              ? 'Selecione a faixa de horas trabalhadas para cada motoboy. O valor do garantido será aplicado automaticamente.'
              : 'Clique na célula para marcar presença no turno selecionado. Clique no valor para editar manualmente (ex: desconto ou bônus).'}
          </p>

          {/* Hours mode: faixas legend */}
          {isHoursMode && faixas.length > 0 && (
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 'var(--space-md)',
              padding: '8px 12px', background: 'rgba(168, 85, 247, 0.04)',
              borderRadius: 'var(--radius-md)', border: '1px solid rgba(168, 85, 247, 0.12)',
            }}>
              <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#7c3aed', alignSelf: 'center' }}>⏱ Faixas:</span>
              {faixas.map((f, i) => {
                const colors = ['#3b82f6', '#10b981', '#f59e0b', '#CC5200', '#8b5cf6', '#ec4899'];
                const color = colors[i % colors.length];
                return (
                  <span key={f.id} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '3px 10px', borderRadius: 20,
                    background: `${color}15`, color, border: `1px solid ${color}30`,
                    fontSize: '0.65rem', fontWeight: 700,
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }}></span>
                    {f.label} = {formatBRL(f.valor)}
                  </span>
                );
              })}
            </div>
          )}

          {loadingProducers ? (
            <p className="text-muted text-center" style={{ padding: 'var(--space-xl)' }}>Carregando motoboys que produziram...</p>
          ) : drivers.length === 0 ? (
            <div className="text-center" style={{ padding: 'var(--space-xl)' }}>
              <p className="text-muted" style={{ fontSize: '0.85rem' }}>
                Nenhum motoboy produziu nesta semana para esta empresa.
              </p>
              <button
                className="btn btn-primary mt-md"
                style={{ fontSize: '0.8rem' }}
                onClick={() => setShowCpfModal(true)}
              >
                Adicionar motoboy por CPF
              </button>
            </div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 170 }}>Motoboy</th>
                    {weekDates.map((d, i) => {
                      const turnoInfo = activeTurno === 'dia_completo' ? defaultDiarias[i] : {
                        date: d.iso,
                        value: (() => {
                          const t = companyConfig.turnos?.find(tt => tt.id === activeTurno);
                          return t ? getDiariaForDate({ ...companyConfig, diaria: t.diaria }, d.iso) : 0;
                        })(),
                      };
                      
                      return (
                      <th key={d.iso} className="text-center" style={{
                        width: 75,
                        background: d.isWeekend ? 'rgba(37,99,235,0.06)' : undefined,
                      }}>
                        {d.dayName}<br />
                        <span style={{ fontWeight: 400, fontSize: '0.6rem' }}>{d.label}</span>
                        <br />
                        <span style={{
                          fontWeight: 600, fontSize: '0.65rem',
                          color: 'var(--color-primary)'
                        }}>
                          R$ {turnoInfo.value}
                        </span>
                      </th>
                    )})}
                    <th className="text-center" style={{ width: 50 }}>Dias</th>
                    <th className="text-right" style={{ width: 90 }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {drivers.map(driver => {
                    const isManuallyAdded = addedDrivers.some(d => d.id === driver.id);
                    return (
                      <tr key={driver.id}>
                        <td style={{ fontWeight: 600 }}>
                          {driver.nome}
                          {isManuallyAdded && (
                            <span style={{
                              marginLeft: 6, fontSize: '0.55rem', padding: '1px 5px',
                              borderRadius: 4, background: '#ecfdf5', color: '#059669',
                              fontWeight: 700, verticalAlign: 'middle',
                            }}>CPF</span>
                          )}
                        </td>
                        {weekDates.map(d => {
                          const key = `${driver.id}:${d.iso}:${activeTurno}`;
                          const entry = dailyEntries[key];
                          const isChecked = !!entry;
                          const isEditing = editingCell === key;
                          const isOverride = entry?.diariaOverride || false;

                          return (
                            <td key={d.iso} className="text-center" style={{
                              padding: '2px',
                              background: d.isWeekend ? 'rgba(37,99,235,0.03)' : undefined,
                            }}>
                              {isEditing ? (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                                  <input
                                    ref={editInputRef}
                                    type="number"
                                    step="0.01"
                                    value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') saveEdit(driver.id, d.iso);
                                      if (e.key === 'Escape') cancelEdit();
                                    }}
                                    onBlur={() => saveEdit(driver.id, d.iso)}
                                    style={{
                                      width: 60, height: 28, fontSize: '0.7rem',
                                      textAlign: 'center', border: '2px solid var(--color-primary)',
                                      borderRadius: 'var(--radius-sm)', outline: 'none',
                                      fontWeight: 700, padding: '0 4px',
                                    }}
                                  />
                                </div>
                              ) : isHoursMode ? (
                                // ─── HOURS MODE: faixa dropdown ───
                                (() => {
                                  let selectedFaixaId = entry?.faixaId || '';
                                  if (!selectedFaixaId && entry) {
                                    const matchedFaixa = faixas.find(f => Math.abs(f.valor - entry.amount) < 0.01);
                                    if (matchedFaixa) selectedFaixaId = matchedFaixa.id;
                                  }
                                  const selectedFaixa = faixas.find(f => f.id === selectedFaixaId);
                                  const faixaColors = ['#3b82f6', '#10b981', '#f59e0b', '#CC5200', '#8b5cf6', '#ec4899'];
                                  const faixaIdx = selectedFaixa ? faixas.indexOf(selectedFaixa) : -1;
                                  const faixaColor = faixaIdx >= 0 ? faixaColors[faixaIdx % faixaColors.length] : '#9ca3af';

                                  return (
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                                      <select
                                        value={selectedFaixaId}
                                        onChange={e => {
                                          const fId = e.target.value;
                                          if (!fId) {
                                            selectFaixa(driver, d.iso, null);
                                          } else {
                                            const f = faixas.find(fx => fx.id === fId);
                                            if (f) selectFaixa(driver, d.iso, f);
                                          }
                                        }}
                                        style={{
                                          width: 68, height: 30, fontSize: '0.6rem',
                                          textAlign: 'center', border: isChecked ? `2px solid ${faixaColor}` : '2px solid #e5e7eb',
                                          borderRadius: 'var(--radius-sm)', outline: 'none',
                                          fontWeight: 700, padding: '0 2px', cursor: 'pointer',
                                          background: isChecked ? `${faixaColor}10` : '#fff',
                                          color: isChecked ? faixaColor : '#9ca3af',
                                        }}
                                      >
                                        <option value="">—</option>
                                        {faixas.map((f, fi) => (
                                          <option key={f.id} value={f.id}>{f.label}</option>
                                        ))}
                                      </select>
                                      {isChecked && selectedFaixa && (
                                        <span style={{
                                          fontSize: '0.6rem', fontWeight: 700, color: faixaColor,
                                          lineHeight: 1,
                                        }}>
                                          {formatBRL(entry.amount)}
                                        </span>
                                      )}
                                    </div>
                                  );
                                })()
                              ) : isChecked ? (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                                  <button
                                    onClick={() => toggleDaily(driver, d.iso)}
                                    title="Desmarcar presença"
                                    style={{
                                      width: 24, height: 20, borderRadius: 'var(--radius-sm)',
                                      border: 'none', background: 'var(--color-primary)',
                                      color: 'white', cursor: 'pointer', fontSize: '0.65rem',
                                      fontWeight: 700, transition: 'all var(--transition-fast)',
                                      boxShadow: '0 1px 3px rgba(37,99,235,0.3)', lineHeight: 1,
                                    }}
                                  >✓</button>
                                  <button
                                    onClick={() => startEdit(key, entry.amount)}
                                    title="Clique para editar o valor da diária"
                                    style={{
                                      background: 'none', border: 'none', cursor: 'pointer',
                                      fontSize: '0.65rem', fontWeight: 700,
                                      color: isOverride ? '#d97706' : 'var(--color-secondary)',
                                      padding: '1px 4px', borderRadius: 'var(--radius-sm)',
                                      transition: 'background var(--transition-fast)',
                                      textDecoration: isOverride ? 'underline dashed' : 'none',
                                    }}
                                    onMouseOver={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.05)')}
                                    onMouseOut={e => (e.currentTarget.style.background = 'none')}
                                  >
                                    R$ {entry.amount.toFixed(0)}
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => toggleDaily(driver, d.iso)}
                                  title={`Marcar presença — R$ ${getDiariaForDate(companyConfig, d.iso)}`}
                                  style={{
                                    width: 36, height: 36, borderRadius: 'var(--radius-sm)',
                                    border: '2px solid var(--color-border)', background: 'white',
                                    color: 'transparent', cursor: 'pointer', fontSize: '0.75rem',
                                    fontWeight: 700, transition: 'all var(--transition-fast)',
                                  }}
                                >{''}</button>
                              )}
                            </td>
                          );
                        })}
                        <td className="text-center text-mono" style={{
                          fontWeight: 600, fontSize: '0.75rem',
                          color: getDriverDaysCount(driver.id) > 0 ? 'var(--color-text)' : 'var(--color-text-muted)',
                        }}>
                          {getDriverDaysCount(driver.id) > 0 ? getDriverDaysCount(driver.id) : '—'}
                        </td>
                        <td className="text-right text-mono" style={{
                          fontWeight: 700, fontSize: '0.85rem',
                          color: getDriverTotal(driver.id) > 0 ? 'var(--color-primary)' : 'var(--color-text-muted)',
                        }}>
                          {getDriverTotal(driver.id) > 0 ? formatBRL(getDriverTotal(driver.id)) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between mt-md">
            <span className="text-muted" style={{ fontSize: '0.75rem' }}>
              {checkedCount} diárias marcadas • Total: <strong style={{ color: 'var(--color-primary)' }}>{formatBRL(totalDailyValue)}</strong>
            </span>
            <div className="flex items-center gap-sm" style={{ fontSize: '0.65rem' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                color: '#d97706', fontWeight: 600,
              }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#d97706', display: 'inline-block' }}></span>
                Valor editado manualmente
              </span>
            </div>
          </div>
        </div>

        {/* Lançamentos manuais (extras, missões, adiantamentos) */}
        <div className="card mt-md">
          <div className="card-header">
            <h2 className="card-title">Lançamentos Extras — Semana {weekPeriod.label}</h2>
            <span className="badge badge-info">{manualEntries.length} registros</span>
          </div>
          {manualEntries.length === 0 ? (
            <p className="text-muted text-center" style={{ padding: 'var(--space-lg)', fontSize: '0.8rem' }}>
              Nenhum lançamento extra nesta semana. Use &quot;+ Novo Lançamento&quot; para extras, missões ou adiantamentos.
            </p>
          ) : (
            <>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Motoboy</th>
                    <th>Data</th>
                    <th>Tipo</th>
                    <th className="text-right">Valor</th>
                    <th>Descrição</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedManualEntries.map(e => {
                    const t = typeLabels[e.type] || { label: e.type, badge: 'badge-info' };
                    return (
                      <tr key={e.id}>
                        <td style={{ fontWeight: 600 }}>{e.driverName}</td>
                        <td className="text-mono text-muted">{e.date}</td>
                        <td><span className={`badge ${t.badge}`}>{t.label}</span></td>
                        <td className="text-right text-mono" style={{
                          fontWeight: 600,
                          color: e.type === 'adiantamento' ? 'var(--color-danger)' : 'var(--color-text)',
                        }}>
                          {e.type === 'adiantamento' ? '-' : ''}{formatBRL(e.amount)}
                        </td>
                        <td className="text-muted">{e.description || '—'}</td>
                        <td>
                          <button className="btn btn-sm" style={{ color: 'var(--color-danger)', background: 'none', border: 'none' }}
                            onClick={() => handleDeleteManual(e.id)}>
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Pagination
              currentPage={manualCurrentPage}
              totalItems={manualEntries.length}
              itemsPerPage={manualPerPage}
              onPageChange={setManualCurrentPage}
              onItemsPerPageChange={setManualPerPage}
              perPageOptions={[10, 25, 50]}
            />
            </>
          )}
        </div>
      </div>

      {/* Modal — Buscar por CPF */}
      {showCpfModal && (
        <CpfSearchModal
          onAdd={handleAddDriver}
          onClose={() => setShowCpfModal(false)}
          existingIds={existingDriverIds}
        />
      )}

      {/* Modal — Novo Lançamento */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', zIndex: 10000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'fadeInUp 0.2s ease',
        }} onClick={() => setShowModal(false)}>
          <div className="card" onClick={e => e.stopPropagation()} style={{ width: 460, maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div className="card-header">
              <h2 className="card-title">Novo Lançamento</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowModal(false)}>✕</button>
            </div>

            <div className="form-group">
              <label className="form-label">Motoboy</label>
              <select className="form-select" value={modalForm.driverId} onChange={e => setModalForm(f => ({ ...f, driverId: e.target.value }))}>
                <option value="">Selecione...</option>
                {drivers.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}
              </select>
              {drivers.length === 0 && (
                <p style={{ fontSize: '0.7rem', color: '#d97706', marginTop: 4 }}>
                  Nenhum motoboy na lista. Use &quot; Buscar por CPF&quot; para adicionar.
                </p>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Data</label>
              <select className="form-select" value={modalForm.date} onChange={e => setModalForm(f => ({ ...f, date: e.target.value }))}>
                <option value="">Selecione o dia...</option>
                {weekDates.map(d => (
                  <option key={d.iso} value={d.iso}>{d.dayName} — {d.label}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Tipo</label>
              <select className="form-select" value={modalForm.type} onChange={e => setModalForm(f => ({ ...f, type: e.target.value as ManualEntry['type'] }))}>
                <option value="extra">Extra</option>
                <option value="missao">Missão</option>
                <option value="adiantamento">Adiantamento (desconto)</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Valor (R$)</label>
              <input type="number" className="form-input" step="0.01" value={modalForm.amount}
                onChange={e => setModalForm(f => ({ ...f, amount: Number(e.target.value) }))} />
            </div>

            <div className="form-group">
              <label className="form-label">Descrição</label>
              <input className="form-input" placeholder="Ex: Entrega extra shopping" value={modalForm.description}
                onChange={e => setModalForm(f => ({ ...f, description: e.target.value }))} />
            </div>

            <div className="flex justify-between mt-md">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveEntry}
                disabled={!modalForm.driverId || !modalForm.date || modalForm.amount <= 0}>
                Salvar Lançamento
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
