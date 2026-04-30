# Upgrade Sistema — Gap Analysis Completo

## Inventário Atual do Sistema

### Páginas (10 telas)

| Página | Caminho | Visão | Funcionalidade |
|--------|---------|-------|----------------|
| Dashboard | `/` | Ambos | Painel tempo real, mapa, corridas ativas, faturamento |
| Corridas | `/corridas` | Ambos | Histórico de corridas com paginação e filtros |
| Lançamentos | `/lancamentos` | Ambos | Grid semanal presença/diária por motoboy, adiantamentos |
| Motoboys | `/motoboys` | Admin | Lista condutores, associação motoboy ↔ loja |
| Relatórios | `/relatorios` | Ambos | Relatório semanal por motoboy (garantido/produção) |
| Financeiro | `/financeiro` | Ambos | Crédito automático, log de créditos, saldos Machine |
| Snapshots | `/snapshots` | Ambos | Fechamento semanal com congelamento de dados |
| Configurações | `/configuracoes` | Ambos | Taxas, diárias, turnos, extra km, auto-crédito |
| Empresas | `/empresas` | Admin | Gestão de lojas/empresas cadastradas |
| Sincronização | `/sync` | Admin | Status e logs de integração com Machine API |

### APIs Machine já integradas

| Endpoint Machine | Status | Uso no sistema |
|-----------------|--------|----------------|
| `condutor` (GET) | ✅ | Lista motoboys |
| `empresa` (GET) | ✅ | Lista empresas |
| `solicitacao` (GET) | ✅ | Lista corridas |
| `abrirSolicitacao` (POST) | ✅ | Nova entrega |
| `cancelar` (POST) | ✅ | Cancelar corrida |
| `estimarSolicitacao` (POST) | ✅ | Estimar valor/tempo |
| `consultarProgramada` (GET) | ✅ | Corridas agendadas |
| `obterLinkRastreio` (GET) | ✅ | Link de rastreio |
| `solicitacaoStatus` (GET) | ✅ | Status individual |
| `saldoCreditosCondutor` (POST) | ✅ | Saldo carteira |
| `saldoCreditosEmpresa` (POST) | ✅ | Saldo empresa |
| `recarregarCreditosCondutor` (POST) | ✅ | Créditar motoboy |
| `sacarCreditosCondutor` (POST) | ✅ | Sacar do motoboy |
| `cadastrarEmpresa` (POST) | ✅ | Registrar empresa |
| `atualizarEmpresas` (PUT) | ✅ | Atualizar empresa |
| `cadastrarWebhook` (POST) | ✅ | Webhook posição |

### Banco de Dados (14 tabelas)

`companies`, `company_configs`, `drivers`, `company_drivers`, `users`, `rides`, `manual_entries`, `driver_default_rates`, `financial_snapshots`, `financial_line_items`, `credit_log`, `snapshot_drivers`, `sync_logs`, `system_config`

---

## 🔴 CRÍTICO — Funcionalidades Essenciais que Faltam

### 1. Gestão de Escalas e Presença
**Problema:** Hoje tudo é feito por WhatsApp. O supervisor não tem uma tela para escalar motoboys e o lojista não sabe quem está escalado.

**O que precisa:**
- Tela de **Escala Semanal** onde o supervisor/lojista define quais motoboys trabalham cada dia
- Integração com o grid de Lançamentos (pre-preencher diárias baseado na escala)
- Visão do lojista: "Quem está escalado hoje?"
- Notificação de conflitos (motoboy escalado em duas lojas no mesmo turno)

**Complexidade:** Alta | **Dependências:** `company_drivers` + nova tabela `schedules`

---

### 2. Notificações e Alertas
**Problema:** Nenhuma notificação existe no sistema. O gestor precisa entrar e verificar manualmente tudo.

**O que precisa:**
- Alerta quando corrida é cancelada/não atendida
- Alerta quando motoboy não fez check-in (se escala existir)
- Notificação de fechamento semanal pendente
- Alerta de saldo baixo da empresa na Machine
- Canal: email e/ou push notification no navegador

**Complexidade:** Média | **Dependências:** Webhook + Supabase Edge Functions ou cron

---

### 3. Exportação de Relatórios (PDF/Excel)
**Problema:** O relatório semanal só existe na tela. Não é possível gerar PDF para enviar ao lojista ou imprimir para o motoboy assinar.

**O que precisa:**
- Botão "Exportar PDF" no relatório semanal
- Botão "Exportar Excel" com dados brutos
- Recibo individual por motoboy (para assinatura)
- Envio automático por email ao finalizar snapshot

**Complexidade:** Média | **Dependências:** Biblioteca de PDF (jsPDF ou react-pdf)

---

### 4. Histórico Financeiro Consolidado (Lojista)
**Problema:** O lojista não tem uma visão mensal/anual do quanto gastou com delivery. Só vê a semana corrente.

**O que precisa:**
- Dashboard financeiro para o lojista com:
  - Gasto total mensal com motoboys
  - Gráfico de evolução semanal
  - Comparativo mês a mês
  - Total de corridas/entregas por período
- Filtro por mês/trimestre/ano

**Complexidade:** Média | **Dependências:** `financial_snapshots` (dados já existem)

---

## 🟡 IMPORTANTE — Funcionalidades que Agregam Muito Valor

