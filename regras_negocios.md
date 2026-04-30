# Regras de Negócio — Plataforma SaaS de Gestão Financeira Logística

> **Versão:** 1.0 — Fase 1  
> **Data:** Abril 2026  
> **Stack:** Next.js + Supabase + Machine API (Taxi Machine)

---

## 1. Visão Geral do Domínio

A plataforma é um **sistema SaaS multi-tenant** de gestão financeira para empresas de logística que operam com motoboys (entregadores). O sistema consolida dados de corridas vindos de uma API externa (Machine/Taxi Machine), permite lançamentos manuais de diárias e extras, e gera relatórios financeiros semanais para liquidação.

### 1.1 Entidades Principais

| Entidade | Descrição |
|----------|-----------|
| **Empresa (Company)** | Loja/cliente que contrata o serviço de entregas. Cada empresa tem configurações financeiras independentes. |
| **Motoboy (Driver)** | Entregador cadastrado na Machine. Vinculado a uma ou mais empresas. |
| **Corrida (Ride)** | Solicitação de entrega sincronizada da Machine API. Cada corrida tem valor (`fare_value`), status, paradas e condutor. |
| **Lançamento Manual (ManualEntry)** | Registro financeiro criado pelo gestor: diárias, extras, missões ou adiantamentos. |
| **Snapshot Financeiro** | Fotografia consolidada dos dados financeiros de uma semana, com ciclo de vida controlado. |
| **Configuração por Empresa (CompanyConfig)** | Parâmetros financeiros configuráveis por empresa: taxas, pisos, diárias. |

---

## 2. Ciclo Financeiro Semanal

### 2.1 Período de Apuração

- **Semana fiscal:** Segunda-feira a Domingo (7 dias corridos)
- **Configurável:** `week_start_day` = `"seg"`, `week_end_day` = `"sex"` (system_config)
- **Período de carência:** 24 horas após o fim da semana para corridas atrasadas (`grace_period_hours`)
- O motor de cálculo (`WeeklyRulesEngine`) opera apenas sobre **dias úteis (seg-sex)**, excluindo fins de semana via `isWeekend()`
- A interface do frontend exibe todos os 7 dias (incluindo sábado e domingo)

### 2.2 Fluxo Operacional

```
1. SINCRONIZAÇÃO → Corridas importadas da Machine API
2. LANÇAMENTOS   → Gestor marca presença (diárias) e registra extras/adiantamentos
3. CÁLCULO       → Motor aplica regras financeiras (dois modos simultâneos)
4. RELATÓRIO     → Consolidação visual com exportação CSV
5. SNAPSHOT      → Fotografia dos dados (Draft → Finalizado → Bloqueado)
6. CRÉDITO       → Valores creditados na carteira Machine do condutor
7. LIQUIDAÇÃO    → Empresa paga o total consolidado
```

---

## 3. Regras de Sincronização (Machine API)

### 3.1 Integração com Machine API

- **Base URL:** `https://api.taximachine.com.br`
- **Autenticação:** `api-key` (header) + `Basic Auth` (header `Authorization`)
- **Throttle:** 750ms entre chamadas para respeitar rate-limit
- **Paginação:** Máximo de 100 registros por página, até 3 páginas por empresa (`maxPages`)
- **Rate limit para créditos:** ~4 requisições/minuto (intervalo de 16 segundos entre operações)

### 3.2 Endpoints Consumidos

| Endpoint | Método | Uso |
|----------|--------|-----|
| `/api/integracao/solicitacao` | GET | Buscar corridas (filtro por empresa, data, status) |
| `/api/integracao/condutor` | GET | Buscar motoboys cadastrados |
| `/api/integracao/empresa` | GET | Buscar empresas |
| `/api/integracao/condutor` | POST/PUT | Criar/atualizar condutor |
| `/api/integracao/solicitacao` | POST | Criar solicitação |
| `/api/integracao/solicitacao/cancelar` | POST | Cancelar solicitação |
| Créditos: `recharge` / `withdraw` / `balance` | POST/GET | Operações de carteira digital |

### 3.3 Normalização de Dados

- **Valor da corrida (`fare_value`):** Utilizado **tal qual** da API Machine — sem classificação em faixas fixas
  - Valores variam de **R$ 5,00 a R$ 15,00** e são configuráveis na Machine
  - Campos fonte: `valor_corrida` ou `valor`
