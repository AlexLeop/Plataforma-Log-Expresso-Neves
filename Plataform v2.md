# Plataforma v2 — Independência Total da Machine API

> **Data:** Abril 2026 | **Autor:** Análise Técnica Automatizada
> **Objetivo:** Eliminar a dependência da Taxi Machine e construir um sistema próprio completo

---

## 1. Por que se Tornar Independente?

### 1.1 Problemas da Dependência Atual

| Problema | Impacto |
|----------|---------|
| **Rate limiting da Machine** | 4 req/min para créditos, 750ms throttle entre chamadas |
| **Sem controle sobre dados** | Dados de corridas, motoristas e empresas ficam na Machine |
| **API instável** | Qualquer mudança na API Machine quebra nosso sistema |
| **Custo de licença** | Pagamento mensal por empresa/condutor na plataforma deles |
| **Funcionalidades limitadas** | Não podemos adicionar features que a Machine não suporta |
| **Sem acesso offline** | Sem Machine API = sistema parado |
| **Carteira digital alheia** | Créditos dos motoboys ficam na carteira Machine |
| **Sem rastreio próprio** | Dependemos do link de rastreio da Machine |
| **Formato de dados rígido** | Campos e status definidos pela Machine, não por nós |

### 1.2 O que Usamos da Machine Hoje (16 endpoints)

| Categoria | Endpoint | O que faz | Substituição na v2 |
|-----------|----------|-----------|---------------------|
| **Empresas** | `GET /empresa` | Listar empresas | DB próprio `companies` |
| | `POST /cadastrarEmpresa` | Cadastrar empresa | CRUD próprio |
| | `PUT /atualizarEmpresas` | Atualizar empresa | CRUD próprio |
| **Motoristas** | `GET /condutor` | Listar condutores | DB próprio `drivers` |
| | `POST /condutor` | Cadastrar condutor | CRUD próprio |
| | `PUT /condutor` | Atualizar condutor | CRUD próprio |
| **Corridas** | `GET /solicitacao` | Listar corridas | DB próprio `rides` + motor de despacho |
| | `GET /solicitacaoStatus` | Status individual | Realtime via Supabase |
| | `POST /abrirSolicitacao` | Criar entrega | **Motor de despacho próprio** |
| | `POST /cancelar` | Cancelar corrida | Status update no DB |
| | `POST /estimarSolicitacao` | Estimar valor/tempo | **Motor de estimativa próprio** |
| | `GET /consultarProgramada` | Corridas agendadas | Query no DB |
| | `GET /obterLinkRastreio` | Link rastreio | **Rastreio próprio via GPS** |
| **Créditos** | `POST /saldoCreditosEmpresa` | Saldo empresa | **Carteira digital própria** |
| | `POST /saldoCreditosCondutor` | Saldo condutor | **Carteira digital própria** |
| | `POST /recarregarCreditos` | Creditar motoboy | Operação interna no DB |
| | `POST /sacarCreditos` | Debitar motoboy | Operação interna no DB |
| **Webhooks** | `POST /cadastrarWebhook` | Webhook de posição | **GPS próprio via app** |

---

## 2. Arquitetura da Plataforma v2

### 2.1 Stack Proposta

| Camada | Tecnologia | Justificativa |
|--------|------------|---------------|
| **Frontend Web** | Next.js 16 + React 19 (manter) | Já construído, manter investimento |
| **App Motoboy** | React Native / Expo | GPS, notificações push, offline-first |
| **Backend API** | Next.js API Routes + Supabase Edge Functions | Já em uso, escalar com Edge Functions |
| **Banco de Dados** | Supabase (PostgreSQL) | Já em uso, RLS, Realtime, Auth |
| **Realtime** | Supabase Realtime | Status de corridas em tempo real |
| **GPS/Rastreio** | App Motoboy → Supabase (lat/lng) | Substituir webhook Machine |
| **Mapas** | Leaflet + OSRM (roteamento) | Já temos Leaflet, adicionar routing |
| **Notificações** | Firebase Cloud Messaging (FCM) | Push para motoboy + lojista |
| **WhatsApp** | Evolution Go (manter) | Já integrado para escalas |
| **Pagamentos** | PIX via API (Gerencianet/Mercado Pago) | Substituir carteira Machine |
| **Storage** | Supabase Storage | Fotos de entrega, documentos |

### 2.2 Diagrama de Arquitetura

```
┌─────────────────────────────────────────────────────────────────────┐
│                     PLATAFORMA v2 — ARQUITETURA                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │  Web Admin   │  │  Web Lojista │  │  App Motoboy │              │
│  │  (Next.js)   │  │  (Next.js)   │  │ (React Native)│             │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │
│         │                 │                  │                      │
│         └────────────┬────┘                  │                      │
│                      │                       │                      │
│              ┌───────▼───────┐       ┌───────▼───────┐             │
│              │  API Routes   │       │  Mobile API   │             │
│              │  (Next.js)    │       │  (REST/WS)    │             │
│              └───────┬───────┘       └───────┬───────┘             │
│                      │                       │                      │
│              ┌───────▼───────────────────────▼───────┐             │
│              │           SUPABASE                     │             │
│              │  ┌─────────┐ ┌──────────┐ ┌────────┐ │             │
│              │  │PostgreSQL│ │ Realtime │ │  Auth  │ │             │
│              │  │   + RLS  │ │ (WebSocket)│ │(JWT)  │ │             │
│              │  └─────────┘ └──────────┘ └────────┘ │             │
│              │  ┌─────────┐ ┌──────────┐ ┌────────┐ │             │
│              │  │ Storage │ │Edge Funcs│ │  Cron  │ │             │
│              │  │ (fotos) │ │(WhatsApp)│ │ (jobs) │ │             │
│              │  └─────────┘ └──────────┘ └────────┘ │             │
│              └───────────────────────────────────────┘             │
│                                                                     │
│  ┌──────────────────────────────────────────────────────┐          │
│  │              SERVIÇOS EXTERNOS                        │          │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐  │          │
│  │  │  OSRM    │ │   FCM    │ │ PIX API  │ │Evolution│  │         │
│  │  │(routing) │ │ (push)   │ │(pagamento)│ │(WhatsApp)│ │         │
│  │  └──────────┘ └──────────┘ └──────────┘ └────────┘  │          │
│  └──────────────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Novos Módulos a Construir

### 3.1 🔴 Motor de Despacho (Dispatch Engine)

**O que substitui:** `abrirSolicitacao`, `cancelar`, `solicitacaoStatus`

O coração do sistema. Gerencia o ciclo de vida completo de uma entrega.

**Ciclo de vida da corrida:**
```
CRIADA → DISTRIBUINDO → ACEITA → EM_COLETA → EM_ENTREGA → FINALIZADA
                ↓            ↓                                  ↑
          NÃO_ATENDIDA   CANCELADA                         (por parada)