### 5. Cadastro/Edição de Motoboy pelo Sistema
**Problema:** Hoje motoboys são cadastrados diretamente na Machine. Não há tela no sistema para cadastrar, editar dados, ou desativar um motoboy.

**O que precisa:**
- Formulário de cadastro de novo motoboy (nome, CPF, telefone, PIX)
- Edição de dados cadastrais
- Ativar/Desativar motoboy
- Endpoint Machine: `POST /api/integracao/condutor` (cadastrar) e `PUT` (atualizar)

**Complexidade:** Baixa | **Dependências:** API já existe mas não há UI

---

### 6. Controle de Adiantamentos/Vales com Histórico
**Problema:** O sistema permite registrar adiantamentos no grid de Lançamentos, mas não há um controle dedicado com histórico e relatório de vales por motoboy.

**O que precisa:**
- Tela dedicada de "Adiantamentos/Vales"
- Histórico por motoboy: quanto recebeu, quando, quem autorizou
- Saldo acumulado de adiantamentos pendentes
- Integração automática: vale → débito na carteira Machine

**Complexidade:** Média | **Dependências:** `manual_entries` (dados já existem parcialmente)

---

### 7. Avaliação de Desempenho do Motoboy
**Problema:** Não há métricas de performance individual — quantas corridas fez, taxa de cancelamento, tempo médio, pontualidade.

**O que precisa:**
- Card de perfil por motoboy com métricas:
  - Total de corridas (semana/mês)
  - Taxa de cancelamento
  - Faturamento gerado
  - Média de corridas por dia
  - Dias trabalhados no mês
- Ranking de motoboys por performance

**Complexidade:** Média | **Dependências:** `rides` (dados já sincronizados)

---

### 8. Gestão de Veículos
**Problema:** Sem controle dos veículos usados pelos motoboys (moto própria, alugada, etc).

**O que precisa:**
- Cadastro de veículo: placa, modelo, tipo (moto/bike/carro)
- Vínculo veículo ↔ motoboy
- Controle de manutenção/vencimento de documentos
- Alertas de CNH/CRLV vencendo

**Complexidade:** Média | **Dependências:** Nova tabela `vehicles`

---

### 9. Chat / Comunicação Interna
**Problema:** Toda comunicação é feita via WhatsApp. Não há registro formal de comunicados ou instruções.

**O que precisa:**
- Mural de avisos por loja (admin → lojista → motoboys)
- Mensagens diretas para motoboy específico
- Confirmação de leitura

**Complexidade:** Alta | **Dependências:** Supabase Realtime

---

## 🟢 DIFERENCIAIS — Funcionalidades que Destaquem o Sistema

### 10. App Mobile para Motoboy
**Problema:** Motoboy depende 100% do app Machine. Não tem visão do quanto vai receber, sua escala, ou seus dados financeiros.

**O que precisa:**
- PWA ou app nativo (React Native)
- Ver escala do dia/semana
- Ver quanto já produziu (corridas do dia)
- Ver extrato de créditos
- Confirmar presença
- Ver recibo semanal

**Complexidade:** Muito Alta | **Dependências:** Todas as features acima

---

### 11. Dashboard Gerencial para a Central (Seu uso)
**Problema:** Como central, você precisa de uma visão macro: faturamento total, ranking de lojas, inadimplência, etc.

**O que precisa:**
- KPIs gerais: # lojas ativas, # motoboys, # corridas/dia, faturamento total
- Ranking de lojas por volume
- Lojas com pendências financeiras
- Motoboys mais e menos produtivos (cross-loja)
- Custo operacional vs. receita por loja
- Gráficos de tendência (semana, mês, trimestre)

**Complexidade:** Média | **Dependências:** `rides`, `financial_snapshots`, `companies`

---

### 12. Faturamento / Cobrança da Loja
**Problema:** Você (Central) cobra das lojas pelo serviço de logística, mas o controle é manual.

**O que precisa:**
- Cálculo automático da fatura mensal por loja
- Componentes: taxa de supervisão + custo de corridas + encargos
- Status: Aberta → Enviada → Paga → Vencida
- Histórico de faturas
- Alertas de inadimplência

**Complexidade:** Alta | **Dependências:** Nova tabela `invoices`

---

### 13. Onboarding Automatizado
**Problema:** Quando uma nova loja entra, o setup é todo manual (criar empresa na Machine, configurar taxas, vincular motoboys).

**O que precisa:**
- Wizard de onboarding: cadastro da loja → config de taxas → vincular motoboys → ativar
- Criação automática na Machine API
- Template de configurações padrão

**Complexidade:** Média | **Dependências:** APIs já existem

---

## Mapa de Prioridades Recomendado

### Fase 1 — Essencial (Abril 2026)
- Exportação PDF/Excel dos relatórios
- Cadastro/Edição de motoboy pela tela
- Histórico financeiro mensal/anual para o lojista

### Fase 2 — Operacional (Maio 2026)
- Gestão de Escalas (substituir WhatsApp)
- Controle dedicado de Adiantamentos/Vales
- Notificações/Alertas

### Fase 3 — Diferencial (Junho 2026)
- Dashboard Gerencial para a Central
- Avaliação de desempenho do motoboy
- Faturamento/Cobrança automática

### Fase 4 — Expansão (Julho 2026+)
- App Mobile (PWA) para motoboy
- Chat/Comunicação interna
- Gestão de veículos
- Onboarding automatizado
