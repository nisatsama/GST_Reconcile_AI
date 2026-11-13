import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Download,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  IndianRupee,
  TrendingUp,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import * as XLSX from 'xlsx';
import { api } from '../api/client';
import { useToast } from '../components/ToastProvider';
import { useWorkspace } from '../context/WorkspaceContext';
import { formatINR } from '../shared/validation';

const REPORT_CATALOG = [
  {
    type: 'MONTHLY_SUMMARY',
    title: 'Monthly Reconciliation Summary',
    description: 'Complete 3-way match outcomes across all evaluated invoices.',
  },
  {
    type: 'MATCHED_INVOICES',
    title: 'Matched Invoices Report',
    description: 'Verified exact, normalised, and human-confirmed matches.',
  },
  {
    type: 'UNMATCHED_INVOICES',
    title: 'Unmatched & Mismatched Report',
    description: 'All records with discrepancies or missing counterparts.',
  },
  {
    type: 'DISCREPANCY_REPORT',
    title: 'Detailed Discrepancy Report',
    description: 'Discrepancy categories, severity, evidence, and resolution status.',
  },
  {
    type: 'SUPPLIER_PENDING',
    title: 'Supplier-Wise Pending Issues',
    description: 'Grouped unresolved issues and affected tax per supplier GSTIN.',
  },
  {
    type: 'POTENTIAL_TAX_IMPACT',
    title: 'Potentially Affected Tax Report',
    description: 'Amounts under investigation requiring CA review before ITC treatment.',
  },
  {
    type: 'AUDIT_TRAIL',
    title: 'Compliance Audit Trail',
    description: 'Chronological log of imports, extractions, approvals, and follow-ups.',
  },
];

interface ReportData {
  reportType: string;
  title: string;
  businessName: string;
  gstin: string;
  periodLabel: string;
  generatedAt: string;
  disclaimer: string;
  summaryMetrics: Array<{ label: string; value: string }>;
  columns: string[];
  rows: Array<Record<string, string | number>>;
  csvContent: string;
}