- **Data da corrida:** Extraída de `data_hora_finalizacao` (ou `data_hora_solicitacao` como fallback)
  - Formato Machine: `"YYYY-MM-DD HH:MM:SS"` (sem T, sem Z)
- **ID do condutor:** `condutor_id` ou `taxista_id` como fallback
- **Quantidade de entregas:** Contada pelo número de `paradas` (mínimo 1)

### 3.4 Status de Corridas

| Código | Descrição | Considerada no relatório? |
|--------|-----------|---------------------------|
| `P` | Buscando Condutor | ❌ |
| `D` | Distribuindo | ❌ |
| `G` | Aguardando Aceite | ❌ |
| `A` | Aceita | ❌ |
| `E` | Em Andamento | ❌ |
| `I` | Iniciada | ❌ |
| `S` | Em Espera | ❌ |
| `U` | Agrupada | ❌ |
| **`F`** | **Finalizada** | ✅ **Única que entra no cálculo financeiro** |
| `C` | Cancelada | ❌ |
| `N` | Não Atendida | ❌ |
| `X` | Expirada | ❌ |

### 3.5 Auto-Vinculação Driver ↔ Empresa

- **Trigger automático:** Ao inserir uma corrida (`rides`), o trigger `trg_auto_link_driver` cria automaticamente o vínculo `company_drivers` se não existir
- Regra: `ON CONFLICT (company_id, driver_id) DO NOTHING`

### 3.6 Configurações de Polling

| Parâmetro | Valor padrão | Descrição |
|-----------|--------------|-----------|
| `sync_batch_size` | 5 | Empresas processadas por ciclo |
| `sync_interval_minutes` | 5 | Intervalo entre ciclos de polling |

---

## 4. Regras de Lançamentos Manuais

### 4.1 Tipos de Lançamento

| Tipo | Código DB | Comportamento | Sinal no cálculo |
|------|-----------|---------------|-------------------|
| **Diária** | `daily_rate` | Valor base de pagamento do motoboy por dia trabalhado | ➕ Crédito |
| **Extra** | `extra` | Pagamento adicional (ex: entrega especial) | ➕ Crédito |
| **Missão** | `mission` | Pagamento por missão especial | ➕ Crédito |
| **Adiantamento** | `advance` | Vale/desconto antecipado | ➖ Débito |

### 4.2 Diárias — Regras de Preenchimento

1. **Auto-preenchimento:** Ao marcar presença na grade de lançamentos, o valor é preenchido automaticamente com o **valor padrão do dia da semana** configurado para a empresa
2. **Diferenciação por dia:**
   - Seg-Sex: Valor padrão de dias úteis (default: **R$ 60,00**)
   - Sábado: Valor diferenciado (default: **R$ 70,00**)
   - Domingo: Valor diferenciado (default: **R$ 80,00**)
   - Feriados: Valor especial (default: **R$ 80,00**)
3. **Override manual:** O gestor pode editar individualmente o valor de qualquer diária (ex: turno duplo = 2×, desconto)
   - Valores editados são marcados com flag `diariaOverride = true` e exibidos em destaque visual (cor âmbar)
4. **Unicidade:** Uma diária por motorista/dia/empresa (chave composta `driverId:date:companyId`)
5. **Persistência atual:** localStorage (bridge — migração para Supabase planejada)

### 4.3 Fonte dos Lançamentos

- `source: 'manual'` — Criado pelo gestor na interface
- `source: 'machine'` — Originado da Machine API

### 4.4 Permissões para Lançamentos

- **Criar/Editar:** Roles `admin`, `operator`, `manager`
- **Visualizar:** Todos os roles (incluindo `viewer`)
- **Escopo:** Limitado à empresa do usuário (RLS)

---

## 5. Motor de Cálculo Financeiro (Rules Engine)

### 5.1 Dois Modos de Cálculo Simultâneos

O sistema calcula **ambos os modos simultaneamente** para cada motorista/dia. A escolha de qual exibir é feita na interface pelo gestor.

#### Modo 1: Produção Padrão

```
Net Total = Diária + Excedente + Taxa de Corridas − Adiantamentos

Onde:
  Excedente = max(0, Produção Real − Diária)
  Produção Real = Σ fare_value (corridas finalizadas)
  Taxa de Corridas = Total de Entregas × Taxa por Entrega
```