```

**Funcionalidades:**
- Criação de solicitação com múltiplas paradas
- Distribuição automática por proximidade (GPS do motoboy)
- Distribuição por fila (round-robin) quando sem GPS
- Timeout configurável para aceite (ex: 60s)
- Redistribuição automática se motoboy não aceitar
- Agrupamento de entregas (mesmo motoboy, mesma região)
- Corridas programadas (agendar para horário futuro)
- Cancelamento com regras (quem pode, quando, com taxa?)

**Tabelas novas:**
```sql
-- Solicitações de entrega (substitui rides da Machine)
CREATE TABLE delivery_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  driver_id UUID REFERENCES drivers(id),
  status TEXT NOT NULL DEFAULT 'created',
  payment_type TEXT DEFAULT 'F',
  estimated_value NUMERIC(10,2),
  final_value NUMERIC(10,2),
  estimated_distance_km NUMERIC(8,2),
  actual_distance_km NUMERIC(8,2),
  estimated_duration_min INTEGER,
  -- Coleta
  pickup_address TEXT NOT NULL,
  pickup_lat NUMERIC(10,7),
  pickup_lng NUMERIC(10,7),
  -- Tracking
  accepted_at TIMESTAMPTZ,
  picked_up_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  cancelled_by TEXT, -- 'company', 'driver', 'system'
  -- Metadata
  notes TEXT,
  proof_photo_url TEXT,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Paradas (múltiplas por solicitação)
CREATE TABLE delivery_stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID REFERENCES delivery_requests(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  address TEXT NOT NULL,
  neighborhood TEXT,
  city TEXT,
  state TEXT,
  lat NUMERIC(10,7),
  lng NUMERIC(10,7),
  contact_name TEXT,
  contact_phone TEXT,
  notes TEXT,
  status TEXT DEFAULT 'pending', -- pending, arrived, delivered
  arrived_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  proof_photo_url TEXT,
  recipient_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Fila de distribuição
CREATE TABLE dispatch_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID REFERENCES delivery_requests(id),
  driver_id UUID REFERENCES drivers(id),
  offered_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending', -- pending, accepted, rejected, expired
  response_at TIMESTAMPTZ
);
```

---

### 3.2 🔴 Motor de Estimativa (Pricing Engine)

**O que substitui:** `estimarSolicitacao`

**Funcionalidades:**
- Cálculo de distância via OSRM (gratuito, self-hosted)
- Precificação por km (configurável por empresa)
- Tabela de preços por faixa de distância
- Taxa fixa mínima
- Multiplicador por horário (noturno, fim de semana)
- Multiplicador por demanda (surge pricing opcional)

```typescript
interface PricingConfig {
  base_fare: number;          // R$ 5.00 taxa base
  per_km_rate: number;        // R$ 1.50 por km
  per_stop_rate: number;      // R$ 2.00 por parada adicional
  minimum_fare: number;       // R$ 7.00 mínimo
  night_multiplier: number;   // 1.3x (22h-6h)
  weekend_multiplier: number; // 1.2x (sáb/dom)
  rain_multiplier: number;    // 1.5x (opcional, manual)
}
```

---

### 3.3 🔴 App do Motoboy (Mobile)

**O que substitui:** App Machine + link de rastreio + carteira digital

**Funcionalidades essenciais:**
- Login com celular + SMS/WhatsApp OTP
- Tela de corridas disponíveis (aceitar/rejeitar)
- Navegação integrada (Google Maps/Waze deeplink)
- Botões de status: "Cheguei na coleta" → "Saí para entrega" → "Entreguei"
- Foto de comprovante de entrega
- GPS em background (enviar posição a cada 30s)
- Ver escala semanal + confirmar presença
- Extrato financeiro (diárias, extras, adiantamentos)
- Saldo da carteira digital
- Notificações push (nova corrida, escala publicada)
- Modo offline (cache local, sync quando voltar online)

**Stack mobile:**
```
React Native + Expo
├── expo-location (GPS background)
├── expo-notifications (push via FCM)
├── expo-camera (foto comprovante)
├── @supabase/supabase-js (realtime + auth)
└── react-native-maps (mapa inline)
```

---

### 3.4 🟡 Carteira Digital Própria (Wallet)

**O que substitui:** `recarregarCreditos`, `sacarCreditos`, `saldoCreditos`

```sql
CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type TEXT NOT NULL, -- 'driver' ou 'company'
  owner_id UUID NOT NULL,
  balance NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(owner_type, owner_id)
);

CREATE TABLE wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID REFERENCES wallets(id),
  type TEXT NOT NULL, -- 'credit', 'debit', 'transfer', 'pix_in', 'pix_out'
  amount NUMERIC(12,2) NOT NULL,
  balance_after NUMERIC(12,2) NOT NULL,
  description TEXT,
  reference_type TEXT, -- 'daily_rate', 'ride', 'advance', 'manual'
  reference_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Vantagens sobre Machine:**
- Sem rate limit (4 req/min → ilimitado)
- Transações instantâneas (sem esperar 16s entre operações)
- Histórico completo e auditável
- Integração futura com PIX real
- Saldo em tempo real via Supabase Realtime

---

### 3.5 🟡 Rastreio em Tempo Real

**O que substitui:** `obterLinkRastreio` + webhook de posição