export function ReportsPage() {
  const { selectedClientId, selectedPeriodId, selectedClient, selectedPeriod, dashboard } =
    useWorkspace();
  const { pushToast } = useToast();

  const [selectedType, setSelectedType] = useState<string>('MONTHLY_SUMMARY');
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getReport(selectedClientId, selectedPeriodId, selectedType);
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate report.');
    } finally {
      setLoading(false);
    }
  }, [selectedClientId, selectedPeriodId, selectedType]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const taxComponentRows = useMemo(() => {
    const t = dashboard?.taxComponentSummary;
    if (!t) return [];
    return [
      { label: 'Taxable Value', pr: t.taxablePr, gstr2b: t.taxable2b, variance: t.taxablePr - t.taxable2b },
      { label: 'CGST', pr: t.cgstPr, gstr2b: t.cgst2b, variance: t.cgstPr - t.cgst2b },
      { label: 'SGST', pr: t.sgstPr, gstr2b: t.sgst2b, variance: t.sgstPr - t.sgst2b },
      { label: 'IGST', pr: t.igstPr, gstr2b: t.igst2b, variance: t.igstPr - t.igst2b },
      { label: 'Cess', pr: t.cessPr, gstr2b: t.cess2b, variance: t.cessPr - t.cess2b },
      {
        label: 'Total Tax (CGST + SGST + IGST + Cess)',
        pr: t.totalTaxPr,
        gstr2b: t.totalTax2b,
        variance: t.totalTaxPr - t.totalTax2b,
        isTotal: true,
      },
    ];
  }, [dashboard]);

  const supplierImpactChartData = useMemo(() => {
    return (dashboard?.supplierOutstanding ?? []).slice(0, 6).map((s) => ({
      name: s.supplierName.length > 20 ? `${s.supplierName.slice(0, 18)}…` : s.supplierName,
      fullName: s.supplierName,
      taxUnderInvestigation: s.taxUnderInvestigation,
      openCount: s.openCount,
    }));
  }, [dashboard]);

  const handleDownloadCsv = () => {
    if (!report) return;
    const blob = new Blob([report.csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GST_Reconcile_${report.reportType}_${report.gstin}_${selectedPeriodId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast({
      tone: 'success',
      title: 'CSV schedule downloaded',
      description: `${report.title} exported for ${report.periodLabel}.`,
    });
  };

  const handleDownloadExcel = () => {
    if (!report) return;
    const worksheetRows =
      report.rows.length > 0
        ? report.rows.map((row) => {
            const ordered: Record<string, string | number> = {};
            report.columns.forEach((col) => {
              ordered[col] = row[col] ?? '';
            });
            return ordered;
          })
        : [
            report.columns.reduce<Record<string, string>>((acc, col) => {
              acc[col] = '';
              return acc;
            }, {}),
          ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(worksheetRows);
    XLSX.utils.book_append_sheet(wb, ws, report.reportType.slice(0, 31));
    XLSX.writeFile(wb, `GST_Reconcile_${report.reportType}_${report.gstin}_${selectedPeriodId}.xlsx`);
    pushToast({
      tone: 'success',
      title: 'Excel workbook downloaded',
      description: `${report.title} exported as .xlsx.`,
    });
  };

  const sanitizePdfText = (val: string) => val.replace(/₹\s?/g, 'INR ');

  const handleDownloadPdf = () => {
    if (!report) return;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    doc.setFillColor(15, 39, 68);
    doc.rect(0, 0, doc.internal.pageSize.getWidth(), 64, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(15);
    doc.text(sanitizePdfText(`GST Reconcile AI — ${report.title}`), 36, 30);
    doc.setFontSize(9);
    doc.text(
      sanitizePdfText(
        `Business: ${report.businessName}   |   GSTIN: ${report.gstin}   |   Period: ${report.periodLabel}   |   Generated: ${new Date(report.generatedAt).toLocaleString('en-IN')}`
      ),
      36,
      48
    );

    doc.setTextColor(100, 116, 139);
    doc.setFontSize(8);
    doc.text(sanitizePdfText(`Notice: ${report.disclaimer}`), 36, 82);

    const summaryLine = sanitizePdfText(
      report.summaryMetrics.map((m) => `${m.label}: ${m.value}`).join('   |   ')
    );
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(9);
    doc.text(summaryLine, 36, 100);

    const bodyRows = report.rows.map((row) =>
      report.columns.map((col) => sanitizePdfText(String(row[col] ?? '')))
    );

    autoTable(doc, {
      startY: 114,
      head: [report.columns.map((col) => sanitizePdfText(col))],
      body: bodyRows.length > 0 ? bodyRows : [['No records available for this report.']],
      styles: { fontSize: 7.5, cellPadding: 4 },
      headStyles: { fillColor: [15, 39, 68], textColor: 255 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 36, right: 36 },
    });

    doc.save(`GST_Reconcile_${report.reportType}_${report.gstin}_${selectedPeriodId}.pdf`);
    pushToast({
      tone: 'success',
      title: 'PDF compliance report downloaded',
      description: `${report.title} exported for audit review.`,
    });
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] lg:flex-row lg:items-center">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-[#0F172A]">
            Reports & Compliance Analytics
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Period-wise match analytics, deterministic tax-component variance summary, and audit-ready PDF, Excel, or CSV schedules for{' '}
            <span className="font-medium text-slate-700">{selectedClient?.tradeName}</span> (
            {selectedPeriod?.label}).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={!report || loading}
            onClick={handleDownloadCsv}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <FileText className="h-3.5 w-3.5 text-slate-600" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            disabled={!report || loading}
            onClick={handleDownloadExcel}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
            <span>Export Excel</span>
          </button>
          <button
            type="button"
            disabled={!report || loading}
            onClick={handleDownloadPdf}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#0F2744] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export PDF</span>
          </button>
        </div>
      </div>

      {/* Analytics Row */}
      {dashboard && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
          {/* Period Match-Rate & Exception Trend */}
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] xl:col-span-7">
            <div className="mb-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-[#1D4ED8]" />
                <div>
                  <h2 className="font-display text-sm font-semibold text-[#0F172A]">
                    Period-Wise Reconciliation & Match-Rate Trend
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Matched vs unmatched volumes alongside completion rate across monthly GST filings
                  </p>
                </div>
              </div>
              <span className="font-mono text-xs font-semibold text-[#0F2744] tabular-nums">
                {dashboard.kpis.reconciliationCompletionPercent}% current
              </span>
            </div>
            <div className="h-[230px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={dashboard.monthlyTrend}
                  margin={{ top: 8, right: 12, left: -12, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis
                    dataKey="periodLabel"
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    axisLine={{ stroke: '#E2E8F0' }}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[0, 100]}
                    unit="%"
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      fontSize: '12px',
                      borderRadius: '6px',
                      borderColor: '#E2E8F0',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Bar
                    yAxisId="left"
                    dataKey="matched"
                    name="Matched"
                    fill="#0F766E"
                    radius={[3, 3, 0, 0]}
                    barSize={20}
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="unmatched"
                    name="Unmatched / Exceptions"
                    fill="#B91C1C"
                    radius={[3, 3, 0, 0]}
                    barSize={20}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="completionPercent"
                    name="Match Rate (%)"
                    stroke="#1D4ED8"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#1D4ED8' }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Supplier-Wise Discrepancy & Tax Impact */}
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] xl:col-span-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-[#0F2744]" />
                <div>
                  <h2 className="font-display text-sm font-semibold text-[#0F172A]">
                    Supplier-Wise Tax Under Investigation
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Suppliers contributing open discrepancies in {selectedPeriod?.shortLabel}
                  </p>
                </div>
              </div>
              <span className="font-mono text-xs font-semibold text-red-700 tabular-nums">
                {formatINR(dashboard.kpis.potentialItcUnderInvestigation)}
              </span>
            </div>
            {supplierImpactChartData.length === 0 ? (
              <div className="flex h-[230px] items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50/50 text-xs text-slate-500">
                No supplier-linked discrepancies open in {selectedPeriod?.shortLabel}.
              </div>
            ) : (
              <div className="h-[230px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={supplierImpactChartData}
                    layout="vertical"
                    margin={{ top: 4, right: 16, left: 10, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10, fill: '#64748B' }}
                      tickFormatter={(v) => `₹${Math.round(Number(v) / 1000)}k`}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={120}
                      tick={{ fontSize: 11, fill: '#0F172A' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(val: unknown) => [formatINR(Number(val ?? 0)), 'Tax Impact']}
                      contentStyle={{
                        fontSize: '12px',
                        borderRadius: '6px',
                        borderColor: '#E2E8F0',
                      }}
                    />
                    <Bar
                      dataKey="taxUnderInvestigation"
                      name="Tax Under Investigation"
                      fill="#0F2744"
                      radius={[0, 3, 3, 0]}
                      barSize={18}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Deterministic Tax Component Variance Table */}
      {dashboard && (
        <div className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <IndianRupee className="h-4 w-4 text-[#0F2744]" />
              <div>
                <h2 className="font-display text-sm font-semibold text-[#0F172A]">
                  Tax Component Reconciliation Summary (Purchase Register vs GSTR-2B)
                </h2>
                <p className="text-[11px] text-slate-500">
                  Deterministic aggregate comparison for {selectedClient?.tradeName} ·{' '}
                  {selectedPeriod?.label}. Positive variance indicates books exceed GSTR-2B.
                </p>
              </div>
            </div>
            <span className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
              Deterministic Totals · Subject to CA Review
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-2.5">Tax Component</th>
                  <th className="px-5 py-2.5 text-right">Purchase Register (Books)</th>
                  <th className="px-5 py-2.5 text-right">GSTR-2B (Portal)</th>
                  <th className="px-5 py-2.5 text-right">Net Variance (PR - 2B)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {taxComponentRows.map((row) => (
                  <tr
                    key={row.label}
                    className={row.isTotal ? 'bg-slate-50/90 font-semibold' : 'hover:bg-slate-50/60'}
                  >
                    <td className="px-5 py-2.5 text-[#0F172A]">{row.label}</td>
                    <td className="px-5 py-2.5 text-right font-mono tabular-nums text-[#0F172A]">
                      {formatINR(row.pr)}
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono tabular-nums text-slate-700">
                      {formatINR(row.gstr2b)}
                    </td>
                    <td
                      className={`px-5 py-2.5 text-right font-mono font-semibold tabular-nums ${
                        Math.abs(row.variance) < 1
                          ? 'text-emerald-700'
                          : row.variance > 0
                            ? 'text-red-700'
                            : 'text-amber-700'
                      }`}
                    >
                      {row.variance > 0 ? `+${formatINR(row.variance)}` : formatINR(row.variance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Report Schedule Selector */}
      <div>
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold text-[#0F172A]">
            Audit-Ready Schedule Catalog
          </h2>
          <span className="text-[11px] text-slate-500">
            Select any compliance schedule below to preview and export
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {REPORT_CATALOG.map((item) => {
            const active = item.type === selectedType;
            return (
              <button
                key={item.type}
                type="button"
                onClick={() => setSelectedType(item.type)}
                className={`rounded-lg border p-3.5 text-left transition-colors ${
                  active
                    ? 'border-[#1D4ED8] bg-blue-50/40 ring-1 ring-[#1D4ED8]/20'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <FileText
                    className={`h-4 w-4 shrink-0 ${
                      active ? 'text-[#1D4ED8]' : 'text-slate-500'
                    }`}
                  />
                  <span className="text-xs font-semibold text-[#0F172A]">{item.title}</span>
                </div>
                <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
                  {item.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Report Preview */}
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-700">
          {error}
        </div>
      ) : loading || !report ? (
        <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-xs text-slate-500">
          Generating compliance schedule preview...
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="border-b border-slate-200 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileCheck2 className="h-5 w-5 text-[#0F2744]" />
                <h2 className="font-display text-base font-bold text-[#0F172A]">
                  {report.title}
                </h2>
              </div>
              <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                Generated: {new Date(report.generatedAt).toLocaleString('en-IN')}
              </span>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {report.businessName} · GSTIN{' '}
              <span className="font-mono text-[#0F172A]">{report.gstin}</span> · Period:{' '}
              {report.periodLabel}
            </div>
            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
              {report.disclaimer}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {report.summaryMetrics.map((m) => (
                <div
                  key={m.label}
                  className="rounded-md border border-slate-200 bg-slate-50/50 px-3 py-2.5"
                >
                  <div className="text-[11px] text-slate-500">{m.label}</div>
                  <div className="mt-0.5 font-mono text-sm font-bold text-[#0F2744] tabular-nums">
                    {m.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            {report.rows.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No rows found for this schedule in {report.periodLabel}.
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    {report.columns.map((col) => (
                      <th key={col} className="px-4 py-2.5 whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.rows.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/70">
                      {report.columns.map((col) => {
                        const raw = row[col];
                        const isMono =
                          typeof raw === 'number' ||
                          col.toLowerCase().includes('gstin') ||
                          col.toLowerCase().includes('invoice') ||
                          col.toLowerCase().includes('date') ||
                          col.toLowerCase().includes('tax') ||
                          col.toLowerCase().includes('value') ||
                          col.toLowerCase().includes('amount') ||
                          col.toLowerCase().includes('timestamp');
                        return (
                          <td
                            key={col}
                            className={`px-4 py-2.5 text-[#0F172A] max-w-[260px] truncate ${
                              isMono ? 'font-mono tabular-nums' : ''
                            }`}
                            title={String(raw ?? '')}
                          >
                            {String(raw ?? '—')}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