#### Modo 2: Garantida Mínima

```
Net Total = Garantia + Taxa de Corridas − Adiantamentos

Onde:
  Garantia = max(Produção Total, Diária)
  Produção Total = Produção Real + Extras
  Taxa de Corridas = Total de Entregas × Taxa por Entrega
```

> **Regra central da Garantida:** O motoboy **nunca recebe menos que a diária**. Se a produção for menor que a diária, recebe a diária. Se for maior, recebe a produção.

### 5.2 Detalhamento do Cálculo Diário (por motorista)

| Campo | Fórmula |
|-------|---------|
| `total_rides` | Contagem de corridas finalizadas no dia |
| `production_value` | `Σ fare_value` de todas as corridas |
| `rides_breakdown` | Contagem agrupada por faixa de valor (ex: `{"5": 3, "7": 2, "10": 1}`) |
| `daily_rate` | Soma dos lançamentos do tipo `daily_rate` |
| `extras` | Soma dos lançamentos do tipo `extra` + `mission` |
| `guaranteed_payout` | `max(production_value + extras, daily_rate)` |
| `excess_value` | `max(0, production_value − daily_rate)` |
| `rides_fee` | `total_rides × ride_fee_per_delivery` |
| `advances` | Soma dos lançamentos do tipo `advance` |
| `net_total_producao` | `daily_rate + excess_value + rides_fee − advances` |
| `net_total_garantida` | `guaranteed_payout + rides_fee − advances` |

### 5.3 Agregação Semanal (Snapshot)

| Campo | Fórmula |
|-------|---------|
| `total_rides_fee` | `Σ rides_fee` (soma nominal de todas as taxas) |
| `total_rides_fee_applied` | `max(total_rides_fee, minimum_rides_fee_floor)` |
| `total_floor_complement` | `max(0, floor − total_rides_fee)` |
| `total_logistics_producao` | `total_net_producao + floor_complement` |
| `total_logistics_garantida` | `total_net_garantida + floor_complement` |

---

## 6. Configurações por Empresa

### 6.1 Parâmetros Configuráveis

| Parâmetro | Default | Descrição |
|-----------|---------|-----------|
| `taxaCorridaPerEntrega` | R$ 1,60 | Valor cobrado por cada entrega realizada |
| `pisoFixo` | R$ 350,00 | Piso mínimo fixo para logística semanal |
| `pisoPercentual` | 0% | Percentual sobre total de logística (0 = desativado) |
| `diaria.weekday` | R$ 60,00 | Valor padrão da diária (Seg-Sex) |
| `diaria.saturday` | R$ 70,00 | Valor padrão da diária (Sáb) |
| `diaria.sunday` | R$ 80,00 | Valor padrão da diária (Dom) |
| `diaria.holiday` | R$ 80,00 | Valor padrão da diária (Feriados) |

### 6.2 Regra do Piso Mínimo

```
Piso Efetivo = max(Piso Fixo, Piso Percentual × Total Logística)
Complemento = max(0, Piso Efetivo − Soma Taxa de Corridas)
Total a Liquidar = Total Motoboys + Complemento
```

- Se a soma das taxas de corrida for menor que o piso, o sistema **aplica um complemento** para atingir o valor mínimo
- O piso efetivo é o **maior** entre o fixo e o percentual

### 6.3 Extras por Km Excedente

| Modo | Descrição |
|------|-----------|
| `disabled` | Sem extra — cobra apenas a taxa padrão |
| `fixed` | Valor fixo extra (default: R$ 3,00) para corridas acima do km mínimo (default: 6 km) |
| `delivery_fee` | Cobra uma taxa de entrega adicional igual à `taxaCorridaPerEntrega` |

**Regra:** Corridas com `distancia_percorrida_km > minKm` geram o extra configurado.

### 6.4 Crédito Automático de Diárias

| Parâmetro | Default | Descrição |
|-----------|---------|-----------|
| `enabled` | `false` | Ativar/desativar auto-crédito por loja |
| `cutoffHour` | 6 | Hora de corte para processamento |
| `cutoffMinute` | 0 | Minuto de corte |
| `creditDescription` | `"Diária {date} - {company}"` | Template da descrição do crédito |

**Fórmula do crédito:**
```
Valor do Crédito = Diária + Extras + Missões − Adiantamentos/Vales
```