```sql
CREATE TABLE driver_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID REFERENCES drivers(id),
  lat NUMERIC(10,7) NOT NULL,
  lng NUMERIC(10,7) NOT NULL,
  accuracy NUMERIC(6,2),
  speed NUMERIC(6,2),
  heading NUMERIC(6,2),
  battery_level INTEGER,
  is_online BOOLEAN DEFAULT true,
  recorded_at TIMESTAMPTZ DEFAULT now()
);

-- Índice para consulta de posição mais recente
CREATE INDEX idx_driver_pos_latest ON driver_positions(driver_id, recorded_at DESC);
```

**Fluxo:**
1. App Motoboy → envia GPS a cada 30s via Supabase Realtime
2. Dashboard → subscribe no canal `driver_positions` via WebSocket
3. Lojista → página de rastreio com mapa Leaflet atualizado em tempo real
4. Link de rastreio público → página simples com mapa (sem login)

---

### 3.6 🟢 Sistema de Notificações

```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  driver_id UUID,
  company_id UUID,
  type TEXT NOT NULL, -- 'new_ride', 'schedule', 'payment', 'alert'
  title TEXT NOT NULL,
  body TEXT,
  data JSONB,
  read BOOLEAN DEFAULT false,
  channel TEXT DEFAULT 'push', -- 'push', 'whatsapp', 'email', 'in_app'
  sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

### 3.7 🔴 Hub de Integrações — Marketplaces, Cardápios Digitais e PDVs

**Este é o maior diferencial competitivo da Plataforma v2.** Hoje, lojistas recebem pedidos de múltiplas fontes (iFood, cardápio próprio, WhatsApp, balcão) e precisam despachar motoboys manualmente para cada um. A v2 deve ser o **hub central** que recebe pedidos de qualquer origem e despacha automaticamente.

#### 3.7.1 Visão Geral — "Pedido Entrou, Motoboy Saiu"

```
┌─────────────────────────────────────────────────────────┐
│              FONTES DE PEDIDOS (Inbound)                  │
│                                                          │
│  ┌───────┐ ┌────────┐ ┌───────────┐ ┌───────────────┐  │
│  │ iFood │ │ 99Food │ │  Anota AI │ │ Delivery      │  │
│  │  API  │ │  API   │ │  Webhook  │ │ Direto API    │  │
│  └───┬───┘ └───┬────┘ └─────┬─────┘ └──────┬────────┘  │
│      │         │            │               │           │
│  ┌───┴───┐ ┌───┴────┐ ┌────┴────┐ ┌───────┴─────┐     │
│  │Saipos │ │Jota Já │ │  Nola   │ │Open Delivery│     │
│  │  PDV  │ │  API   │ │  API    │ │  (Padrão)   │     │
│  └───┬───┘ └───┬────┘ └────┬────┘ └──────┬──────┘     │
│      │         │            │             │             │
│      └─────────┴────────┬───┴─────────────┘             │
│                         │                                │
│              ┌──────────▼──────────┐                     │
│              │   ORDER GATEWAY     │                     │
│              │  (Normaliza pedido  │                     │
│              │   para formato v2)  │                     │
│              └──────────┬──────────┘                     │
│                         │                                │
│              ┌──────────▼──────────┐                     │
│              │  DISPATCH ENGINE    │                     │
│              │  (Motor de despacho │                     │
│              │   da seção 3.1)     │                     │
│              └──────────┬──────────┘                     │
│                         │                                │
│              ┌──────────▼──────────┐                     │
│              │   APP MOTOBOY       │                     │
│              │  (Aceita + Entrega) │                     │
│              └──────────┬──────────┘                     │
│                         │                                │
│              ┌──────────▼──────────┐                     │
│              │  STATUS CALLBACK    │                     │
│              │  (Devolve status    │                     │
│              │   para cada fonte)  │                     │
│              └─────────────────────┘                     │
└─────────────────────────────────────────────────────────┘
```

#### 3.7.2 Plataformas-Alvo e Tipo de Integração

| Plataforma | Tipo | API Disponível? | Modelo de Integração | Prioridade |
|------------|------|-----------------|----------------------|------------|
| **iFood** | Marketplace | ✅ (Developer Portal) | OAuth2 → Polling/Webhook de pedidos → Status callback | 🔴 Alta |
| **99Food** | Marketplace | ✅ (API Parceiro) | Similar ao iFood — receber pedido, atualizar status | 🟡 Média |
| **Anota AI** | Cardápio Digital | ✅ (API de Pedidos) | Polling a cada 30s ou Webhook → receber pedido | 🔴 Alta |
| **Nola** | Cardápio/Delivery | ✅ (já integrado no v1!) | Webhook → pedido chega, criar solicitação | 🔴 Alta |
| **Open Delivery** | Padrão Aberto | ✅ (opendelivery.com.br) | Padrão nacional — implementar uma vez, conectar em vários | 🔴 Alta |
| **Delivery Direto** | Cardápio Digital | ✅ (API parceiro) | Webhook → pedido novo → despachar | 🟡 Média |
| **Jota Já** | Marketplace | ✅ (API com token) | Token + código de loja → polling de pedidos | 🟡 Média |
| **Saipos** | PDV/Gestão | ✅ (Integrações nativas) | API/Webhook → pedido aprovado na cozinha → despachar | 🟡 Média |
| **WhatsApp** | Direto | ✅ (Evolution Go, já temos) | Bot recebe pedido → parser → criar solicitação | 🟢 Diferencial |
| **Cardápio Próprio** | White-label | ✅ (construir) | Lojista tem seu próprio link de cardápio na v2 | 🟢 Diferencial |
| **API Pública** | Desenvolvedores | ✅ (construir) | Qualquer sistema → nosso endpoint → despacho | 🟢 Diferencial |

#### 3.7.3 Arquitetura: Order Gateway

O **Order Gateway** é o módulo que normaliza pedidos de qualquer fonte para o formato interno:

```sql
-- Pedidos recebidos de fontes externas
CREATE TABLE inbound_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  -- Origem
  source TEXT NOT NULL, -- 'ifood', 'anota_ai', 'nola', 'open_delivery', 'whatsapp', 'manual', 'api'
  source_order_id TEXT,  -- ID do pedido na plataforma de origem
  source_store_id TEXT,  -- ID da loja na plataforma de origem
  -- Dados normalizados
  customer_name TEXT,
  customer_phone TEXT,
  delivery_address TEXT NOT NULL,
  delivery_lat NUMERIC(10,7),
  delivery_lng NUMERIC(10,7),
  delivery_neighborhood TEXT,
  delivery_city TEXT,
  -- Financeiro
  order_total NUMERIC(10,2),
  delivery_fee NUMERIC(10,2),
  payment_method TEXT, -- 'online', 'cash', 'card_on_delivery'
  payment_change_for NUMERIC(10,2), -- troco para (quando dinheiro)
  -- Status
  status TEXT DEFAULT 'received', -- received, dispatched, picked_up, delivered, cancelled
  -- Vinculação com motor de despacho
  delivery_request_id UUID REFERENCES delivery_requests(id),
  -- Metadata
  items_summary TEXT, -- "2x Pizza Margherita, 1x Coca 2L"
  notes TEXT,
  raw_payload JSONB, -- payload original da fonte (auditoria)
  received_at TIMESTAMPTZ DEFAULT now(),
  dispatched_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Credenciais de integração por empresa
