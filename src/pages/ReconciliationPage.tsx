import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpDown,
  CheckCircle2,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Play,
  RefreshCw,
  Search,
  SlidersHorizontal,
  XCircle,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { api } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SlideDrawer } from '../components/SlideDrawer';
import { EmptyState, StatusBadge, outcomeBadgeMeta } from '../components/StatusBadge';
import { useToast } from '../components/ToastProvider';
import { useWorkspace } from '../context/WorkspaceContext';
import type {
  ReconciliationConfig,
  ReconciliationResult,
  ReconciliationRun,
} from '../shared/types';
import { formatINR } from '../shared/validation';

type WorkspaceTab = 'ALL' | 'MATCHED' | 'MISMATCHED' | 'MISSING' | 'NEEDS_REVIEW';

function extractTaxComponent(row: ReconciliationResult, fieldLabel: string): string {
  const match = row.fieldsCompared.find((f) => f.field === fieldLabel);
  const val = match?.purchaseRegisterValue ?? match?.gstr2bValue;
  if (val === null || val === undefined || val === '—' || val === '') return '—';
  const num = Number(val);
  return Number.isFinite(num) ? formatINR(num) : String(val);
}

export function ReconciliationPage() {
  const { selectedClientId, selectedPeriodId, selectedClient, selectedPeriod, refreshAll } =
    useWorkspace();
  const { pushToast } = useToast();
  const navigate = useNavigate();

  const [config, setConfig] = useState<ReconciliationConfig>({
    dateToleranceDays: 2,
    amountToleranceRupees: 5,
    enableFuzzyMatch: true,
    fuzzySimilarityThreshold: 0.72,
  });
  const [toleranceOpen, setToleranceOpen] = useState(false);
  const [latestRun, setLatestRun] = useState<ReconciliationRun | null>(null);
  const [results, setResults] = useState<ReconciliationResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  // Tabs, filters, sorting, bulk selection
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('ALL');
  const [search, setSearch] = useState('');
  const [supplierFilter, setSupplierFilter] = useState<string>('ALL');
  const [minVal, setMinVal] = useState<string>('');
  const [sortField, setSortField] = useState<'invoiceDate' | 'prTaxableValue' | 'taxDifference'>(
    'invoiceDate'
  );
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const pageSize = 12;

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<'HUMAN_APPROVED' | 'HUMAN_REJECTED' | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [inspectedResult, setInspectedResult] = useState<ReconciliationResult | null>(null);

  const loadReconciliation = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getReconciliation(selectedClientId, selectedPeriodId);
      setConfig(res.config);
      setLatestRun(res.latestRun);
      setResults(res.results);
      setSelectedIds(new Set());
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Unable to load reconciliation data',
        description: err instanceof Error ? err.message : 'Request failed.',
      });
    } finally {
      setLoading(false);
    }
  }, [selectedClientId, selectedPeriodId, pushToast]);

  useEffect(() => {
    void loadReconciliation();
  }, [loadReconciliation]);

  const handleRun = async () => {
    setRunning(true);
    try {
      const res = await api.runReconciliation(selectedClientId, selectedPeriodId, config);
      setLatestRun(res.run);
      setResults(res.results);
      setPage(1);
      setSelectedIds(new Set());
      await refreshAll();
      pushToast({
        tone: 'success',
        title: 'Deterministic reconciliation complete',
        description: `${res.run.summary.matchedCount} matched · ${res.run.summary.discrepancyCount} exceptions flagged.`,
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Reconciliation failed',
        description: err instanceof Error ? err.message : 'Unable to run matching engine.',
      });
    } finally {
      setRunning(false);
    }
  };

  const handleReviewDecision = async (
    resultId: string,
    decision: 'HUMAN_APPROVED' | 'HUMAN_REJECTED'
  ) => {
    try {
      const res = await api.reviewReconciliationResult(resultId, decision);
      await loadReconciliation();
      await refreshAll();
      setInspectedResult(res.result);
      pushToast({
        tone: 'success',
        title: decision === 'HUMAN_APPROVED' ? 'Match manually confirmed' : 'Candidate match rejected',
        description: `Record ${res.result.invoiceNumber} updated to ${res.result.humanReviewStatus}.`,
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Review update failed',
        description: err instanceof Error ? err.message : 'Unable to update review decision.',
      });
    }
  };

  const handleBulkDecision = async () => {
    if (!bulkAction || selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      const ids = Array.from(selectedIds);
      await Promise.all(ids.map((id) => api.reviewReconciliationResult(id, bulkAction)));
      setBulkAction(null);
      setSelectedIds(new Set());
      await loadReconciliation();
      await refreshAll();
      pushToast({
        tone: 'success',
        title: `Updated ${ids.length} reconciliation record(s)`,
        description:
          bulkAction === 'HUMAN_APPROVED'
            ? 'Selected records confirmed as matched.'
            : 'Selected candidate matches rejected for investigation.',
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Bulk review failed',
        description: err instanceof Error ? err.message : 'Some records could not be updated.',
      });
    } finally {
      setBulkBusy(false);
    }
  };

  const tabCounts = useMemo(() => {
    const matched = results.filter((r) => r.outcome === 'MATCHED').length;
    const missing = results.filter(
      (r) => r.outcome === 'MISSING_IN_GSTR2B' || r.outcome === 'MISSING_IN_PURCHASE_REGISTER'
    ).length;
    const needsReview = results.filter(
      (r) =>
        r.humanReviewStatus === 'PENDING_REVIEW' ||
        r.outcome === 'NEEDS_MANUAL_REVIEW' ||
        r.matchMethod === 'FUZZY_CANDIDATE'
    ).length;
    const mismatched = results.filter(
      (r) =>
        r.outcome !== 'MATCHED' &&
        r.outcome !== 'MISSING_IN_GSTR2B' &&
        r.outcome !== 'MISSING_IN_PURCHASE_REGISTER'
    ).length;
    return {
      ALL: results.length,
      MATCHED: matched,
      MISMATCHED: mismatched,
      MISSING: missing,
      NEEDS_REVIEW: needsReview,
    };
  }, [results]);

  const supplierOptions = useMemo(() => {
    const names = new Set(results.map((r) => r.supplierName));
    return Array.from(names).sort();
  }, [results]);

  const filteredResults = useMemo(() => {
    const min = minVal ? Number(minVal) : 0;
    const filtered = results.filter((r) => {
      if (activeTab === 'MATCHED' && r.outcome !== 'MATCHED') return false;
      if (
        activeTab === 'MISSING' &&
        r.outcome !== 'MISSING_IN_GSTR2B' &&
        r.outcome !== 'MISSING_IN_PURCHASE_REGISTER'
      ) {
        return false;
      }
      if (
        activeTab === 'NEEDS_REVIEW' &&
        r.humanReviewStatus !== 'PENDING_REVIEW' &&
        r.outcome !== 'NEEDS_MANUAL_REVIEW' &&
        r.matchMethod !== 'FUZZY_CANDIDATE'
      ) {
        return false;
      }
      if (
        activeTab === 'MISMATCHED' &&
        (r.outcome === 'MATCHED' ||
          r.outcome === 'MISSING_IN_GSTR2B' ||
          r.outcome === 'MISSING_IN_PURCHASE_REGISTER')
      ) {
        return false;
      }
      if (supplierFilter !== 'ALL' && r.supplierName !== supplierFilter) return false;
      if (min > 0 && Math.max(r.prTaxableValue, r.gstr2bTaxableValue) < min) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const hay = `${r.invoiceNumber} ${r.supplierName} ${r.supplierGstin} ${r.outcome} ${r.matchMethod}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'invoiceDate') {
        cmp = a.invoiceDate.localeCompare(b.invoiceDate);
      } else if (sortField === 'prTaxableValue') {
        cmp = a.prTaxableValue - b.prTaxableValue;
      } else {
        cmp = Math.abs(a.taxDifference) - Math.abs(b.taxDifference);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return filtered;
  }, [results, activeTab, supplierFilter, minVal, search, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredResults.length / pageSize));
  const pagedResults = filteredResults.slice((page - 1) * pageSize, page * pageSize);

  const exportRows = (rowsToExport: ReconciliationResult[], format: 'csv' | 'xlsx') => {
    const mapped = rowsToExport.map((r) => ({
      'Invoice No': r.invoiceNumber,
      Supplier: r.supplierName,
      GSTIN: r.supplierGstin,
      Date: r.invoiceDate,
      'PR Taxable (INR)': r.prTaxableValue,
      'PR Tax (INR)': r.prTotalTax,
      'GSTR-2B Taxable (INR)': r.gstr2bTaxableValue,
      'GSTR-2B Tax (INR)': r.gstr2bTotalTax,
      'Tax Variance (INR)': r.taxDifference,
      Outcome: r.outcome,
      'Match Method': r.matchMethod,
      'Confidence (%)': Math.round(r.matchConfidence * 100),
      'Review Status': r.humanReviewStatus,
    }));

    if (format === 'xlsx') {
      const ws = XLSX.utils.json_to_sheet(mapped);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Reconciliation');
      XLSX.writeFile(wb, `reconciliation_${selectedClient?.gstin}_${selectedPeriodId}.xlsx`);
      return;
    }

    const csvCell = (val: unknown) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const headers = Object.keys(mapped[0] ?? { 'Invoice No': '' });
    const lines = [
      headers.join(','),
      ...mapped.map((row) =>
        headers.map((h) => csvCell(row[h as keyof typeof row])).join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reconciliation_${selectedClient?.gstin}_${selectedPeriodId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const allPagedSelected =
    pagedResults.length > 0 && pagedResults.every((r) => selectedIds.has(r.id));

  const toggleSelectAllPaged = () => {
    const next = new Set(selectedIds);
    if (allPagedSelected) {
      pagedResults.forEach((r) => next.delete(r.id));
    } else {
      pagedResults.forEach((r) => next.add(r.id));
    }
    setSelectedIds(next);
  };

  const toggleRow = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  return (
    <div className="space-y-5">
      {/* Header & Controls */}
      <div className="flex flex-col justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] lg:flex-row lg:items-center">
        <div>
          <h1 className="font-display text-xl font-bold text-[#0F172A]">
            3-Way Reconciliation Workspace
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">
            Purchase Register vs GSTR-2B & Source Invoices · {selectedClient?.tradeName} ({selectedPeriod?.label})
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setToleranceOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
              toleranceOpen
                ? 'border-[#1D4ED8] bg-blue-50 text-[#1D4ED8]'
                : 'border-slate-300 bg-white text-[#0F172A] hover:bg-slate-50'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>Tolerances</span>
          </button>
          <button
            type="button"
            onClick={() => exportRows(filteredResults, 'csv')}
            disabled={filteredResults.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-[#0F172A] hover:bg-slate-50 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            <span>CSV</span>
          </button>
          <button
            type="button"
            onClick={() => exportRows(filteredResults, 'xlsx')}
            disabled={filteredResults.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-[#0F172A] hover:bg-slate-50 disabled:opacity-50"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
            <span>Excel</span>
          </button>
          <button
            type="button"
            disabled={running}
            onClick={handleRun}
            className="inline-flex items-center gap-2 rounded-md bg-[#0F2744] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-60"
          >
            {running ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            <span>{running ? 'Reconciling...' : 'Run Reconciliation'}</span>
          </button>
        </div>
      </div>

      {/* Collapsible Tolerance Configuration Panel */}
      {toleranceOpen && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-[#0F172A]">
              Deterministic Rule Hierarchy & Tolerances
            </span>
            <span className="text-slate-500">
              Exact Match → Normalised Invoice No → Tolerance Match → Fuzzy Candidate (Human Review)
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="block font-medium text-slate-600">Date Tolerance (Days)</label>
              <input
                type="number"
                min={0}
                max={30}
                value={config.dateToleranceDays}
                onChange={(e) =>
                  setConfig({ ...config, dateToleranceDays: Number(e.target.value) || 0 })
                }
                className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-600">
                Amount Rounding Tolerance (₹)
              </label>
              <input
                type="number"
                min={0}
                max={1000}
                value={config.amountToleranceRupees}
                onChange={(e) =>
                  setConfig({ ...config, amountToleranceRupees: Number(e.target.value) || 0 })
                }
                className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-600">
                Fuzzy Candidate Threshold
              </label>
              <input
                type="number"
                step={0.05}
                min={0.5}
                max={0.95}
                value={config.fuzzySimilarityThreshold}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    fuzzySimilarityThreshold: Number(e.target.value) || 0.72,
                  })
                }
                className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 font-mono"
              />
            </div>
            <div className="flex items-end">
              <label className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5">
                <input
                  type="checkbox"
                  checked={config.enableFuzzyMatch}
                  onChange={(e) => setConfig({ ...config, enableFuzzyMatch: e.target.checked })}
                />
                <span className="font-medium text-[#0F172A]">Flag Fuzzy Candidates</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Summary Strip */}
      {latestRun && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <MetricTile label="Evaluated" value={String(latestRun.summary.totalProcessed)} />
          <MetricTile label="Matched" value={String(latestRun.summary.matchedCount)} tone="green" />
          <MetricTile
            label="Exceptions"
            value={String(latestRun.summary.discrepancyCount)}
            tone={latestRun.summary.discrepancyCount > 0 ? 'red' : 'green'}
          />
          <MetricTile
            label="Needs Review"
            value={String(latestRun.summary.needsReviewCount)}
            tone={latestRun.summary.needsReviewCount > 0 ? 'amber' : 'green'}
          />
          <MetricTile label="PR Total Tax" value={formatINR(latestRun.summary.totalPrTax)} />
          <MetricTile
            label="Tax at Variance"
            value={formatINR(latestRun.summary.potentiallyAffectedTax)}
            tone={latestRun.summary.potentiallyAffectedTax > 0 ? 'red' : 'green'}
          />
        </div>
      )}

      {/* Workspace Ledger Table Card */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        {/* Segmented Tabs + Search & Filters */}
        <div className="space-y-3 border-b border-slate-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1 rounded-md bg-slate-100 p-1 text-xs">
              {(
                [
                  { id: 'ALL', label: 'All' },
                  { id: 'MATCHED', label: 'Matched' },
                  { id: 'MISMATCHED', label: 'Mismatched' },
                  { id: 'MISSING', label: 'Missing' },
                  { id: 'NEEDS_REVIEW', label: 'Needs Review' },
                ] as Array<{ id: WorkspaceTab; label: string }>
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    setPage(1);
                  }}
                  className={`rounded px-3 py-1.5 font-medium transition-colors whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'bg-white text-[#0F172A] shadow-sm'
                      : 'text-slate-600 hover:text-[#0F172A]'
                  }`}
                >
                  {tab.label} ({tabCounts[tab.id]})
                </button>
              ))}
            </div>

            {selectedIds.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs">
                <span className="font-mono font-semibold text-[#1D4ED8]">
                  {selectedIds.size} selected
                </span>
                <button
                  type="button"
                  onClick={() =>
                    exportRows(
                      filteredResults.filter((r) => selectedIds.has(r.id)),
                      'xlsx'
                    )
                  }
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-[#0F172A] hover:bg-slate-50"
                >
                  Export Selected
                </button>
                <button
                  type="button"
                  onClick={() => setBulkAction('HUMAN_APPROVED')}
                  className="rounded bg-emerald-700 px-2.5 py-1 font-medium text-white hover:bg-emerald-800"
                >
                  Confirm Match
                </button>
                <button
                  type="button"
                  onClick={() => setBulkAction('HUMAN_REJECTED')}
                  className="rounded border border-red-300 bg-white px-2.5 py-1 font-medium text-red-700 hover:bg-red-50"
                >
                  Reject
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search invoice number, supplier name, GSTIN..."
                className="w-full rounded-md border border-slate-200 py-1.5 pl-8 pr-3 text-xs focus:border-[#1D4ED8] focus:outline-none"
              />
            </div>
            <select
              value={supplierFilter}
              onChange={(e) => {
                setSupplierFilter(e.target.value);
                setPage(1);
              }}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs max-w-[220px]"
            >
              <option value="ALL">All Suppliers</option>
              {supplierOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={minVal}
              onChange={(e) => {
                setMinVal(e.target.value);
                setPage(1);
              }}
              placeholder="Min Taxable (₹)"
              className="w-36 rounded-md border border-slate-200 px-2.5 py-1.5 font-mono text-xs"
            />
          </div>
        </div>

        {loading ? (
          <div className="space-y-2 p-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />
            ))}
          </div>
        ) : filteredResults.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No matching reconciliation records"
              description="Adjust your active tab or filters, or run deterministic reconciliation for the selected period."
              actionLabel="Run Reconciliation"
              onAction={handleRun}
            />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50/80 font-semibold text-slate-600">
                  <tr>
                    <th className="w-9 px-3 py-2.5">
                      <input
                        type="checkbox"
                        aria-label="Select all visible rows"
                        checked={allPagedSelected}
                        onChange={toggleSelectAllPaged}
                      />
                    </th>
                    <th className="px-3 py-2.5">Invoice No / Supplier</th>
                    <th className="px-3 py-2.5">GSTIN</th>
                    <th className="px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => toggleSort('invoiceDate')}
                        className="inline-flex items-center gap-1 hover:text-[#0F172A]"
                      >
                        <span>Date</span>
                        <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </th>
                    <th className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => toggleSort('prTaxableValue')}
                        className="inline-flex items-center gap-1 hover:text-[#0F172A]"
                      >
                        <span>Taxable</span>
                        <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </th>
                    <th className="px-3 py-2.5 text-right">CGST</th>
                    <th className="px-3 py-2.5 text-right">SGST</th>
                    <th className="px-3 py-2.5 text-right">IGST</th>
                    <th className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => toggleSort('taxDifference')}
                        className="inline-flex items-center gap-1 hover:text-[#0F172A]"
                      >
                        <span>Variance</span>
                        <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </th>
                    <th className="px-3 py-2.5">Match Status</th>
                    <th className="px-3 py-2.5 text-right">Confidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pagedResults.map((row) => {
                    const meta = outcomeBadgeMeta(row.outcome);
                    const checked = selectedIds.has(row.id);
                    const confPct = Math.round(row.matchConfidence * 100);
                    return (
                      <tr
                        key={row.id}
                        onClick={() => setInspectedResult(row)}
                        className={`cursor-pointer transition-colors ${
                          checked ? 'bg-blue-50/50' : 'hover:bg-slate-50/90'
                        }`}
                      >
                        <td
                          className="px-3 py-2.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            aria-label={`Select ${row.invoiceNumber}`}
                            checked={checked}
                            onChange={() => toggleRow(row.id)}
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-mono font-semibold text-[#0F2744]">
                            {row.invoiceNumber}
                          </div>
                          <div className="max-w-[190px] truncate text-[11px] text-slate-500">
                            {row.supplierName}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px] text-slate-600">
                          {row.supplierGstin}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                          {row.invoiceDate}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[#0F172A]">
                          {formatINR(row.prTaxableValue || row.gstr2bTaxableValue)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-600">
                          {extractTaxComponent(row, 'CGST (₹)')}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-600">
                          {extractTaxComponent(row, 'SGST (₹)')}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-600">
                          {extractTaxComponent(row, 'IGST (₹)')}
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right font-mono font-semibold tabular-nums ${
                            row.taxDifference !== 0 ? 'text-red-700' : 'text-emerald-700'
                          }`}
                        >
                          {row.taxDifference === 0 ? '₹0' : formatINR(row.taxDifference)}
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge tone={meta.tone} label={meta.label} />
                          <div className="mt-1 font-mono text-[10px] text-slate-400">
                            {row.matchMethod.replace(/_/g, ' ')}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <span className="font-mono text-[11px] font-semibold text-[#0F172A] tabular-nums">
                              {confPct}%
                            </span>
                            <span className="h-1.5 w-10 overflow-hidden rounded-full bg-slate-100">
                              <span
                                className={`block h-full ${
                                  confPct >= 90
                                    ? 'bg-emerald-600'
                                    : confPct >= 70
                                      ? 'bg-amber-500'
                                      : 'bg-red-500'
                                }`}
                                style={{ width: `${confPct}%` }}
                              />
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
              <span>
                Showing <strong className="font-mono text-[#0F172A]">{(page - 1) * pageSize + 1}</strong>–
                <strong className="font-mono text-[#0F172A]">
                  {Math.min(page * pageSize, filteredResults.length)}
                </strong>{' '}
                of <strong className="font-mono text-[#0F172A]">{filteredResults.length}</strong> records
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="rounded border border-slate-200 px-2.5 py-1 hover:bg-slate-50 disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="font-mono text-[#0F172A]">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded border border-slate-200 px-2.5 py-1 hover:bg-slate-50 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 3-Way Record Inspection Side Drawer */}
      <SlideDrawer
        open={Boolean(inspectedResult)}
        onClose={() => setInspectedResult(null)}
        widthClass="max-w-2xl"
        title={
          inspectedResult && (
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-mono text-base font-bold text-[#0F2744]">
                {inspectedResult.invoiceNumber}
              </span>
              <StatusBadge
                tone={outcomeBadgeMeta(inspectedResult.outcome).tone}
                label={outcomeBadgeMeta(inspectedResult.outcome).label}
              />
            </div>
          )
        }
        subtitle={
          inspectedResult && (
            <span>
              {inspectedResult.supplierName} · GSTIN{' '}
              <span className="font-mono text-[#0F172A]">{inspectedResult.supplierGstin}</span> ·
              Method: <span className="font-mono">{inspectedResult.matchMethod}</span>
            </span>
          )
        }
        footer={
          inspectedResult && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {inspectedResult.outcome !== 'MATCHED' && (
                  <button
                    type="button"
                    onClick={() => handleReviewDecision(inspectedResult.id, 'HUMAN_APPROVED')}
                    className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-emerald-800"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Confirm Match</span>
                  </button>
                )}
                {(inspectedResult.humanReviewStatus === 'PENDING_REVIEW' ||
                  inspectedResult.matchMethod === 'FUZZY_CANDIDATE') && (
                  <button
                    type="button"
                    onClick={() => handleReviewDecision(inspectedResult.id, 'HUMAN_REJECTED')}
                    className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3.5 py-2 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    <span>Reject Match</span>
                  </button>
                )}
              </div>
              {inspectedResult.discrepancyId && (
                <button
                  type="button"
                  onClick={() =>
                    navigate(`/discrepancies?id=${encodeURIComponent(inspectedResult.discrepancyId!)}`)
                  }
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#0F2744] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#1D4ED8]"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Investigate Exception</span>
                </button>
              )}
            </div>
          )
        }
      >
        {inspectedResult && (
          <div className="space-y-5 text-xs">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-[#0F172A]">Deterministic Engine Assessment</span>
                <span className="font-mono text-[11px] text-slate-500">
                  {inspectedResult.humanReviewStatus} · Confidence{' '}
                  {Math.round(inspectedResult.matchConfidence * 100)}%
                </span>
              </div>
              <p className="leading-relaxed text-slate-700">{inspectedResult.explanation}</p>
              {inspectedResult.evidence && inspectedResult.evidence.length > 0 && (
                <div className="border-t border-slate-200 pt-2">
                  <div className="mb-1 font-semibold text-slate-500">Evidence Points</div>
                  <ul className="list-disc space-y-1 pl-4 text-slate-700">
                    {inspectedResult.evidence.map((ev, idx) => (
                      <li key={idx}>{ev}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="pt-1 font-medium text-[#0F766E]">
                Next Action: {inspectedResult.suggestedNextStep}
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                3-Way Source Field Comparison
              </h3>
              <div className="overflow-x-auto rounded-md border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Field</th>
                      <th className="px-3 py-2">Uploaded Invoice</th>
                      <th className="px-3 py-2">Purchase Register</th>
                      <th className="px-3 py-2">GSTR-2B</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {inspectedResult.fieldsCompared.map((fc, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 font-medium text-[#0F172A]">{fc.field}</td>
                        <td className="px-3 py-2 font-mono tabular-nums text-slate-600">
                          {fc.invoiceValue ?? '—'}
                        </td>
                        <td className="px-3 py-2 font-mono tabular-nums text-[#0F172A]">
                          {fc.purchaseRegisterValue ?? '—'}
                        </td>
                        <td
                          className={`px-3 py-2 font-mono tabular-nums ${
                            fc.status === 'DIFF' || fc.status === 'MISSING'
                              ? 'font-semibold text-red-700'
                              : fc.status === 'TOLERANCE_OK'
                                ? 'font-medium text-amber-700'
                                : 'text-emerald-700'
                          }`}
                        >
                          {fc.gstr2bValue ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </SlideDrawer>

      {/* Bulk Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(bulkAction)}
        tone={bulkAction === 'HUMAN_REJECTED' ? 'danger' : 'primary'}
        busy={bulkBusy}
        title={
          bulkAction === 'HUMAN_APPROVED'
            ? `Confirm ${selectedIds.size} Match(es) Manually?`
            : `Reject ${selectedIds.size} Candidate Match(es)?`
        }
        description={
          bulkAction === 'HUMAN_APPROVED'
            ? 'Selected records will be marked HUMAN_APPROVED and linked discrepancies resolved. All transitions are written to the audit trail.'
            : 'Selected candidate matches will be marked HUMAN_REJECTED and kept under manual investigation.'
        }
        confirmLabel={
          bulkAction === 'HUMAN_APPROVED' ? 'Confirm Selected' : 'Reject Selected'
        }
        onConfirm={handleBulkDecision}
        onCancel={() => setBulkAction(null)}
      />
    </div>
  );
}

function MetricTile({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'green' | 'amber' | 'red';
}) {
  const color =
    tone === 'green'
      ? 'text-emerald-700'
      : tone === 'amber'
        ? 'text-amber-700'
        : tone === 'red'
          ? 'text-red-700'
          : 'text-[#0F2744]';
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      <div className={`mt-1 font-mono text-base font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
