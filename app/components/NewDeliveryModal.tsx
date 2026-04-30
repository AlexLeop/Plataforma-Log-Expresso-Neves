'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useAppContext, type CompanyCategory } from '../context/AppContext';
import { useToast } from './Toast';
import { authFetch } from '@/app/lib/api-client';

// ─── Types ───────────────────────────────────────────────────

interface ParadaForm {
  endereco: string;
  numero: string;
  bairro: string;
  complemento: string;
  cidade: string;
  estado: string;
  lat: string;
  lng: string;
  contato: string;
  telefone: string;
  observacao: string;
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  address?: {
    road?: string;
    house_number?: string;
    suburb?: string;
    city?: string;
    town?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
}

const PAYMENT_LABELS: Record<string, { label: string; abbr: string }> = {
  D: { label: 'Dinheiro', abbr: 'DIN' },
  B: { label: 'Débito', abbr: 'DEB' },
  C: { label: 'Crédito', abbr: 'CRE' },
  X: { label: 'Pix', abbr: 'PIX' },
  P: { label: 'PicPay', abbr: 'PIC' },
  H: { label: 'WhatsApp', abbr: 'WPP' },
  F: { label: 'Faturado', abbr: 'FAT' },
  R: { label: 'Carteira', abbr: 'CAR' },
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  D: { label: 'Distribuindo', color: '#6366F1' },
  G: { label: 'Aguardando Aceite', color: '#F59E0B' },
  P: { label: 'Buscando Condutor', color: '#8B5CF6' },
  A: { label: 'Aceita', color: '#22C55E' },
  E: { label: 'Em Andamento', color: '#3B82F6' },
  F: { label: 'Finalizada', color: '#16A34A' },
  N: { label: 'Não Atendida', color: '#CC5200' },
  C: { label: 'Cancelada', color: '#6B7280' },
  S: { label: 'Em Espera', color: '#F59E0B' },
  U: { label: 'Agrupada', color: '#8B5CF6' },
};

const ACCENT = '#E55C00';
const ACCENT_LIGHT = 'rgba(229, 92, 0, 0.08)';

function emptyParada(): ParadaForm {
  return { endereco: '', numero: '', bairro: '', complemento: '', cidade: '', estado: '', lat: '', lng: '', contato: '', telefone: '', observacao: '' };
}

// ─── Autocomplete Hook ───────────────────────────────────────

function useAddressAutocomplete() {
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const search = useCallback((query: string, biasLat?: number, biasLng?: number) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.length < 3) {
      setSuggestions([]);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const encoded = encodeURIComponent(query);
        // Build Nominatim URL with location bias if available
        let url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&addressdetails=1&limit=8&countrycodes=br`;

        // Add viewbox bias (~50km around company) to prioritize local results
        if (biasLat && biasLng) {
          const delta = 0.5; // ~50km
          url += `&viewbox=${biasLng - delta},${biasLat - delta},${biasLng + delta},${biasLat + delta}&bounded=0`;
        }

        const res = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
        if (res.ok) {
          const data: NominatimResult[] = await res.json();
          // Filter to only street-level results (avoid cities, states, countries)
          const filtered = data.filter(d =>
            d.address?.road || d.address?.house_number || d.address?.suburb
          );
          setSuggestions(filtered.length > 0 ? filtered.slice(0, 5) : data.slice(0, 5));
        }
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }, 400);
  }, []);

  const clear = useCallback(() => setSuggestions([]), []);

  return { suggestions, loading, search, clear };
}

// ─── Address Input Component ─────────────────────────────────

interface AddressInputProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (result: NominatimResult) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  biasLat?: number;
  biasLng?: number;
}

function AddressInput({ value, onChange, onSelect, placeholder, style, biasLat, biasLng }: AddressInputProps) {
  const { suggestions, loading, search, clear } = useAddressAutocomplete();
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        clear();
        setFocused(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [clear]);

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px',
    border: `1px solid ${focused ? ACCENT : '#D5CEC8'}`,
    borderRadius: suggestions.length > 0 ? '8px 8px 0 0' : '8px',
    fontSize: '0.82rem', background: '#FAFAF9',
    outline: 'none', transition: 'border-color 0.15s',
    ...style,
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          style={inputStyle}
          placeholder={placeholder ?? 'Digite o endereço...'}
          value={value}
          onChange={e => {
            onChange(e.target.value);
            search(e.target.value, biasLat, biasLng);
          }}
          onFocus={() => setFocused(true)}
        />
        {loading && (
          <span style={{
            position: 'absolute', right: '10px', top: '50%',
            transform: 'translateY(-50%)', fontSize: '0.7rem', color: '#9CA3AF',
          }}>
            ...
          </span>
        )}
      </div>

      {suggestions.length > 0 && (
        <div style={{
          position: 'absolute', left: 0, right: 0, top: '100%',
          zIndex: 50, background: 'white',
          border: `1px solid ${ACCENT}`, borderTop: 'none',
          borderRadius: '0 0 8px 8px',
          boxShadow: '0 8px 20px rgba(0,0,0,0.12)',
          maxHeight: '220px', overflowY: 'auto',
        }}>
          {suggestions.map((s, i) => {
            const road = s.address?.road || s.display_name.split(',')[0]?.trim() || '';
            const num = s.address?.house_number || '';
            const suburb = s.address?.suburb || '';
            const city = s.address?.city || s.address?.town || '';
            const state = s.address?.state || '';
            const cep = s.address?.postcode || '';

            // Brazilian standard: Rua, Nº, Bairro, Cidade - UF, CEP
            const mainPart = num ? `${road}, ${num}` : road;
            const detailParts = [suburb, city].filter(Boolean).join(', ');

            return (
              <button
                key={s.place_id}
                onClick={() => {
                  onSelect(s);
                  // Display format: just show road + number for the input field
                  // (bairro, cidade, estado are stored in separate parada fields)
                  onChange(mainPart);
                  clear();
                }}
                style={{
                  width: '100%', textAlign: 'left',
                  padding: '10px 12px', border: 'none',
                  background: 'transparent', cursor: 'pointer',
                  fontSize: '0.75rem', color: '#374151',
                  borderTop: i > 0 ? '1px solid #F3F4F6' : 'none',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#F9FAFB'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{ lineHeight: 1.4 }}>
                  <span style={{ fontWeight: 600 }}>{mainPart}</span>
                  {detailParts && (
                    <span style={{ color: '#6B7280', marginLeft: '4px' }}>
                      {detailParts}{state ? ` - ${state}` : ''}
                    </span>
                  )}
                  {cep && (
                    <span style={{ color: '#9CA3AF', marginLeft: '6px', fontSize: '0.65rem' }}>
                      CEP {cep}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Modal Component ─────────────────────────────────────────

interface NewDeliveryModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function NewDeliveryModal({ open, onClose, onSuccess }: NewDeliveryModalProps) {
  const { selectedCompany } = useAppContext();
  const { showToast } = useToast();

  // Steps: 1=Paradas, 2=Revisão
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Form state
  const [paradas, setParadas] = useState<ParadaForm[]>([emptyParada()]);
  const [formaPagamento, setFormaPagamento] = useState(
    selectedCompany?.tipos_pagamento?.[0] || 'F'
  );
  const [categoriaId, setCategoriaId] = useState(
    selectedCompany?.categorias?.[0]?.id || ''
  );
  const [observacao, setObservacao] = useState('');


  // Estimation state
  const [estimativa, setEstimativa] = useState<{ valor?: string; distancia?: string; tempo?: string } | null>(null);
  const [estimating, setEstimating] = useState(false);

  const availablePayments = selectedCompany?.tipos_pagamento || ['D', 'B', 'C', 'X', 'F'];
  const availableCategories: CompanyCategory[] = selectedCompany?.categorias || [];

  // Fetch estimate for all stops (sums each leg: company→stop1, stop1→stop2, etc.)
  const fetchEstimate = useCallback(async () => {
    if (!selectedCompany || paradas.length === 0 || !paradas[0].endereco) return;
    setEstimating(true);
    setEstimativa(null);
    try {
      let totalValor = 0;
      let totalDistancia = 0;
      let totalTempo = 0;
      let hasEstimate = false;

      // Build list of legs: [company→1, 1→2, 2→3, ...]
      const legs: { from: { endereco: string; bairro: string; cidade: string; estado: string; lat?: string; lng?: string }; to: ParadaForm }[] = [];

      for (let i = 0; i < paradas.length; i++) {
        const p = paradas[i];
        if (!p.endereco) continue;

        if (i === 0) {
          // First leg: company → first stop
          legs.push({
            from: {
              endereco: selectedCompany.endereco || '',
              bairro: selectedCompany.bairro || '',
              cidade: selectedCompany.cidade || '',
              estado: selectedCompany.uf || 'RJ',
              lat: selectedCompany.lat,
              lng: selectedCompany.lng,
            },
            to: p,
          });
        } else {
          // Subsequent legs: previous stop → current stop
          const prev = paradas[i - 1];
          legs.push({
            from: {
              endereco: prev.endereco,
              bairro: prev.bairro,
              cidade: prev.cidade,
              estado: prev.estado,
              lat: prev.lat,
              lng: prev.lng,
            },
            to: p,
          });
        }
      }

      // Fetch all legs in parallel (Promise.all)
      const results = await Promise.all(legs.map(async (leg) => {
        const queryParams: Record<string, string> = {
          endereco_partida: leg.from.endereco,
          bairro_partida: leg.from.bairro,
          cidade_partida: leg.from.cidade,
          estado_partida: leg.from.estado,
          endereco_desejado: leg.to.endereco,
          bairro_desejado: leg.to.bairro,
          cidade_desejado: leg.to.cidade,
          estado_desejado: leg.to.estado,
        };
        if (leg.from.lat) queryParams.lat_partida = leg.from.lat;
        if (leg.from.lng) queryParams.lng_partida = leg.from.lng;
        if (leg.to.lat) queryParams.lat_desejado = leg.to.lat;
        if (leg.to.lng) queryParams.lng_desejado = leg.to.lng;
        if (categoriaId) queryParams.id_categoria = categoriaId;

        try {
          const params = new URLSearchParams(queryParams);
          const res = await authFetch(`/api/machine/rides/estimate?${params.toString()}`);
          const data = await res.json();
          if (res.ok && data) return data.response || data;
        } catch { /* silent */ }
        return null;
      }));

      // Sum results
      for (const resp of results) {
        if (!resp) continue;
        const valor = resp.estimativa_valor ?? resp.valor_corrida ?? resp.valor ?? null;
        const distancia = resp.estimativa_km ?? resp.distancia_km ?? resp.distancia ?? null;
        const tempo = resp.estimativa_minutos ?? resp.tempo_estimado ?? resp.tempo ?? null;

        if (valor !== null && valor !== undefined) {
          totalValor += Number(valor);
          hasEstimate = true;
        }
        if (distancia !== null) totalDistancia += Number(distancia);
        if (tempo !== null) totalTempo += Number(tempo);
      }

      if (hasEstimate) {
        setEstimativa({
          valor: totalValor.toFixed(2),
          distancia: totalDistancia > 0 ? totalDistancia.toFixed(1) : undefined,
          tempo: totalTempo > 0 ? String(Math.round(totalTempo)) : undefined,
        });
      } else {
        console.warn('[Estimate] No valid estimates returned');
      }
    } catch (err) {
      console.error('[Estimate exception]', err);
    } finally {
      setEstimating(false);
    }
  }, [selectedCompany, paradas, categoriaId]);

  // ─── Handlers ────────────────────────────────────────────

  const updateParada = useCallback((index: number, field: keyof ParadaForm, value: string) => {
    setParadas(prev => prev.map((p, i) => i === index ? { ...p, [field]: value } : p));
  }, []);

  const handleAddressSelect = useCallback((index: number, result: NominatimResult) => {
    // Extract state abbreviation from Nominatim
    const stateMap: Record<string, string> = {
      'Acre': 'AC', 'Alagoas': 'AL', 'Amapá': 'AP', 'Amazonas': 'AM',
      'Bahia': 'BA', 'Ceará': 'CE', 'Distrito Federal': 'DF',
      'Espírito Santo': 'ES', 'Goiás': 'GO', 'Maranhão': 'MA',
      'Mato Grosso': 'MT', 'Mato Grosso do Sul': 'MS', 'Minas Gerais': 'MG',
      'Pará': 'PA', 'Paraíba': 'PB', 'Paraná': 'PR', 'Pernambuco': 'PE',
      'Piauí': 'PI', 'Rio de Janeiro': 'RJ', 'Rio Grande do Norte': 'RN',
      'Rio Grande do Sul': 'RS', 'Rondônia': 'RO', 'Roraima': 'RR',
      'Santa Catarina': 'SC', 'São Paulo': 'SP', 'Sergipe': 'SE', 'Tocantins': 'TO',
    };
    const stateName = result.address?.state || '';
    const stateAbbr = stateMap[stateName] || stateName.substring(0, 2).toUpperCase();
    const cidade = result.address?.city || result.address?.town || '';

    setParadas(prev => prev.map((p, i) => {
      if (i !== index) return p;
      return {
        ...p,
        endereco: result.address?.road
          ? `${result.address.road}${result.address.house_number ? ', ' + result.address.house_number : ''}`
          : result.display_name.split(',')[0],
        numero: result.address?.house_number || p.numero,
        bairro: result.address?.suburb || p.bairro,
        cidade,
        estado: stateAbbr,
        lat: result.lat,
        lng: result.lon,
      };
    }));
  }, []);

  const addParada = useCallback(() => {
    if (paradas.length < 10) setParadas(prev => [...prev, emptyParada()]);
  }, [paradas.length]);

  const removeParada = useCallback((index: number) => {
    if (paradas.length > 1) setParadas(prev => prev.filter((_, i) => i !== index));
  }, [paradas.length]);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');

    try {
      // Build payload matching Machine API abrirSolicitacao spec
      const payload: Record<string, unknown> = {
        empresa_id: selectedCompany?.id,
        forma_pagamento: formaPagamento,
        partida: {
          endereco: selectedCompany?.endereco || '',
          bairro: selectedCompany?.bairro || '',
          cidade: selectedCompany?.cidade || '',
          estado: selectedCompany?.uf || 'SP',
          lat: selectedCompany?.lat || '',
          lng: selectedCompany?.lng || '',
        },
        paradas: paradas.map(p => {
          // Build endereco_parada: use road + number, avoid duplication
          let enderecoParada = p.endereco;
          if (p.numero && !enderecoParada.includes(p.numero)) {
            enderecoParada += ', ' + p.numero;
          }
          const parada: Record<string, unknown> = {
            endereco_parada: enderecoParada,
            bairro_parada: p.bairro || '',
            cidade_parada: p.cidade || '',
            estado_parada: p.estado || '',
          };
          if (p.lat) parada.lat_parada = p.lat;
          if (p.lng) parada.lng_parada = p.lng;
          if (p.complemento) parada.complemento_parada = p.complemento;
          if (p.contato) parada.nome_cliente_parada = p.contato;
          if (p.telefone) parada.telefone_cliente_parada = p.telefone;
          if (p.observacao) parada.observacao_parada = p.observacao;
          return parada;
        }),
        retorno: false,
      };

      if (categoriaId) {
        const cat = availableCategories.find(c => c.id === categoriaId);
        payload.categoria_id = Number(categoriaId);
        if (cat) payload.categoria_nome = cat.nome;
      }

      const res = await authFetch('/api/machine/rides/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || data.details || `Erro ${res.status}`);
      }

      // Success — close modal, show toast, trigger refresh
      const id = data?.response?.id || data?.id || data?.solicitacao_id;
      handleClose();
      showToast(
        id ? `Entrega solicitada com sucesso! ID: #${id}` : 'Entrega solicitada com sucesso!',
        'success'
      );
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao solicitar entrega');
      showToast(
        err instanceof Error ? err.message : 'Erro ao solicitar entrega',
        'error'
      );
    } finally {
      setSubmitting(false);
    }
  };




  const handleClose = () => {
    setStep(1);
    setError('');
    setParadas([emptyParada()]);
    setObservacao('');
    onClose();
  };

  const canProceedStep1 = paradas.every(p => p.endereco.trim().length > 0);

  if (!open) return null;

  // ─── Styles ──────────────────────────────────────────────

  const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 9999,
    background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '20px',
  };

  const modalStyle: React.CSSProperties = {
    background: 'white', borderRadius: '16px',
    width: '100%', maxWidth: '640px', maxHeight: '90vh',
    overflow: 'auto', boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
  };

  const headerStyle: React.CSSProperties = {
    padding: '20px 24px', borderBottom: '1px solid #EEEBE8',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  };

  const bodyStyle: React.CSSProperties = { padding: '24px' };

  const footerStyle: React.CSSProperties = {
    padding: '16px 24px', borderTop: '1px solid #EEEBE8',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '0.7rem', fontWeight: 700, color: '#6B7280',
    textTransform: 'uppercase', letterSpacing: '0.05em',
    marginBottom: '4px', display: 'block',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px',
    border: '1px solid #D5CEC8', borderRadius: '8px',
    fontSize: '0.82rem', background: '#FAFAF9',
    outline: 'none', transition: 'border-color 0.15s',
  };

  const stepTitles = ['', 'Pontos de Entrega', 'Revisão & Envio', 'Acompanhamento'];

  // ─── Render ──────────────────────────────────────────────

  return (
    <div style={overlayStyle} onClick={handleClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#1F2937' }}>
              Nova Entrega
            </div>
            <div style={{ fontSize: '0.72rem', color: '#9CA3AF', marginTop: '2px' }}>
              {step <= 2 ? `Etapa ${step} de 2 — ${stepTitles[step]}` : stepTitles[3]}
            </div>
          </div>
          <button
            onClick={handleClose}
            style={{
              width: '32px', height: '32px', borderRadius: '8px',
              border: 'none', background: '#F3F4F6', cursor: 'pointer',
              fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>

        {/* Step indicators */}
        {step <= 2 && (
          <div style={{ padding: '0 24px', paddingTop: '16px', display: 'flex', gap: '6px' }}>
            {[1, 2].map(s => (
              <div key={s} style={{
                flex: 1, height: '3px', borderRadius: '2px',
                background: s <= step ? ACCENT : '#E5E7EB',
                transition: 'background 0.3s',
              }} />
            ))}
          </div>
        )}

        {/* Coleta info banner */}
        {step <= 2 && (
          <div style={{
            margin: '16px 24px 0', padding: '10px 14px',
            background: '#F0FDF4', border: '1px solid #BBF7D0',
            borderRadius: '8px', fontSize: '0.72rem', color: '#166534',
            display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: ACCENT }}>COLETA</span>
            <span>
              <strong>Coleta:</strong>{' '}
              {selectedCompany?.endereco || 'Endereço da empresa'}
              {selectedCompany?.bairro ? `, ${selectedCompany.bairro}` : ''}
              {selectedCompany?.cidade ? ` — ${selectedCompany.cidade}` : ''}
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            margin: '16px 24px 0', padding: '10px 14px',
            background: '#FFF7F0', border: '1px solid #FFD6B3',
            borderRadius: '8px', fontSize: '0.78rem', color: '#E55C00',
          }}>
            {error}
          </div>
        )}

        <div style={bodyStyle}>
          {/* ─── STEP 1: Paradas ──────────────────────────── */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{
                padding: '12px 14px', borderRadius: '10px',
                background: 'rgba(229, 92, 0, 0.04)', fontSize: '0.72rem', color: '#CC5500',
              }}>
                Informe os endereços de entrega. Digite para buscar e selecione da lista.
              </div>

              {paradas.map((p, i) => (
                <div key={i} style={{
                  border: '1px solid #E5E7EB', borderRadius: '12px',
                  padding: '14px', position: 'relative',
                  background: i === 0 ? 'rgba(229, 92, 0, 0.02)' : 'white',
                }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: '10px',
                  }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      fontSize: '0.75rem', fontWeight: 700, color: '#374151',
                    }}>
                      <span style={{
                        width: '22px', height: '22px', borderRadius: '50%',
                        background: ACCENT, color: 'white',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.6rem', fontWeight: 800,
                      }}>
                        {i + 1}
                      </span>
                      Entrega {i + 1}
                    </div>
                    {paradas.length > 1 && (
                      <button
                        onClick={() => removeParada(i)}
                        style={{
                          border: 'none', background: '#FFF7F0',
                          color: '#E55C00', borderRadius: '6px',
                          padding: '4px 8px', fontSize: '0.65rem',
                          fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        Remover
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div>
                      <label style={labelStyle}>Endereço de entrega *</label>
                      <AddressInput
                        value={p.endereco}
                        onChange={val => updateParada(i, 'endereco', val)}
                        onSelect={result => handleAddressSelect(i, result)}
                        placeholder="Buscar por rua, bairro ou CEP..."
                        biasLat={selectedCompany?.lat ? Number(selectedCompany.lat) : undefined}
                        biasLng={selectedCompany?.lng ? Number(selectedCompany.lng) : undefined}
                      />
                    </div>

                    {/* Address confirmation after selection */}
                    {p.lat && (
                      <div style={{
                        padding: '8px 12px', borderRadius: '8px',
                        background: '#F0FDF4', border: '1px solid #BBF7D0',
                        fontSize: '0.72rem', color: '#166534',
                        display: 'flex', alignItems: 'center', gap: '6px',
                      }}>
                        <span style={{ fontSize: '0.85rem' }}>✓</span>
                        <span>
                          {p.endereco}{p.numero ? `, ${p.numero}` : ''}
                          {p.bairro ? `, ${p.bairro}` : ''}
                          {p.cidade ? `, ${p.cidade}` : ''}
                          {p.estado ? ` - ${p.estado}` : ''}
                        </span>
                      </div>
                    )}

                    {/* Nº + Complemento */}
                    <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '8px' }}>
                      <div>
                        <label style={labelStyle}>Nº</label>
                        <input style={inputStyle} placeholder="Nº"
                          value={p.numero}
                          onChange={e => updateParada(i, 'numero', e.target.value)}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>Complemento</label>
                        <input style={inputStyle} placeholder="Apto, bloco, sala, referência..."
                          value={p.complemento}
                          onChange={e => updateParada(i, 'complemento', e.target.value)}
                        />
                      </div>
                    </div>

                    {/* Contato + Telefone */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <div>
                        <label style={labelStyle}>Contato</label>
                        <input style={inputStyle} placeholder="Nome do destinatário"
                          value={p.contato}
                          onChange={e => updateParada(i, 'contato', e.target.value)}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>Telefone</label>
                        <input style={inputStyle} placeholder="(xx) xxxxx-xxxx"
                          value={p.telefone}
                          onChange={e => updateParada(i, 'telefone', e.target.value)}
                        />
                      </div>
                    </div>
                    <div>
                      <label style={labelStyle}>Observação para o motoboy</label>
                      <input style={inputStyle} placeholder="Ex: entregar na portaria, falar com João..."
                        value={p.observacao}
                        onChange={e => updateParada(i, 'observacao', e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              ))}

              {paradas.length < 10 && (
                <button
                  onClick={addParada}
                  style={{
                    width: '100%', padding: '12px',
                    border: '2px dashed #D1D5DB', borderRadius: '10px',
                    background: 'transparent', cursor: 'pointer',
                    fontSize: '0.78rem', fontWeight: 600, color: '#6B7280',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = ACCENT;
                    e.currentTarget.style.color = ACCENT;
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = '#D1D5DB';
                    e.currentTarget.style.color = '#6B7280';
                  }}
                >
                  + Adicionar Ponto de Entrega
                </button>
              )}

              {/* Solicitante inline */}
            </div>
          )}

          {/* ─── STEP 2: Revisão ──────────────────────────── */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Summary */}
              <div style={{
                background: '#F9FAFB', borderRadius: '12px',
                padding: '16px', border: '1px solid #E5E7EB',
              }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', marginBottom: '10px' }}>
                  Resumo da Solicitação
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.78rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#6B7280' }}>Coleta</span>
                    <span style={{ fontWeight: 600, textAlign: 'right', maxWidth: '60%' }}>
                      {selectedCompany?.endereco || 'Endereço da empresa'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#6B7280' }}>Entregas</span>
                    <span style={{ fontWeight: 600 }}>{paradas.length} ponto{paradas.length > 1 ? 's' : ''}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#6B7280' }}>Empresa</span>
                    <span style={{ fontWeight: 600 }}>{selectedCompany?.nome || '—'}</span>
                  </div>
                </div>

                {/* Paradas list */}
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #E5E7EB' }}>
                  {paradas.map((p, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '6px 0', fontSize: '0.72rem',
                    }}>
                      <span style={{
                        width: '18px', height: '18px', borderRadius: '50%',
                        background: ACCENT, color: 'white',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.55rem', fontWeight: 800, flexShrink: 0,
                      }}>
                        {i + 1}
                      </span>
                      <span>{p.endereco}{p.numero ? `, ${p.numero}` : ''}</span>
                      {p.contato && <span style={{ color: '#9CA3AF' }}>({p.contato})</span>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Estimation */}
              <div style={{
                background: estimativa ? 'rgba(22, 163, 74, 0.06)' : '#F9FAFB',
                borderRadius: '12px', padding: '14px 16px',
                border: estimativa ? '1px solid rgba(22, 163, 74, 0.2)' : '1px solid #E5E7EB',
              }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', marginBottom: '8px' }}>
                  Estimativa da Entrega
                </div>
                {estimating ? (
                  <div style={{ fontSize: '0.78rem', color: '#9CA3AF', textAlign: 'center', padding: '10px 0' }}>
                    <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite', marginRight: 6 }}>⟳</span>
                    Calculando estimativa...
                  </div>
                ) : estimativa ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                    {/* Valor */}
                    {estimativa.valor && (
                      <div style={{
                        textAlign: 'center', padding: '12px 8px',
                        background: 'rgba(229, 92, 0, 0.06)', borderRadius: '10px',
                        border: '1px solid rgba(229, 92, 0, 0.12)',
                      }}>
                        <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', marginBottom: 4 }}>
                          Valor
                        </div>
                        <div style={{ fontWeight: 800, color: ACCENT, fontSize: '1.15rem', lineHeight: 1.2 }}>
                          R$ {parseFloat(estimativa.valor).toFixed(2).replace('.', ',')}
                        </div>
                      </div>
                    )}
                    {/* Distância */}
                    {estimativa.distancia && (
                      <div style={{
                        textAlign: 'center', padding: '12px 8px',
                        background: 'rgba(59, 130, 246, 0.06)', borderRadius: '10px',
                        border: '1px solid rgba(59, 130, 246, 0.12)',
                      }}>
                        <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', marginBottom: 4 }}>
                          Distância
                        </div>
                        <div style={{ fontWeight: 800, color: '#2563EB', fontSize: '1.15rem', lineHeight: 1.2 }}>
                          {parseFloat(estimativa.distancia).toFixed(1).replace('.', ',')} km
                        </div>
                      </div>
                    )}
                    {/* Tempo */}
                    {estimativa.tempo && (
                      <div style={{
                        textAlign: 'center', padding: '12px 8px',
                        background: 'rgba(245, 158, 11, 0.06)', borderRadius: '10px',
                        border: '1px solid rgba(245, 158, 11, 0.12)',
                      }}>
                        <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', marginBottom: 4 }}>
                          Tempo Estimado
                        </div>
                        <div style={{ fontWeight: 800, color: '#D97706', fontSize: '1.15rem', lineHeight: 1.2 }}>
                          {estimativa.tempo} min
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>
                    Estimativa não disponível
                  </div>
                )}
              </div>

              {/* Category */}
              {availableCategories.length > 0 && (
                <div>
                  <label style={labelStyle}>Categoria do Condutor</label>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {availableCategories.map(cat => (
                      <button
                        key={cat.id}
                        onClick={() => setCategoriaId(cat.id)}
                        style={{
                          padding: '8px 16px', borderRadius: '8px',
                          border: categoriaId === cat.id ? `2px solid ${ACCENT}` : '1px solid #D1D5DB',
                          background: categoriaId === cat.id ? ACCENT_LIGHT : 'white',
                          color: categoriaId === cat.id ? ACCENT : '#374151',
                          fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                          transition: 'all 0.15s',
                        }}
                      >
                        {cat.nome}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Payment */}
              <div>
                <label style={labelStyle}>Forma de Pagamento</label>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {availablePayments.map(code => {
                    const info = PAYMENT_LABELS[code];
                    if (!info) return null;
                    const selected = formaPagamento === code;
                    return (
                      <button
                        key={code}
                        onClick={() => setFormaPagamento(code)}
                        style={{
                          padding: '8px 14px', borderRadius: '8px',
                          border: selected ? `2px solid ${ACCENT}` : '1px solid #D1D5DB',
                          background: selected ? ACCENT_LIGHT : 'white',
                          color: selected ? ACCENT : '#374151',
                          fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: '5px',
                          transition: 'all 0.15s',
                        }}
                      >
                        {info.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Observação */}
              <div>
                <label style={labelStyle}>Observação geral</label>
                <textarea
                  style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }}
                  placeholder="Instrução para o motoboy (opcional)"
                  value={observacao}
                  onChange={e => setObservacao(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>


        {/* Footer */}
        {step <= 2 && (
          <div style={footerStyle}>
            <button
              onClick={step === 1 ? handleClose : () => setStep(s => s - 1)}
              style={{
                padding: '10px 20px', borderRadius: '8px',
                border: '1px solid #D1D5DB', background: 'white',
                color: '#374151', fontSize: '0.78rem',
                fontWeight: 600, cursor: 'pointer',
              }}
            >
              {step === 1 ? 'Cancelar' : '← Voltar'}
            </button>

            {step < 2 ? (
              <button
                onClick={() => { fetchEstimate(); setStep(s => s + 1); }}
                disabled={!canProceedStep1}
                style={{
                  padding: '10px 24px', borderRadius: '8px',
                  border: 'none',
                  background: canProceedStep1 ? ACCENT : '#D1D5DB',
                  color: 'white', fontSize: '0.78rem',
                  fontWeight: 700, cursor: 'pointer',
                  opacity: canProceedStep1 ? 1 : 0.6,
                }}
              >
                Próximo →
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={submitting}
                style={{
                  padding: '10px 24px', borderRadius: '8px',
                  border: 'none', background: ACCENT,
                  color: 'white', fontSize: '0.82rem',
                  fontWeight: 700, cursor: 'pointer',
                  opacity: submitting ? 0.7 : 1,
                  display: 'flex', alignItems: 'center', gap: '6px',
                }}
              >
                {submitting ? 'Enviando...' : 'Solicitar Entrega'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