CREATE TABLE integration_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  platform TEXT NOT NULL, -- 'ifood', 'anota_ai', 'nola', etc.
  credentials JSONB NOT NULL, -- { client_id, client_secret, token, store_id, etc. }
  is_active BOOLEAN DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  webhook_url TEXT, -- URL que a plataforma chama
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, platform)
);
```

#### 3.7.4 Fluxo por Plataforma

**iFood (Entrega Própria):**
1. Lojista configura credenciais iFood no painel da v2
2. v2 faz polling ou recebe webhook de novos pedidos
3. Pedido marcado como "entrega própria" → cria `inbound_order`
4. Order Gateway → Dispatch Engine → App Motoboy
5. Motoboy aceita → v2 envia `dispatch` para iFood
6. Motoboy finaliza → v2 envia `concluded` para iFood
7. Cliente vê status atualizado **dentro do app iFood**

**Anota AI / Cardápio Digital:**
1. Lojista ativa integração com Merchant ID + Token
2. v2 faz polling na API da Anota AI a cada 30s
3. Novo pedido → normaliza → despacha motoboy
4. Status devolvido para Anota AI via API

**Open Delivery (Padrão Nacional):**
1. Implementar interface Open Delivery **uma única vez**
2. Qualquer plataforma que suporte o padrão se conecta automaticamente
3. É o investimento com maior ROI — uma integração = múltiplas plataformas

**Nola (já integrado):**
1. Já temos `/api/nola/` no v1 — migrar para o Order Gateway
2. Webhook recebe pedido → normaliza → despacha

#### 3.7.5 Funcionalidades do Hub de Integrações

| Feature | Descrição |
|---------|-----------|
| **Painel de Integrações** | Tela onde o lojista ativa/desativa cada fonte e configura credenciais |
| **Unificação de pedidos** | Todos os pedidos (iFood, Anota AI, WhatsApp, balcão) em uma fila única |
| **Auto-despacho** | Pedido confirmado na cozinha → motoboy despachado automaticamente |
| **Status bidirecional** | Atualizar status na plataforma de origem (cliente vê no app) |
| **Impressão unificada** | Uma única comanda com origem identificada (badge "iFood", "Anota AI") |
| **Métricas por canal** | Dashboard mostrando volume, tempo médio e custo por fonte de pedido |
| **Cardápio White-Label** | Lojista ganha seu próprio link de cardápio digital (sem taxa de marketplace) |
| **API Pública** | Endpoint REST para qualquer sistema terceiro enviar pedidos |

#### 3.7.6 Por que isso Muda o Jogo

Hoje, a Expresso Neves é uma **empresa de motoboys**. Com o Hub de Integrações, ela se torna uma **plataforma de logística last-mile** — o mesmo modelo de negócio do Loggi, Lalamove e James Delivery, mas focada no nicho de entregas locais com frota própria.

**Proposta de valor para o lojista:**
> *"Você recebe pedidos no iFood, Anota AI, WhatsApp e balcão. Nós despachamos o motoboy para TODOS automaticamente, de uma única plataforma, com rastreio em tempo real."*

---

## 4. Migração: Plano de Transição

### 4.1 Estratégia: Modo Dual (6-8 semanas)

Não desligar a Machine de uma vez. Rodar ambos em paralelo:

```
Semana 1-2: Construir Motor de Despacho + Carteira Digital
Semana 3-4: Construir App Motoboy (MVP) + Rastreio
Semana 5-6: Modo Dual — corridas criadas no v2, sync com Machine
Semana 7-8: Migração completa — desligar Machine
```

### 4.2 Dados a Migrar

| Dado | Origem | Destino | Método |
|------|--------|---------|--------|
| Empresas | Machine API + Supabase | Supabase (já lá) | Nenhum — já no DB |
| Motoristas | Machine API + Supabase | Supabase (já lá) | Nenhum — já no DB |
| Corridas históricas | Machine API | Supabase `rides` | Já sincronizadas via cron |
| Saldos carteira | Machine API | Nova tabela `wallets` | Script de migração único |
| Configurações | localStorage + Supabase | Supabase only | Já em andamento |

---

## 5. O que Ganhamos (funcionalidades novas)

### Funcionalidades que a Machine NÃO oferece:

| Feature | Descrição |
|---------|-----------|
| **Foto de comprovante** | Motoboy tira foto na entrega (prova de entrega) |
| **Avaliação da entrega** | Lojista avalia motoboy (1-5 estrelas) |
| **Chat na corrida** | Mensagem entre lojista ↔ motoboy durante entrega |
| **Geofence** | Alerta quando motoboy chega no raio da coleta/entrega |
| **Rota otimizada** | Sugerir melhor ordem de paradas (TSP simplificado) |
| **Surge pricing** | Multiplicador automático por demanda |
| **Corridas recorrentes** | Agendar entregas diárias/semanais automáticas |
| **Split de pagamento** | Parte PIX, parte carteira |
| **Relatório de CO2** | Estimativa de emissão por km (ESG) |
| **API pública** | Permitir que lojistas integrem via API própria |
| **Métricas de SLA** | Tempo médio de aceite, coleta, entrega por empresa |
| **Zonas de entrega** | Definir áreas de cobertura por empresa (polígonos) |
| **Fila inteligente** | Distribuir por proximidade + rating + disponibilidade |

---

## 6. Análise de Custos

### 6.1 Custo Atual (com Machine)

| Item | Custo Mensal Estimado |
|------|----------------------|
| Licença Machine (por empresa) | R$ ???/empresa/mês |
| Taxa por corrida Machine | R$ ???/corrida |
| Vercel Pro | ~R$ 100 |
| Supabase Pro | ~R$ 130 |
| **Total estimado** | **R$ ??? + variável por volume** |

> ⚠️ **Preencha os valores da Machine** — esse é o custo que será eliminado.

### 6.2 Custo v2 (independente)

| Item | Custo Mensal |
|------|-------------|
| Vercel Pro (manter) | ~R$ 100 |
| Supabase Pro (manter) | ~R$ 130 |
| OSRM self-hosted (routing) | R$ 0 (self-hosted no Supabase Edge) ou ~R$ 50 (VPS) |
| FCM (push notifications) | R$ 0 (gratuito até 1M/mês) |
| Evolution Go (WhatsApp) | R$ 0 (já self-hosted) |
| Apple Developer (App Store) | ~R$ 50/mês (R$ 599/ano) |
| Google Play (Play Store) | R$ 130 (taxa única) |
| **Total fixo** | **~R$ 330-380/mês** |

### 6.3 ROI

- **Economia:** Eliminar toda a licença Machine
- **Receita nova:** Poder cobrar taxa de plataforma por corrida
- **Escala:** Sem limite de rate-limit da Machine para crescer

---

## 7. Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| App motoboy rejeitado nas stores | Média | Alto | Seguir guidelines, beta no TestFlight |
| Motoboys não adotarem o app | Alta | Crítico | Manter WhatsApp como fallback, onboarding presencial |
| GPS drenando bateria | Média | Médio | Otimizar intervalo (30s ativo, 5min idle) |
| Estimativa de preço imprecisa | Média | Médio | Calibrar com dados históricos da Machine |
| Tempo de desenvolvimento extenso | Alta | Alto | MVP focado, fases incrementais |
| Supabase Realtime lento com volume | Baixa | Médio | Sharding por empresa, cleanup de posições antigas |

---

## 8. Cronograma Proposto

### Fase 1 — Fundação (Semanas 1-3)
- [ ] Novo schema do banco (delivery_requests, stops, wallets, positions)
- [ ] Motor de despacho básico (criar, aceitar, finalizar)
- [ ] Carteira digital (crédito, débito, saldo)
- [ ] API REST para o app mobile

### Fase 2 — App Motoboy MVP (Semanas 4-6)
- [ ] App React Native: login, lista de corridas, aceitar/rejeitar
- [ ] GPS background + envio de posição
- [ ] Botões de status (coleta → entrega → finalizada)
- [ ] Foto de comprovante
- [ ] Push notifications (FCM)

### Fase 3 — Rastreio + Estimativa (Semanas 7-8)
- [ ] Mapa de rastreio em tempo real (Supabase Realtime)
- [ ] Link de rastreio público para o lojista
- [ ] Motor de estimativa de preço (OSRM + config por empresa)
- [ ] Distribuição automática por proximidade

### Fase 4 — Modo Dual + Migração (Semanas 9-10)
- [ ] Rodar v2 em paralelo com Machine
- [ ] Migrar saldos de carteira
- [ ] Testes com empresas piloto
- [ ] Desligar Machine

### Fase 5 — Polimento (Semanas 11-12)
- [ ] Avaliações e métricas de SLA
- [ ] Zonas de entrega (geofence)
- [ ] Correções pós-migração
- [ ] Publicar app nas stores

---

## 9. Decisão: Fazer ou Não?

### ✅ FAZER SE:
- O custo da Machine é significativo (> R$ 500/mês)
- Você planeja escalar para 20+ empresas
- Precisa de funcionalidades que a Machine não oferece (foto, rastreio próprio, API)
- Quer controle total sobre os dados e a experiência do motoboy

### ❌ NÃO FAZER SE:
- O custo da Machine é baixo e aceitável
- O volume atual é pequeno (< 5 empresas)
- Não tem equipe/tempo para manter um app mobile
- A Machine vai lançar features que você precisa

### 🟡 FAZER PARCIAL (recomendação intermediária):
- Construir a **Carteira Digital própria** (elimina rate limit)
- Construir o **Rastreio próprio** (elimina webhook)
- Manter a Machine apenas para **despacho de corridas**
- Migrar para independência total quando o volume justificar

---

## 10. Perguntas para Decisão

1. **Qual o custo mensal atual da Machine?** (licença + taxa por corrida)
2. **Quantas empresas e motoboys ativos vocês têm hoje?**
3. **Qual a projeção de crescimento para os próximos 6 meses?**
4. **Vocês têm capacidade de fazer onboarding presencial** do app com os motoboys?
5. **Os motoboys usam smartphones com Android recente** (>= Android 10)?
6. **Existe contrato de fidelidade com a Machine?** Multa por cancelamento?
7. **Quer começar pela abordagem parcial** (carteira + rastreio) ou ir direto para independência total?

---

## 11. O que Ainda Falta — Gaps não Cobertos

Além de tudo que já foi documentado, os seguintes módulos tornariam o sistema **completo como plataforma comercial**:

### 11.1 Módulos Operacionais Faltantes

| Módulo | Descrição | Por que é Crítico |
|--------|-----------|-------------------|
| **Prova de Entrega (POD)** | Foto + assinatura digital + nome do recebedor | Disputas jurídicas, chargeback, comprovação para o lojista |
| **Chat na Corrida** | Mensagem em tempo real entre lojista ↔ motoboy ↔ cliente | Reduz ligações, melhora comunicação sobre endereço |
| **Sistema de Avaliações** | Rating 1-5 estrelas do motoboy pelo lojista e vice-versa | Controle de qualidade, ranking para distribuição |
| **Zonas de Cobertura** | Polígonos geográficos definindo área de atendimento por empresa | Evitar aceitar pedidos fora do raio operacional |
| **Rota Otimizada (TSP)** | Sugestão automática da melhor ordem de paradas | Economia de combustível, tempo e km |
| **Agrupamento Inteligente** | Agrupar 2-3 entregas do mesmo bairro para o mesmo motoboy | Reduz custo por entrega, aumenta eficiência |
| **Modo Chuva/Demanda** | Multiplicador de tarifa automático por condição climática ou alta demanda | Atrair motoboys em horários difíceis |
| **Corridas Recorrentes** | Agendamento automático diário/semanal para clientes fixos | Farmácias, escritórios, assinaturas |
| **SLA Dashboard** | Tempo médio de aceite, coleta e entrega por empresa/motoboy | Gestão de performance operacional |
| **Gestão de Documentos** | Upload de CNH, CRLV, certidões do motoboy com validade | Compliance e fiscalização |
| **Controle de Veículos** | Cadastro de moto/bicicleta com placa, ano, modelo | Relatórios, seguro, manutenção |
| **Central de Ocorrências** | Registro de problemas (acidente, roubo, produto danificado) | Auditoria, seguro, resolução de conflitos |

### 11.2 Módulos Financeiros Faltantes

| Módulo | Descrição | Por que é Crítico |
|--------|-----------|-------------------|
| **Split de Pagamento** | Parte PIX, parte carteira, parte dinheiro na entrega | Flexibilidade para o lojista |
| **Conciliação Automática** | Cruzar créditos Machine/carteira com extratos bancários | Fechar o caixa sem planilha manual |
| **NFSe Automática** | Emissão de nota fiscal de serviço por corrida ou consolidado | Obrigação tributária, formalização |
| **Antecipação de Recebíveis** | Motoboy pedir adiantamento do saldo com desconto | Retenção de motoboys, fluxo de caixa |
| **Relatório Fiscal** | Consolidação mensal para contador (receita, despesas, comissões) | Contabilidade obrigatória |
| **PIX Automático** | Pagamento real via PIX no fechamento semanal | Eliminar transferência manual |

### 11.3 Módulos de Experiência do Cliente

| Módulo | Descrição | Por que é Crítico |
|--------|-----------|-------------------|
| **Página de Rastreio Pública** | Link enviado ao cliente final mostrando mapa + ETA | Reduz ligações "cadê meu pedido?" |
| **Notificação ao Cliente** | SMS/WhatsApp avisando "saiu para entrega" e "entregue" | Experiência premium do cliente final |
| **Portal do Lojista** | Dashboard self-service onde o lojista acompanha tudo sozinho | Escalar sem aumentar equipe de suporte |
| **API Pública Documentada** | Swagger/OpenAPI para integradores terceiros | Expandir para novos mercados sem código |
| **Widget Embeddable** | Botão "Solicitar Entrega" que o lojista coloca no site dele | Canal de vendas adicional |

---

## 12. Soluções Open Source Prontas — Análise de Viabilidade

### 12.1 Panorama Geral

Existem **3 soluções open source maduras** que cobrem partes significativas do que precisamos. A estratégia mais inteligente é **não reinventar a roda** — pegar o que já funciona e adaptar ao nosso domínio.

### 12.2 🏆 Fleetbase — O Candidato #1 (Análise Corrigida)

| Aspecto | Detalhe |
|---------|---------|
| **O que é** | Sistema operacional de logística modular (LSOS) |
| **Licença** | **MIT** (totalmente livre para uso comercial) |
| **GitHub** | [github.com/fleetbase/fleetbase](https://github.com/fleetbase/fleetbase) |
| **Stack** | Laravel (PHP) + Ember.js + MySQL + Redis + Socket.IO |
| **Deploy** | Docker / AWS / Self-hosted |
| **Extensões** | FleetOps, Storefront, Pallet (WMS), Ledger (financeiro), Customer Portal, Navigator (app) |

> **CORREÇÃO:** Na análise anterior eu subestimei o Fleetbase. Após pesquisa profunda, ele possui extensões de **financeiro (Ledger)**, **marketplace (Storefront)**, **portal do cliente** e **invoices** que cobrem muito mais do que os 60% inicialmente estimados.

#### Auditoria Feature-by-Feature: Fleetbase vs. Requisitos do Plataform v2

**LEGENDA:** ✅ Pronto | 🔧 Precisa customizar | ❌ Construir do zero

##### Módulos Operacionais (Seções 3.1 a 3.6 + 11.1)

| # | Requisito v2 | Fleetbase | Notas |
|---|-------------|-----------|-------|
| 1 | Motor de Despacho | ✅ | FleetOps — dispatch engine completo |
| 2 | Múltiplas paradas por corrida | ✅ | Payloads com waypoints |
| 3 | Distribuição por proximidade (GPS) | ✅ | Auto-assign por localização |
| 4 | Timeout + redistribuição | ✅ | Regras de dispatch configuráveis |
| 5 | Corridas programadas/agendadas | ✅ | Scheduling nativo |
| 6 | App Motoboy (Navigator) | ✅ | React Native, open source |
| 7 | GPS background no app | ✅ | Tracking em tempo real |
| 8 | Botões de status (coleta→entrega) | ✅ | Check-in por waypoint |
| 9 | Foto de comprovante (POD) | ✅ | Foto + assinatura + QR code |
| 10 | Rastreio em tempo real | ✅ | WebSocket + mapa interativo |
| 11 | Link de rastreio público | ✅ | Customer Portal |
| 12 | Geofencing / Zonas de cobertura | ✅ | Service Zones configuráveis |
| 13 | Rota otimizada | ✅ | Route optimization integrado |
| 14 | Chat dispatch ↔ motoboy | ✅ | In-app messaging no Navigator |
| 15 | Gestão de veículos | ✅ | Fleet management (placa, modelo, etc) |
| 16 | Reporte de problemas/ocorrências | ✅ | Issue reporting no Navigator |
| 17 | Gestão de documentos do motorista | ✅ | Driver profile com uploads |
| 18 | SLA Dashboard / Métricas | ✅ | Analytics + reporting built-in |
| 19 | Notificações push | ✅ | FCM integrado |
| 20 | API REST documentada | ✅ | OpenAPI / Swagger |
| 21 | Webhooks para integrações | ✅ | Event-driven webhooks |
| 22 | Multi-tenant / IAM | ✅ | Roles, permissions, orgs |
| 23 | Agrupamento inteligente de entregas | 🔧 | Possível via custom workflows |
| 24 | Corridas recorrentes | 🔧 | Via scheduling + API custom |
| 25 | Modo chuva/demanda (surge) | ❌ | Não tem nativamente |
| 26 | Avaliações/Rating motoboy | ❌ | Não tem sistema de review |

##### Módulos Financeiros (Seções 3.4 + 11.2)

| # | Requisito v2 | Fleetbase | Notas |
|---|-------------|-----------|-------|
| 27 | Carteira digital (wallet) | 🔧 | Ledger extension + Stripe |
| 28 | Crédito/Débito motoboy | 🔧 | Via Ledger, precisa customizar |
| 29 | Motor de cálculo (WeeklyRulesEngine) | ❌ | **Nosso diferencial** — não existe igual |
| 30 | Diárias/Extras/Adiantamentos | ❌ | Específico do nosso domínio |
| 31 | Escalas semanais + WhatsApp | ❌ | Nosso fluxo único |
| 32 | Auto-crédito / Auto-noshow | ❌ | Crons específicos nossos |
| 33 | Snapshots financeiros (fechamento) | ❌ | Nosso fluxo de liquidação |
| 34 | Motor de estimativa de preço | 🔧 | Possível via extension de pricing |
| 35 | Invoices / Faturamento | ✅ | Customer Portal com invoices |
| 36 | Pagamentos (Stripe) | ✅ | Integração nativa |
| 37 | Relatórios financeiros | 🔧 | Reporting existe, precisa adaptar |
| 38 | NFSe automática | ❌ | Específico do Brasil |
| 39 | PIX automático | ❌ | Específico do Brasil |
| 40 | Split de pagamento | ❌ | Não nativo |
| 41 | Conciliação bancária | ❌ | Não nativo |

##### Módulos de Integração (Seção 3.7)

| # | Requisito v2 | Fleetbase | Notas |
|---|-------------|-----------|-------|
| 42 | Hub de integrações (Order Gateway) | 🔧 | Webhooks + API permitem construir |
| 43 | Integração iFood | ❌ | Construir connector |
| 44 | Integração Anota AI | ❌ | Construir connector |
| 45 | Integração Nola | ❌ | Construir connector |
| 46 | Integração Open Delivery | ❌ | Construir connector |
| 47 | Cardápio White-Label | ✅ | **Storefront extension** |
| 48 | Widget embeddable | 🔧 | Via Storefront SDK |

##### Experiência do Cliente (Seção 11.3)

| # | Requisito v2 | Fleetbase | Notas |
|---|-------------|-----------|-------|
| 49 | Portal do Lojista | ✅ | **Customer Portal extension** |
| 50 | Rastreio público | ✅ | Live tracking page |
| 51 | Notificação ao cliente | 🔧 | Webhooks → WhatsApp/SMS |
| 52 | API pública documentada | ✅ | Swagger/OpenAPI |
| 53 | Histórico de corridas por empresa | ✅ | Reporting + Order history |

#### Resultado da Auditoria

| Categoria | ✅ Pronto | 🔧 Customizar | ❌ Construir | Total |
|-----------|-----------|---------------|-------------|-------|
| Operacional (1-26) | **22** | 2 | 2 | 26 |
| Financeiro (27-41) | **3** | 4 | 8 | 15 |
| Integração (42-48) | **1** | 2 | 4 | 7 |
| Experiência (49-53) | **4** | 1 | 0 | 5 |
| **TOTAL** | **30 (57%)** | **9 (17%)** | **14 (26%)** | **53** |

#### Cobertura Real: **74%** (pronto + customizável)

- **30 features prontas** (57%) — usar direto
- **9 features customizáveis** (17%) — adaptar com código
- **14 features a construir** (26%) — todas são do domínio financeiro brasileiro ou integrações BR

#### O que NÃO existe em NENHUMA plataforma open source do mundo:

Os 14 itens que precisam ser construídos são **100% específicos do modelo de negócio brasileiro de motoboys**:
- Motor de cálculo de diárias/extras/adiantamentos (WeeklyRulesEngine)
- Escalas semanais com confirmação via WhatsApp
- Auto-crédito e auto-noshow por cron
- Fechamento semanal (snapshot) com liquidação
- Integração com marketplaces BR (iFood, Anota AI, Nola)
- NFSe e PIX automático

**Nenhum** sistema open source terá isso pronto, porque é um nicho muito específico. O Fleetbase é a melhor base porque nos dá toda a infraestrutura operacional e podemos construir a camada financeira BR como extensão.

---

### 12.3 Enatega — Plataforma de Food Delivery

| Aspecto | Detalhe |
|---------|---------|
| **O que é** | Clone de iFood/Uber Eats multi-vendor |
| **Licença** | Frontend: Open Source / **Backend: Proprietário** ⚠️ |
| **GitHub** | [github.com/enatega](https://github.com/enatega) |
| **Stack** | React Native + Expo + Node.js + MongoDB + GraphQL |

**O que o Enatega oferece:**
- ✅ App Cliente (React Native)
- ✅ App Rider/Entregador (React Native + Expo)
- ✅ Admin Dashboard (React)
- ✅ Wallet para riders
- ✅ Chat em tempo real
- ✅ Multi-vendor com comissões
- ✅ Pagamentos (Stripe/PayPal)
- ✅ Avaliações e reviews

**⚠️ Problemas:**
- **Backend proprietário** — precisa de licença paga (~USD 3.000+)
- Focado em **food delivery com cardápio** — não em logística de motoboys
- Stack diferente (MongoDB + GraphQL) da nossa (PostgreSQL + REST)
- Não tem motor financeiro de diárias/extras

**Veredicto:** **Não recomendado como base.** O backend pago e a stack incompatível tornam a migração mais cara do que construir do zero. Mas o **app Rider (React Native/Expo)** pode servir como referência de UX.

---

### 12.4 Traccar — Rastreamento GPS Open Source

| Aspecto | Detalhe |
|---------|---------|
| **O que é** | Sistema de rastreamento GPS com 200+ protocolos |
| **Licença** | **Apache 2.0** (livre para uso comercial) |
| **GitHub** | [github.com/traccar/traccar](https://github.com/traccar/traccar) |
| **Stack** | Java (server) + React (web) + React Native (mobile) |

**O que o Traccar oferece:**
- ✅ Rastreio em tempo real de 2000+ dispositivos
- ✅ Geofencing com alertas
- ✅ Histórico de rotas completo
- ✅ App mobile que transforma celular em tracker
- ✅ API REST completa
- ✅ Relatórios de velocidade, paradas, km
- ✅ Alertas configuráveis (velocidade, geofence, bateria)
- ✅ Self-hosted com Docker

**Para nosso caso:** Podemos usar o Traccar **apenas como engine de rastreio** — o app do motoboy envia GPS para o Traccar, e nosso frontend consome a API REST do Traccar para exibir no mapa. Isso é mais robusto do que construir rastreio do zero.

**Veredicto:** **Excelente complemento.** Usar como serviço de GPS/rastreio por trás do nosso app, sem que o lojista/motoboy saiba que é Traccar.

---

### 12.5 OSRM — Motor de Rotas Open Source

| Aspecto | Detalhe |
|---------|---------|
| **O que é** | Motor de roteamento baseado em OpenStreetMap |
| **Licença** | **BSD 2-Clause** (livre) |
| **GitHub** | [github.com/Project-OSRM/osrm-backend](https://github.com/Project-OSRM/osrm-backend) |

**O que oferece:**
- ✅ Cálculo de rota mais rápida entre dois pontos
- ✅ Estimativa de tempo e distância
- ✅ Otimização de múltiplas paradas (TSP — Trip optimization)
- ✅ Suporte a perfis: carro, bicicleta, moto, a pé
- ✅ API HTTP simples (JSON)
- ✅ Self-hosted com Docker (~2GB RAM para mapa do Brasil)

**Para nosso caso:** Substitui o `estimarSolicitacao` da Machine e alimenta o Pricing Engine com distância/tempo reais.

**Veredicto:** **Obrigatório para a v2.** Sem OSRM, não temos como estimar preços de forma independente.

---

### 12.6 Comparativo: Build vs. Adopt

| Módulo | Construir do Zero | Usar Open Source | Recomendação |
|--------|-------------------|------------------|--------------|
| **Motor de Despacho** | 3-4 semanas | Fleetbase (0 semanas) | 🟢 **Fleetbase** |
| **App Motoboy** | 4-6 semanas | Fleetbase Navigator (0 semanas) | 🟢 **Fleetbase** |
| **Rastreio GPS** | 2-3 semanas | Traccar (1 semana setup) | 🟢 **Traccar** |
| **Roteamento/Estimativa** | 2 semanas | OSRM (1 dia setup) | 🟢 **OSRM** |
| **Prova de Entrega** | 1-2 semanas | Fleetbase (0 semanas) | 🟢 **Fleetbase** |
| **Geofencing** | 2 semanas | Fleetbase ou Traccar | 🟢 **Open Source** |
| **Motor Financeiro** | Já temos! | N/A | 🔵 **Manter nosso** |
| **Escalas + WhatsApp** | Já temos! | N/A | 🔵 **Manter nosso** |
| **Hub de Integrações** | 4-6 semanas | Nenhum pronto para BR | 🔴 **Construir** |
| **Carteira Digital** | 2 semanas | Nenhum adequado | 🔴 **Construir** |
| **Cardápio White-Label** | 3-4 semanas | Fleetbase Storefront | 🟡 **Avaliar** |
| **NFSe/Fiscal** | 2-3 semanas | Nenhum | 🔴 **Construir** |

### 12.7 🎯 Estratégia Recomendada: Arquitetura Híbrida

```
┌─────────────────────────────────────────────────────────┐
│                PLATAFORMA v2 HÍBRIDA                     │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │              CAMADA PRÓPRIA (Next.js)               │  │
│  │  • Motor Financeiro (WeeklyRulesEngine)             │  │
│  │  • Escalas + WhatsApp (Evolution Go)                │  │
│  │  • Hub de Integrações (iFood, Anota AI, Nola...)    │  │
│  │  • Carteira Digital                                 │  │
│  │  • Dashboard Financeiro + Relatórios                │  │
│  │  • Portal do Lojista                                │  │
│  │  • Auth + RBAC + Multi-tenant                       │  │
│  └────────────────────┬───────────────────────────────┘  │
│                       │ API calls                        │
│  ┌────────────────────▼───────────────────────────────┐  │
│  │              CAMADA OPEN SOURCE                     │  │
│  │                                                     │  │
│  │  ┌──────────────┐ ┌──────────┐ ┌──────────┐       │  │
│  │  │  Fleetbase   │ │ Traccar  │ │   OSRM   │       │  │
│  │  │  (Despacho,  │ │  (GPS,   │ │ (Rotas,  │       │  │
│  │  │   App Moto,  │ │ Rastreio,│ │ Distância│       │  │
│  │  │   POD, Zonas)│ │ Geofence)│ │ Tempo)   │       │  │
│  │  └──────────────┘ └──────────┘ └──────────┘       │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │              INFRAESTRUTURA                         │  │
│  │  Supabase (DB + Auth + Realtime + Storage + Edge)   │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Com essa abordagem:**
- ⏱️ Economia de **8-12 semanas** de desenvolvimento
- 💰 Custo de infra: apenas hosting dos containers Docker (~R$ 100-200/mês a mais)
- 🔒 Controle total: tudo self-hosted, sem dependência de SaaS externo
- 🧩 Modular: pode trocar qualquer peça open source no futuro
- 🇧🇷 Diferencial brasileiro: camada financeira + integrações BR são únicas

---

## 13. Perguntas Adicionais para Decisão

8. **Fleetbase como base operacional** — quer que eu faça um POC (prova de conceito) integrando o Fleetbase com nosso motor financeiro?
9. **Traccar** — vocês já possuem alguma solução de GPS/rastreio além do link da Machine?
10. **Prova de Entrega (foto)** — os lojistas já pedem isso? É um requisito ou diferencial?
11. **NFSe** — vocês emitem nota fiscal hoje? Manual ou automatizado?
12. **Cardápio White-Label** — os lojistas querem ter seu próprio cardápio digital SEM pagar taxa de marketplace?
13. **Budget de infraestrutura** — quanto podem investir em servidores adicionais (VPS para Fleetbase + Traccar + OSRM)?