**Regras de processamento:**
1. Se `Valor > 0` → **Recarrega** carteira Machine do condutor via `recharge`
2. Se `Valor < 0` (adiantamento supera diária) → **Debita** carteira via `withdraw`
3. Se `Valor = 0` → Ignorado (sem operação)
4. **Rate limit:** 16 segundos entre cada operação de crédito

### 6.5 Status de Crédito das Diárias

| Status | Descrição |
|--------|-----------|
| `pending` | Aguardando processamento |
| `credited` | Creditado com sucesso na Machine |
| `failed` | Falha no crédito (com mensagem de erro) |
| `skipped` | Ignorado (valor zero) |

---

## 7. Snapshots Financeiros

### 7.1 Ciclo de Vida

```
Draft (Rascunho)
  ↓ Finalizar
Finalizado
  ↓ Bloquear            ↑ Reabrir
Bloqueado (Imutável)
```

| Status | Pode editar? | Pode deletar? | Pode atualizar? |
|--------|-------------|---------------|-----------------|
| `draft` | ✅ | ✅ | ✅ (sobrescreve) |
| `finalizado` | ❌ | ✅* | ❌ |
| `bloqueado` | ❌ | ❌ | ❌ |

\* Snapshots finalizados podem ser deletados mas não bloqueados

### 7.2 Regras de Criação

- **Unicidade:** Um snapshot por empresa/semana (`company_id + period_start + period_end`)
- **Atualização:** Se já existe um snapshot `draft` para a semana, ele é **sobrescrito** com os dados atuais
- **Congelamento:** Snapshots `finalized` ou `locked` **não podem ser atualizados** — são retornados "as is"
- **Dados consolidados:** Diárias, extras, taxa de corridas, adiantamentos e total líquido por motorista

### 7.3 Dados Armazenados por Motorista

```typescript
{
  driverId, driverName,
  totalDiaria,           // Soma das diárias marcadas
  totalExtras,           // Soma de extras + missões
  totalTaxaCorridas,     // entregas × taxaCorridaPerEntrega
  totalAdiantamentos,    // Soma dos adiantamentos
  totalLiquido,          // Diária + Extras + TxCorridas − Adiantamentos
  entregas,              // Total de entregas (paradas)
  corridas,              // Total de corridas finalizadas
}
```

---

## 8. Relatórios & Exportação

### 8.1 Relatório Consolidado

Dois modos de visualização alternáveis pelo gestor:

#### Modo Produção Padrão
- **Colunas diárias:** Mostra o **excedente** (taxa = produção − diária)
- **Colunas totais:** Diária | Taxa (excedente) | Tx Corridas | Adiantamentos | Total Líquido
- **Fórmula:** `Total = Diária + Taxa + Tx Corridas − Adiantamentos`

#### Modo Garantida Mínima
- **Colunas diárias:** Mostra o **valor pago** (max entre produção e diária)
- **Colunas totais:** Produção | Diária | Tx Corridas | Adiantamentos | Total Líquido
- **Fórmula:** `Total = Σ max(produção_dia, diária_dia) + Tx Corridas − Adiantamentos`
- **Toggles extras:** Ocultar/exibir coluna Diária, Tx Corridas, Entregas

### 8.2 Toggles do Relatório

| Toggle | Padrão | Efeito |
|--------|--------|--------|
| Com/Sem TAXA CORRIDAS | Com | Inclui/exclui a taxa administrativa no total |
| Produção/Garantida | Produção | Alterna entre os dois modos de cálculo |
| Com/Sem DIÁRIA (garantida) | Com | Mostra/oculta coluna de diária |
| Com/Sem TX CORRIDAS (garantida) | Com | Mostra/oculta coluna de tx corridas |
| Com/Sem ENTREGAS (garantida) | Com | Mostra/oculta contagem de entregas por dia |

### 8.3 Exportação CSV

- **Formato:** CSV com BOM UTF-8, separador `;`, números com vírgula
- **Metadados incluídos:** Nome da empresa, período, modo do relatório
- **Linha de total acumulado** ao final
- **Linha final:** "TOTAL A LIQUIDAR (LOJA)" com valor consolidado

---

## 9. Controle de Acesso (RBAC)

### 9.1 Roles de Usuário

