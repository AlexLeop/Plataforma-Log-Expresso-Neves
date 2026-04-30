'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { authFetch } from '@/app/lib/api-client';

// Dynamically import map to avoid SSR issues with Leaflet
const MapInner = dynamic(
  () => import('./DeliveryMapInner') as Promise<{ default: React.ComponentType<{ markers: RideMarker[]; routeGroups?: RouteGroup[]; hoveredRideId?: string | null }> }>,
  {
    ssr: false,
    loading: () => (
      <div style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#F5F3F0',
        borderRadius: 'var(--radius-lg)',
        color: 'var(--color-text-muted)',
        fontSize: '0.82rem',
      }}>
        Carregando mapa…
      </div>
    ),
  }
);

interface DriverPosition {
  condutor_id: string;
  id_mch: string;
  lat: number;
  lng: number;
  updated_at: number;
}

interface RideMarker {
  type: 'coleta' | 'entrega' | 'motoboy' | 'loja';
  lat: number;
  lng: number;
  label: string;
  rideId?: string;
  motoboyName?: string;
  badgeText?: string;
  status?: string;
  valor?: string;
}

interface RouteGroup {
  rideId: string;
  points: [number, number][];  // [lat, lng]
}

interface DeliveryMapProps {
  rides?: Array<{
    id?: string;
    coleta?: { lat?: string; lng?: string; endereco?: string };
    partida?: { lat?: string; lng?: string; endereco?: string };
    paradas?: Array<{ endereco?: string; lat?: string; lng?: string }>;
    nome_condutor?: string;
    status_solicitacao?: string;
    valor_corrida?: string | number;
    condutor_id?: string | number;
  }>;
  storeLocation?: { lat: string; lng: string; nome: string; endereco?: string };
  hoveredRideId?: string | null;
}

