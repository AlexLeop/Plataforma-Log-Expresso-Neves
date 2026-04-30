# Regras de Negócio Financeiras — Plataforma de Gestão de Motoboys

Este documento detalha as regras de negócio que regem o sistema financeiro da plataforma, focando na lógica de cálculo, pagamentos e cobranças.

---

## 1. Visão Geral

A plataforma atua como um sistema de gestão financeira para empresas de logística que trabalham com motoboys. O objetivo principal é consolidar as corridas realizadas (vindas do sistema Machine), permitir ajustes manuais e gerar um relatório de fechamento semanal para pagamento dos entregadores e cobrança das empresas.

### Entidades Principais
- **Empresa (Loja):** O cliente que contrata o serviço de logística.
- **Motoboy (Entregador):** O profissional que realiza as entregas.
- **Corrida:** Cada entrega individual realizada.
- **Lançamento Manual:** Registros feitos pelo gestor, como diárias, extras ou adiantamentos.
- **Relatório Semanal:** O fechamento consolidado de todos os valores da semana.

---

## 2. Ciclo Financeiro Semanal

O sistema opera em ciclos semanais, geralmente de **segunda-feira a domingo**.
1. **Sincronização:** As corridas finalizadas são importadas automaticamente.
2. **Lançamentos:** O gestor registra as diárias (presença) e outros valores manuais.
3. **Fechamento:** O sistema calcula os totais baseando-se em dois modos possíveis (Produção ou Garantida).
4. **Liquidação:** O valor final é consolidado para que a empresa possa pagar a central e os motoboys.

---

## 3. Regras de Pagamento do Motoboy

Existem dois modelos de cálculo que o gestor pode escolher para cada relatório:

### Modelo 1: Produção Padrão
Neste modelo, o motoboy recebe sua diária fixa mais o que ele produziu acima dessa diária.
- **Cálculo:** Diária + Excedente + Taxa de Entrega − Adiantamentos/descontos manuais/vales.
- **Excedente:** Se a produção real (soma das corridas) for maior que a diária, ele recebe a diferença. Se for menor, o excedente é zero.

### Modelo 2: Garantida Mínima
Neste modelo, o motoboy tem a garantia de receber, no mínimo, o valor da diária, independente da sua produção.
- **Regra Central:** Se a produção for menor que a diária, ele recebe a diária. Se a produção for maior, ele recebe a produção real.
- **Cálculo:** Valor Garantido + Taxa de Entrega − Adiantamentos/descontos manuais/vales.

---

## 4. Tipos de Lançamentos Manuais

O gestor pode inserir valores manualmente para ajustar o financeiro de cada motoboy:
- **Diária:** Valor base pelo dia trabalhado. O sistema sugere valores automáticos dependendo do dia (ex: valores diferentes para finais de semana ou feriados).
- **Extra / Missão:** Bônus por entregas especiais ou metas atingidas.
- **Adiantamento (Vale):** Valores já pagos antecipadamente ao motoboy, que serão descontados no fechamento final.

---

## 5. Cobranças da Empresa (Logística)

Além do pagamento dos motoboys, o sistema calcula quanto a empresa (loja) deve pagar pelo serviço de logística:

### Taxa por Entrega
Cada entrega realizada gera uma taxa administrativa (ex: R$ 1,60 por parada).

### Piso Mínimo Semanal
Para garantir a viabilidade da operação, existe um **Piso Mínimo**.
- Se o total das taxas de entrega da semana não atingir o valor do piso (ex: R$ 350,00), a empresa paga um **complemento** até chegar nesse valor.
- O piso pode ser um valor fixo, um percentual ou uma combinação de ambos, sobre o total da operação, valendo sempre o que for maior.
- Além disso, é cobrado uma taxa de supervisão semanal (ex: R$ 100,00 por semana).

---

## 6. Glossário de Negócio

- **Produção Real:** A soma total do valor de todas as corridas que o motoboy finalizou.
- **Excedente:** O valor que ultrapassa a diária na produção real.
- **Garantia:** O mecanismo que assegura que o motoboy nunca ganhe menos que a diária combinada.
- **Taxa de Corrida:** Valor cobrado da loja por cada parada feita pelo motoboy.
- **Total Líquido:** O valor final "na mão" do motoboy após somas e descontos.
- **Total a Liquidar:** O valor total que a empresa deve transferir para a central (soma de todos os motoboys + taxas de logística).
