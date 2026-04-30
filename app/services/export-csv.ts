/**
 * Excel Export — generates a CSV download from report data
 * Lightweight: no external dependencies (no xlsx library needed)
 */

interface ExportRow {
  nome: string;
  dias: Record<string, { producaoReal: number; entregas: number; diaria: number; taxa: number; valorPago: number }>;
  totalDiaria: number;
  totalTaxa: number;
  taxaCorridas: number;
  adiantamentos: number;
  totalLiquido: number;
  producaoExibida: number;
  totalProducaoReal: number;
  totalEntregas: number;
  payoutTotal: number;
}

interface ExportOptions {
  rows: ExportRow[];
  weekDates: { iso: string; dayName: string }[];
  reportType: 'producao' | 'garantida' | 'garantida_horas';
  includeTaxaCorridas: boolean;
  companyName: string;
  periodLabel: string;
  totalGeral: number;
  txAdm?: number;
  txSupervisao?: number;
  debitoPendente?: number;
  totalALiquidar?: number;
}

function formatNumber(val: number): string {
  return val.toFixed(2).replace('.', ',');
}

export function exportToCSV(options: ExportOptions) {
  const {
    rows, weekDates, reportType, includeTaxaCorridas,
    companyName, periodLabel, totalGeral,
    txAdm = 0, txSupervisao = 0, debitoPendente = 0, totalALiquidar,
  } = options;
  const BOM = '\uFEFF'; // UTF-8 BOM for Excel

  // Header row
  const headers = ['MOTOBOY'];
  weekDates.forEach(d => headers.push(d.dayName));

  if (reportType === 'producao') {
    headers.push('DIÁRIA', 'TAXA');
  } else {
    headers.push('PRODUÇÃO', 'GARANTIDO');
  }

  if (includeTaxaCorridas) headers.push('TX CORRIDAS');
  headers.push('ADIANTAMENTOS', 'TOTAL LÍQUIDO');

  // Data rows
  const dataRows = rows.map(row => {
    const vals: string[] = [row.nome];

    weekDates.forEach(d => {
      const day = row.dias[d.iso];
      if (!day || (day.producaoReal === 0 && day.entregas === 0 && day.diaria === 0)) {
        vals.push('-');
      } else if (reportType === 'producao') {
        // Show actual production value (or diária if no rides)
        const displayVal = day.producaoReal > 0 ? day.producaoReal : (day.diaria > 0 ? day.diaria : 0);
        vals.push(formatNumber(displayVal));
      } else {
        vals.push(formatNumber(day.valorPago));
      }
    });

    if (reportType === 'producao') {
      vals.push(formatNumber(row.totalDiaria));
      vals.push(formatNumber(row.totalTaxa));
    } else {
      vals.push(formatNumber(row.totalProducaoReal));
      vals.push(formatNumber(row.payoutTotal));
    }

    if (includeTaxaCorridas) vals.push(formatNumber(row.taxaCorridas));
    vals.push(row.adiantamentos > 0 ? `-${formatNumber(row.adiantamentos)}` : '-');
    vals.push(formatNumber(row.totalLiquido));

    return vals;
  });

  // Total row
  const totalRow = ['TOTAL ACUMULADO'];
  weekDates.forEach(d => {
    const dayTotal = rows.reduce((sum, row) => {
      const day = row.dias[d.iso];
      if (!day) return sum;
      if (reportType === 'producao') {
        const displayVal = day.producaoReal > 0 ? day.producaoReal : (day.diaria > 0 ? day.diaria : 0);
        return sum + displayVal;
      }
      return sum + day.valorPago;
    }, 0);
    totalRow.push(dayTotal > 0 ? formatNumber(dayTotal) : '-');
  });

  if (reportType === 'producao') {
    totalRow.push(formatNumber(rows.reduce((s, r) => s + r.totalDiaria, 0)));
    totalRow.push(formatNumber(rows.reduce((s, r) => s + r.totalTaxa, 0)));
  } else {
    totalRow.push(formatNumber(rows.reduce((s, r) => s + r.totalProducaoReal, 0)));
    totalRow.push(formatNumber(rows.reduce((s, r) => s + r.payoutTotal, 0)));
  }
  if (includeTaxaCorridas) totalRow.push(formatNumber(rows.reduce((s, r) => s + r.taxaCorridas, 0)));
  totalRow.push(`-${formatNumber(rows.reduce((s, r) => s + r.adiantamentos, 0))}`);
  totalRow.push(formatNumber(totalGeral));

  // Assemble CSV
  const csvLines = [
    `Relatório Consolidado - ${companyName}`,
    `Período: ${periodLabel}`,
    `Modo: ${reportType === 'producao' ? 'Produção Padrão' : 'Garantida Mínima'}`,
    '',
    headers.map(h => `"${h}"`).join(';'),
    ...dataRows.map(row => row.map(v => `"${v}"`).join(';')),
    totalRow.map(v => `"${v}"`).join(';'),
    '',
    '--- RESUMO ---',
    `"LOGÍSTICA (Total Tabela)";"${formatNumber(totalGeral)}"`,
    `"TX ADM";"${formatNumber(txAdm)}"`,
    `"TX CORRIDAS";"${formatNumber(rows.reduce((s, r) => s + r.taxaCorridas, 0))}"`,
    `"TX SUPERVISÃO";"${formatNumber(txSupervisao)}"`,
    `"DÉBITO PENDENTE";"${formatNumber(debitoPendente)}"`,
    '',
    `"TOTAL A LIQUIDAR";"${formatNumber(totalALiquidar ?? (totalGeral + txAdm + txSupervisao + debitoPendente))}"`,
  ];

  const csvContent = BOM + csvLines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `relatorio_${companyName.replace(/\s+/g, '_')}_${periodLabel.replace(/\s+/g, '').replace(/[–\/]/g, '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