| Role | Permissões |
|------|------------|
| `admin` | Acesso total a todas as empresas e operações |
| `manager` | Visualizar + criar/editar lançamentos da própria empresa |
| `operator` | Visualizar + criar/editar lançamentos da própria empresa |
| `viewer` | Somente visualização da própria empresa |

### 9.2 Row Level Security (RLS)

- **Admin:** Acesso completo a todas as tabelas (`get_user_role() = 'admin'`)
- **Demais roles:** Acesso filtrado por `company_id = get_user_company_id()`
- **Drivers:** Acesso via join em `company_drivers` (motorista pode estar em múltiplas empresas)
- **System config:** Leitura para todos os autenticados, escrita apenas para admin
- **Lançamentos manuais:** Inserção/edição requer role `admin`, `operator` ou `manager`

---

## 10. Modelo de Dados — Diárias Pré-Configuráveis

### 10.1 Tabela `driver_default_rates`

Permite configurar diárias pré-definidas por motorista/empresa/dia da semana:

- **Chave composta:** `(driver_id, company_id, day_of_week)` — UNIQUE
- **Dias válidos:** `seg`, `ter`, `qua`, `qui`, `sex`
- Útil para motoristas com valores de diária diferentes do padrão da empresa

---

## 11. Regras de Interface e UX

### 11.1 Contexto Global

- **Empresa selecionada:** Dropdown global que filtra todos os dados do dashboard
- **Semana ativa:** Navegação por offset (semana anterior/próxima/atual)
- **Carregamento de dados:** Empresas e motoristas carregados da Machine API na inicialização

### 11.2 Dashboard — KPIs

- Logística Total (soma de `fare_value` das corridas finalizadas)
- Total de Corridas (finalizadas)
- Motoboys Ativos (status = `A`)
- Total de Entregas (soma de paradas)
- Top 5 motoboys por produção
- Taxa de corridas por motoboy (entregas × taxa por entrega)

### 11.3 Página de Corridas

- **Filtros:** Por data (hoje/semana/tudo), status, nome do motorista
- **Abas:** Todas, Ativas, Finalizadas, Programadas
- **Detalhes expansíveis:** Timeline da corrida, endereço de coleta, paradas/entregas, metadados (veículo, placa, telefone, duração, km)

### 11.4 Página de Lançamentos

- **Grade de checkbox:** Motoristas × Dias da semana
- **Auto-preenchimento:** Marca presença → valor da diária preenchido automaticamente
- **Edição inline:** Clique no valor → edição direta com validação
- **Lançamentos extras via modal:** Tipo (extra/missão/adiantamento), valor, descrição, data

---

## 12. Logs e Auditoria

### 12.1 Sync Logs

| Campo | Descrição |
|-------|-----------|
| `sync_type` | `polling`, `webhook`, `backfill`, `manual`, `drivers` |
| `status` | `started`, `success`, `partial`, `failed` |
| `records_fetched` | Registros obtidos da API externa |
| `records_upserted` | Registros inseridos/atualizados |
| `records_skipped` | Registros ignorados (duplicados) |
| `error_message` | Mensagem de erro (se houver) |

### 12.2 Credit Log

- Registra cada operação de crédito/débito processada
- **Campos:** Data, motorista, empresa, valor, breakdown (diária/extras/adiantamentos), status (success/failed), via (cron/manual)
- Persistência atual: localStorage (migração para Supabase planejada)

---

## 13. Configurações Globais do Sistema

| Chave | Valor padrão | Descrição |
|-------|--------------|-----------|
| `week_start_day` | `"seg"` | Dia de início da semana financeira |
| `week_end_day` | `"sex"` | Dia de fim da semana financeira |
| `grace_period_hours` | `24` | Horas de carência para corridas atrasadas |
| `sync_batch_size` | `5` | Empresas por ciclo de polling |
| `sync_interval_minutes` | `5` | Intervalo entre ciclos |

---

## 14. Glossário de Termos