export default function DeliveryMap({ rides = [], storeLocation, hoveredRideId }: DeliveryMapProps) {
  const [positions, setPositions] = useState<DriverPosition[]>([]);

  // Subscribe to live driver positions via Supabase Realtime
  // Data flow: Machine webhook → Supabase driver_positions → Realtime → here
  // NO polling required — eliminates auto-DDoS risk
  useEffect(() => {
    let mounted = true;

    // Initial load from Supabase driver_positions table (via API)
    async function loadPositions() {
      try {
        const res = await authFetch('/api/db/positions');
        if (res.ok && mounted) {
          const data = await res.json();
          setPositions((data.positions || []).map((p: { machine_condutor_id: string; latitude: number; longitude: number; received_at: string }) => ({
            condutor_id: p.machine_condutor_id,
            id_mch: p.machine_condutor_id,
            lat: Number(p.latitude),
            lng: Number(p.longitude),
            updated_at: new Date(p.received_at).getTime(),
          })));
        }
      } catch {
        // silent fail — Realtime will take over
      }
    }

    loadPositions();

    // Supabase Realtime subscription for live updates
    // Uses dynamic import to avoid SSR issues with the browser client
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let channel: any = null;

    async function setupRealtime() {
      try {
        const { getRealtimeClient } = await import('@/lib/supabase/browser-singleton');
        const supabase = getRealtimeClient();
        if (!supabase) return;

        channel = supabase
          .channel('driver-positions-map')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'driver_positions' },
            (payload) => {
              if (!mounted) return;
              // On any change, update the matching position in state
              const newRecord = payload.new as {
                machine_condutor_id?: string;
                latitude?: number;
                longitude?: number;
                speed?: number;
                heading?: number;
                received_at?: string;
              };
              if (newRecord?.machine_condutor_id && newRecord?.latitude && newRecord?.longitude) {
                setPositions(prev => {
                  const updated = prev.filter(p => p.condutor_id !== newRecord.machine_condutor_id);
                  updated.push({
                    condutor_id: newRecord.machine_condutor_id!,
                    id_mch: newRecord.machine_condutor_id!,
                    lat: Number(newRecord.latitude),
                    lng: Number(newRecord.longitude),
                    updated_at: Date.now(),
                  });
                  return updated;
                });
              }
            }
          )
          .subscribe();
      } catch (err) {
        console.warn('[DeliveryMap] Realtime setup failed, falling back to static:', err);
      }
    }

    setupRealtime();

    return () => {
      mounted = false;
      if (channel) {
        channel.unsubscribe?.();
      }
    };
  }, []);

  // Build markers from rides + positions
  const markers: RideMarker[] = [];

  // Add ride markers (coleta/partida and entregas)
  rides.forEach((ride) => {
    // Machine API uses "partida"; our interface also has "coleta" for backwards compat
    const pickup = ride.coleta || ride.partida;
    if (pickup?.lat && pickup?.lng) {
      markers.push({
        type: 'coleta',
        lat: parseFloat(pickup.lat),
        lng: parseFloat(pickup.lng),
        label: pickup.endereco || 'Ponto de Coleta',
        rideId: ride.id,
        motoboyName: ride.nome_condutor,
        badgeText: ride.id ? `OS ${ride.id}` : 'Col',
        status: ride.status_solicitacao,
        valor: String(ride.valor_corrida || ''),
      });
    }

    // Add entrega (delivery) markers for each parada with coordinates
    ride.paradas?.forEach((parada, i) => {
      if (parada.lat && parada.lng) {
        markers.push({
          type: 'entrega',
          lat: parseFloat(parada.lat),
          lng: parseFloat(parada.lng),
          label: parada.endereco || `Entrega ${i + 1}`,
          rideId: ride.id,
          badgeText: `${i + 1}`,
          status: ride.status_solicitacao,
        });
      }
    });
  });

  // Add driver positions from webhook
  positions.forEach((pos) => {
    const matchingRide = rides.find(
      (r) => String(r.condutor_id) === pos.condutor_id
    );

    const initials = matchingRide?.nome_condutor 
      ? matchingRide.nome_condutor.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()
      : pos.condutor_id;

    markers.push({
      type: 'motoboy',
      lat: pos.lat,
      lng: pos.lng,
      label: matchingRide?.nome_condutor || `Motoboy #${pos.condutor_id}`,
      motoboyName: matchingRide?.nome_condutor,
      badgeText: initials,
      rideId: matchingRide?.id,
      status: matchingRide?.status_solicitacao,
    });
  });

  // Add store location as a default marker (always visible)
  if (storeLocation && storeLocation.lat && storeLocation.lng) {
    const lat = parseFloat(storeLocation.lat);
    const lng = parseFloat(storeLocation.lng);
    if (!isNaN(lat) && !isNaN(lng)) {
      markers.push({
        type: 'loja',
        lat,
        lng,
        label: storeLocation.nome || 'Loja',
        valor: storeLocation.endereco || '',
      });
    }
  }

  // Build route groups for polylines (coleta -> paradas for each ride)
  const routeGroups: RouteGroup[] = [];
  rides.forEach((ride) => {
    const pickup = ride.coleta || ride.partida;
    if (!pickup?.lat || !pickup?.lng) return;
    const pickupLat = parseFloat(pickup.lat);
    const pickupLng = parseFloat(pickup.lng);
    if (isNaN(pickupLat) || isNaN(pickupLng)) return;

    const points: [number, number][] = [[pickupLat, pickupLng]];
    ride.paradas?.forEach((p) => {
      if (p.lat && p.lng) {
        const lat = parseFloat(p.lat);
        const lng = parseFloat(p.lng);
        if (!isNaN(lat) && !isNaN(lng)) points.push([lat, lng]);
      }
    });

    if (points.length >= 2) {
      routeGroups.push({ rideId: ride.id || '', points });
    }
  });

  return (
    <div style={{ height: '100%', minHeight: '400px', position: 'relative' }}>
      <MapInner markers={markers} routeGroups={routeGroups} hoveredRideId={hoveredRideId} />

      {/* Legend */}
      <div style={{
        position: 'absolute',
        bottom: '12px',
        left: '12px',
        background: 'rgba(255,255,255,0.95)',
        borderRadius: '8px',
        padding: '8px 12px',
        fontSize: '0.65rem',
        display: 'flex',
        gap: '12px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        zIndex: 1000,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#7C2D12' }} />
          Loja
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#2563EB' }} />
          Motoboy
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#E55C00' }} />
          Coleta
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#16A34A' }} />
          Entrega
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '16px', height: '0', borderTop: '2px dashed #2563EB' }} />
          Rota
        </div>
      </div>

      {/* Connection status */}
      <div style={{
        position: 'absolute',
        top: '12px',
        right: '12px',
        background: positions.length > 0
          ? 'rgba(22, 163, 74, 0.9)'
          : 'rgba(59, 130, 246, 0.85)',
        color: 'white',
        borderRadius: '6px',
        padding: '4px 10px',
        fontSize: '0.6rem',
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        zIndex: 1000,
      }}>
        <span style={{
          width: '5px',
          height: '5px',
          borderRadius: '50%',
          background: 'white',
          animation: 'pulse 2s infinite',
        }} />
        {positions.length > 0
          ? `${positions.length} motoboy${positions.length > 1 ? 's' : ''} online`
          : 'Conectado • Nenhum motoboy ativo'}
      </div>
    </div>
  );
}
