'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface RouteGroup {
  rideId: string;
  points: [number, number][];  // [lat, lng] pairs: coleta then each parada
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

interface DeliveryMapInnerProps {
  markers: RideMarker[];
  routeGroups?: RouteGroup[];
  hoveredRideId?: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  A: 'Aceita',
  E: 'Em Andamento',
  F: 'Finalizada',
  G: 'Aguardando Aceite',
  P: 'Buscando Condutor',
  N: 'Não Atendida',
  C: 'Cancelada',
};

function createIcon(type: 'coleta' | 'entrega' | 'motoboy' | 'loja', badgeText?: string, isHovered?: boolean, isDimmed?: boolean) {
  const colors = {
    coleta: '#E55C00',
    entrega: '#16A34A',
    motoboy: '#2563EB',
    loja: '#7C2D12',
  };
  
  // Custom badges/initials OR fallback to SVG
  const innerContent = badgeText 
    ? `<span style="font-weight: 800; font-size: 0.65rem; color: white;">${badgeText}</span>` 
    : (() => {
      const svgIcons: Record<string, string> = {
        coleta: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
        entrega: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`,
        motoboy: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm-3 11.5V14l-3-3 4-3 2 3h2"/></svg>`,
        loja: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
      };
      return svgIcons[type];
    })();

  const baseSize = type === 'loja' ? 38 : 32;
  const size = isHovered ? baseSize + 8 : baseSize;
  const zIndex = isHovered ? 1000 : (type === 'motoboy' ? 500 : 400);

  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="
        display: flex;
        align-items: center;
        justify-content: center;
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        background: ${colors[type]};
        border: ${isHovered ? '4px' : '3px'} solid white;
        box-shadow: ${isHovered ? '0 0 15px rgba(37,99,235,0.8)' : '0 2px 8px rgba(0,0,0,0.3)'};
        cursor: pointer;
        opacity: ${isDimmed ? 0.25 : 1};
        transition: all 0.2s ease-in-out;
        z-index: ${zIndex};
      ">
        ${innerContent}
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 4)],
  });
}

export default function DeliveryMapInner({ markers, routeGroups = [], hoveredRideId }: DeliveryMapInnerProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const routeLinesRef = useRef<L.Polyline[]>([]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [-22.9068, -43.1729],
      zoom: 13,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update markers when data changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear existing markers & routes
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    routeLinesRef.current.forEach(l => l.remove());
    routeLinesRef.current = [];

    if (markers.length === 0) return;

    const bounds = L.latLngBounds([]);

    markers.forEach((m) => {
      if (isNaN(m.lat) || isNaN(m.lng)) return;

      const isHovered = hoveredRideId ? m.rideId === hoveredRideId : false;
      const isDimmed = hoveredRideId ? (m.rideId !== hoveredRideId && m.type !== 'loja') : false;

      const icon = createIcon(m.type, m.badgeText, isHovered, isDimmed);
      const marker = L.marker([m.lat, m.lng], { icon, zIndexOffset: isHovered ? 1000 : 0 }).addTo(map);

      const statusLabel = m.status ? (STATUS_LABELS[m.status] || m.status) : '';
      let popupHtml = `
        <div style="font-family: 'Inter', sans-serif; min-width: 160px;">
          <div style="font-weight: 700; font-size: 0.82rem; margin-bottom: 4px;">
            ${m.type === 'loja' ? '' : ''}${m.label}
          </div>
      `;

      if (m.type === 'loja' && m.valor) {
        popupHtml += `<div style="font-size: 0.72rem; color: #666;">${m.valor}</div>`;
      } else {
        if (m.motoboyName) {
          popupHtml += `<div style="font-size: 0.72rem; color: #666;">Motoboy: ${m.motoboyName}</div>`;
        }
        if (statusLabel) {
          popupHtml += `<div style="font-size: 0.68rem; color: #888; margin-top: 2px;">Status: ${statusLabel}</div>`;
        }
        if (m.valor && m.valor !== '0' && m.type !== 'loja') {
          popupHtml += `<div style="font-size: 0.75rem; font-weight: 700; color: #E55C00; margin-top: 4px;">R$ ${parseFloat(m.valor).toFixed(2)}</div>`;
        }
      }

      popupHtml += '</div>';
      marker.bindPopup(popupHtml);

      markersRef.current.push(marker);
      bounds.extend([m.lat, m.lng]);
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }

    // Draw routes using OSRM
    routeGroups.forEach(async (group) => {
      if (group.points.length < 2) return;
      
      const isHovered = hoveredRideId ? group.rideId === hoveredRideId : false;
      const isDimmed = hoveredRideId ? group.rideId !== hoveredRideId : false;
      const lineColor = isHovered ? '#2563EB' : (isDimmed ? '#94A3B8' : '#2563EB');
      const lineOpacity = isHovered ? 1 : (isDimmed ? 0.15 : 0.7);
      const lineWeight = isHovered ? 5 : (isDimmed ? 2 : 3);
      
      try {
        // OSRM expects lng,lat pairs separated by semicolons
        const coords = group.points.map(p => `${p[1]},${p[0]}`).join(';');
        const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        const route = data?.routes?.[0];
        if (!route?.geometry?.coordinates) return;

        // GeoJSON coordinates are [lng, lat], Leaflet needs [lat, lng]
        const latLngs: L.LatLngExpression[] = route.geometry.coordinates.map(
          (c: [number, number]) => [c[1], c[0]] as L.LatLngExpression
        );

        const polyline = L.polyline(latLngs, {
          color: lineColor,
          weight: lineWeight,
          opacity: lineOpacity,
          dashArray: isHovered ? undefined : '8, 6',
          lineCap: 'round',
        }).addTo(map);
        
        if (isHovered) polyline.bringToFront();

        routeLinesRef.current.push(polyline);
      } catch {
        // If OSRM fails, draw a straight dashed line as fallback
        const latLngs: L.LatLngExpression[] = group.points.map(
          p => [p[0], p[1]] as L.LatLngExpression
        );
        const polyline = L.polyline(latLngs, {
          color: lineColor,
          weight: isHovered ? 4 : 2,
          opacity: lineOpacity,
          dashArray: isHovered ? undefined : '6, 8',
        }).addTo(map);
        
        if (isHovered) polyline.bringToFront();
        
        routeLinesRef.current.push(polyline);
      }
    });
  }, [markers, routeGroups, hoveredRideId]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        borderRadius: 'var(--radius-lg, 12px)',
        overflow: 'hidden',
      }}
    />
  );
}