| Termo | Definição |
|-------|-----------|
| **Produção Real** | Soma dos valores das corridas finalizadas (`Σ fare_value`) |
| **Diária** | Valor base pago ao motoboy por dia trabalhado |
| **Excedente/Taxa** | Diferença positiva entre produção real e diária (`max(0, produção - diária)`) |
| **Garantia** | Valor mínimo garantido ao motoboy: `max(produção + extras, diária)` |
| **Taxa de Corridas** | Valor cobrado por entrega: `entregas × taxaCorridaPerEntrega` |
| **Piso Mínimo** | Valor mínimo de logística semanal cobrado da empresa |
| **Complemento de Piso** | Diferença para atingir o piso quando taxas são insuficientes |
| **Adiantamento/Vale** | Valor antecipado ao motoboy, descontado do total |
| **Total Líquido** | Valor final a pagar ao motoboy após todos os cálculos |
| **Total a Liquidar** | Valor total que a empresa deve pagar (soma de todos os motoboys + complemento de piso) |
| **Snapshot** | Fotografia consolidada dos dados financeiros de uma semana |
| **Machine** | API externa (Taxi Machine) de onde vêm as corridas e motoristas |

---

## 15. Diagrama de Fluxo Financeiro

```
┌─────────────────────────────────────────────────────────────────────┐
│                     FLUXO FINANCEIRO SEMANAL                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Machine API ──────→ Corridas Finalizadas (fare_value)              │
│                          │                                          │
│                          ▼                                          │
│  ┌─────────────────────────────────────────────────────┐            │
│  │     CÁLCULO POR MOTORISTA / DIA                     │            │
│  │                                                     │            │
│  │  Produção Real = Σ fare_value                       │            │
│  │  Diária = lançamento manual                         │            │
│  │  Extras = extras + missões                          │            │
│  │  Adiantamentos = vales                              │            │
│  │                                                     │            │
│  │  MODO PRODUÇÃO:                                     │            │
│  │    Excedente = max(0, Produção - Diária)            │            │
│  │    Net = Diária + Excedente + TxCorridas - Adiant.  │            │
│  │                                                     │            │
│  │  MODO GARANTIDA:                                    │            │
│  │    Garantia = max(Produção + Extras, Diária)        │            │
│  │    Net = Garantia + TxCorridas - Adiant.            │            │
│  └──────────────────────┬──────────────────────────────┘            │
│                         │                                           │
│                         ▼                                           │
│  ┌──────────────────────────────────────────────────────┐           │
│  │     CONSOLIDAÇÃO SEMANAL                             │           │
│  │                                                      │           │
│  │  Total Motoboys = Σ Net Total (todos os motoristas)  │           │
│  │  Tx Corridas Total = Σ (entregas × taxa por entrega) │           │
│  │  Piso = max(Fixo, % × Total)                         │           │
│  │  Complemento = max(0, Piso - Tx Corridas)            │           │
│  │  TOTAL A LIQUIDAR = Total Motoboys + Complemento     │           │
│  └──────────────────────┬───────────────────────────────┘           │
│                         │                                           │
│                         ▼                                           │
│  ┌──────────────────────────────────────────────────────┐           │
│  │  SNAPSHOT → CRÉDITO → LIQUIDAÇÃO                     │           │
│  │                                                      │           │
│  │  Draft → Finalizado → Bloqueado                      │           │
│  │                                                      │           │
│  │  Crédito na carteira Machine:                        │           │
│  │    Valor > 0 → Recarrega                             │           │
│  │    Valor < 0 → Debita                                │           │
│  │    Valor = 0 → Ignora                                │           │
│  └──────────────────────────────────────────────────────┘           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 16. Observações Técnicas

### 16.1 Estado de Migração

A plataforma está em **Fase 1** de implementação:
- **Banco Supabase:** Schema completo definido em `001_schema.sql` com RLS, triggers e índices
- **Persistência de dados operacionais:** Atualmente em **localStorage** (entries-store, snapshot-store, company-config) — migração para Supabase planejada
- **Rules Engine:** Implementada em TypeScript (`WeeklyRulesEngine`) — pronta para uso com dados do Supabase

### 16.2 Triggers Automáticos

1. **`trg_auto_link_driver`** — Ao inserir corrida, vincula motorista à empresa automaticamente
2. **`trg_*_updated_at`** — Atualiza `updated_at` automaticamente nas tabelas: `companies`, `drivers`, `users`, `manual_entries`, `company_configs`, `driver_default_rates`

### 16.3 Índices Otimizados

- `idx_rides_company_date` — Corridas por empresa + data (query mais frequente), **somente finalizadas** (`WHERE status = 'F'`)
- `idx_rides_driver_date` — Corridas por motorista + data
- `idx_manual_entries_driver_date` — Lançamentos por motorista + data + tipo
- `idx_line_items_snapshot` — Line items por snapshot
