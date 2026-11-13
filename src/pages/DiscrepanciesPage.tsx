import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileSearch,
  Mail,
  Search,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { api } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SlideDrawer } from '../components/SlideDrawer';
import {
  EmptyState,
  StatusBadge,
  discrepancyStatusBadge,
  outcomeBadgeMeta,
} from '../components/StatusBadge';
import { useToast } from '../components/ToastProvider';
import { useWorkspace } from '../context/WorkspaceContext';
import type { Discrepancy, DiscrepancyStatus, ReconciliationResult } from '../shared/types';
import { formatINR } from '../shared/validation';

type QueueFilter =
  | 'ALL'
  | 'HIGH_VALUE'
  | 'MISSING'
  | 'GSTIN_MISMATCH'
  | 'TAX_DIFF'
  | 'DUPLICATES'
  | 'PENDING_SUPPLIER';

function computeAgeingDays(createdAt: string): number {
  const diff = Date.now() - new Date(createdAt).getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

export function DiscrepanciesPage() {
  const { selectedClientId, selectedPeriodId, selectedClient, selectedPeriod, refreshAll } =
    useWorkspace();
  const { pushToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [discrepancies, setDiscrepancies] = useState<Discrepancy[]>([]);
  const [carriedForwardHistory, setCarriedForwardHistory] = useState<Discrepancy[]>([]);
  const [results, setResults] = useState<ReconciliationResult[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('id'));
  const [drawerOpen, setDrawerOpen] = useState(Boolean(searchParams.get('id')));
  const [viewMode, setViewMode] = useState<'QUEUE' | 'CROSS_PERIOD'>('QUEUE');
  const [quickFilter, setQuickFilter] = useState<QueueFilter>('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [investigating, setInvestigating] = useState(false);
  const [draftingFollowUp, setDraftingFollowUp] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [resolveConfirmOpen, setResolveConfirmOpen] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const categoryParam = searchParams.get('category') || 'ALL';
  const queryId = searchParams.get('id');

  useEffect(() => {
    if (queryId) {
      setSelectedId(queryId);
      setDrawerOpen(true);
    }
  }, [queryId]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getDiscrepancies(selectedClientId, selectedPeriodId);
      setDiscrepancies(res.discrepancies);
      setCarriedForwardHistory(res.carriedForwardHistory);
      setResults(res.results);
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Failed to load exceptions',
        description: err instanceof Error ? err.message : 'Unable to fetch discrepancies.',
      });
    } finally {
      setLoading(false);
    }
  }, [selectedClientId, selectedPeriodId, pushToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredDiscrepancies = useMemo(() => {
    return discrepancies.filter((d) => {
      if (categoryParam !== 'ALL' && d.category !== categoryParam) return false;
      if (quickFilter === 'HIGH_VALUE' && d.potentiallyAffectedTax < 5000) return false;
      if (
        quickFilter === 'MISSING' &&
        d.category !== 'MISSING_IN_GSTR2B' &&
        d.category !== 'MISSING_IN_PURCHASE_REGISTER'
      ) {
        return false;
      }
      if (quickFilter === 'GSTIN_MISMATCH' && d.category !== 'GSTIN_MISMATCH') return false;
      if (
        quickFilter === 'TAX_DIFF' &&
        d.category !== 'TAX_AMOUNT_MISMATCH' &&
        d.category !== 'TAXABLE_VALUE_MISMATCH'
      ) {
        return false;
      }
      if (quickFilter === 'DUPLICATES' && d.category !== 'POSSIBLE_DUPLICATE') return false;
      if (quickFilter === 'PENDING_SUPPLIER' && d.status !== 'AWAITING_SUPPLIER') return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const hay = `${d.id} ${d.invoiceNumber} ${d.supplierName} ${d.supplierGstin} ${d.category} ${d.status}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [discrepancies, categoryParam, quickFilter, search]);

  const selectedDiscrepancy = useMemo(
    () => discrepancies.find((d) => d.id === selectedId) ?? null,
    [discrepancies, selectedId]
  );

  const linkedResult = useMemo(
    () =>
      selectedDiscrepancy
        ? results.find((r) => r.id === selectedDiscrepancy.reconciliationResultId) ?? null
        : null,
    [selectedDiscrepancy, results]
  );

  useEffect(() => {
    setResolutionNotes(selectedDiscrepancy?.resolutionNotes ?? '');
  }, [selectedDiscrepancy]);

  const openException = (d: Discrepancy) => {
    setSelectedId(d.id);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    if (searchParams.has('id')) {
      const next = new URLSearchParams(searchParams);
      next.delete('id');
      setSearchParams(next, { replace: true });
    }
  };

  const handleInvestigate = async () => {
    if (!selectedDiscrepancy) return;
    setInvestigating(true);
    try {
      const res = await api.investigateDiscrepancy(selectedDiscrepancy.id);
      setDiscrepancies((prev) =>
        prev.map((d) => (d.id === res.discrepancy.id ? res.discrepancy : d))
      );
      await refreshAll();
      pushToast({
        tone: 'success',
        title: 'AI-assisted explanation generated',
        description: `Evidence-grounded analysis saved for ${res.discrepancy.invoiceNumber}.`,
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'AI investigation failed',
        description: err instanceof Error ? err.message : 'Unable to generate explanation.',
      });
    } finally {
      setInvestigating(false);
    }
  };

  const handleUpdateStatus = async (status: DiscrepancyStatus) => {
    if (!selectedDiscrepancy) return;
    setUpdatingStatus(true);
    try {
      const res = await api.updateDiscrepancyStatus(
        selectedDiscrepancy.id,
        status,
        resolutionNotes
      );
      setDiscrepancies((prev) =>
        prev.map((d) => (d.id === res.discrepancy.id ? res.discrepancy : d))
      );
      setResolveConfirmOpen(false);
      await refreshAll();
      pushToast({
        tone: 'success',
        title: `Exception marked ${status.replace(/_/g, ' ')}`,
        description: `${res.discrepancy.invoiceNumber} status persisted to audit trail.`,
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Status update failed',
        description: err instanceof Error ? err.message : 'Could not update exception.',
      });
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleDraftFollowUp = async () => {
    if (!selectedDiscrepancy) return;
    setDraftingFollowUp(true);
    try {
      const res = await api.generateFollowUp(selectedDiscrepancy.id);
      await refreshAll();
      pushToast({
        tone: 'success',
        title: 'Supplier follow-up drafted',
        description: 'Review and approve before manual dispatch.',
      });
      navigate(`/suppliers?followup=${encodeURIComponent(res.followUp.id)}`);
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Follow-up drafting failed',
        description: err instanceof Error ? err.message : 'Unable to generate message.',
      });
    } finally {
      setDraftingFollowUp(false);
    }
  };

  const totalOpenTaxUnderInvestigation = useMemo(
    () =>
      discrepancies
        .filter((d) => d.status !== 'RESOLVED' && d.status !== 'CLOSED')
        .reduce((sum, d) => sum + d.potentiallyAffectedTax, 0),
    [discrepancies]
  );

  return (
    <div className="space-y-5">
      {/* Header & View Switcher */}
      <div className="flex flex-col justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] lg:flex-row lg:items-center">
        <div>
          <h1 className="font-display text-xl font-bold text-[#0F172A]">
            Exceptions Queue & AI Investigation
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">
            Centralised GST discrepancy queue for {selectedClient?.tradeName} · {selectedPeriod?.label}
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1 text-xs shrink-0">
          <button
            type="button"
            onClick={() => setViewMode('QUEUE')}
            className={`rounded px-3 py-1.5 font-medium transition-colors ${
              viewMode === 'QUEUE'
                ? 'bg-white text-[#0F172A] shadow-sm'
                : 'text-slate-600 hover:text-[#0F172A]'
            }`}
          >
            Exception Queue ({discrepancies.length})
          </button>
          <button
            type="button"
            onClick={() => setViewMode('CROSS_PERIOD')}
            className={`rounded px-3 py-1.5 font-medium transition-colors ${
              viewMode === 'CROSS_PERIOD'
                ? 'bg-white text-[#0F172A] shadow-sm'
                : 'text-slate-600 hover:text-[#0F172A]'
            }`}
          >
            Cross-Period History ({carriedForwardHistory.length})
          </button>
        </div>
      </div>

      {/* Compliance Disclosure Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50/70 px-5 py-3 text-xs text-amber-950">
        <div className="flex items-center gap-2.5">
          <ShieldAlert className="h-4 w-4 shrink-0 text-amber-700" />
          <span>
            <strong>CA Governance:</strong> AI explanations assist investigation using verified records and never determine final legal ITC eligibility.
          </span>
        </div>
        <div className="font-mono font-semibold text-red-700 tabular-nums">
          Open Tax Under Investigation: {formatINR(totalOpenTaxUnderInvestigation)}
        </div>
      </div>

      {viewMode === 'CROSS_PERIOD' ? (
        <div className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="font-display text-sm font-semibold text-[#0F172A]">
              Unresolved Exceptions Carried Across Periods
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Tracked across Aug – Nov 2026 and re-evaluated against new GSTR-2B imports.
            </p>
          </div>
          {carriedForwardHistory.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No carried-forward unresolved exceptions in other periods for {selectedClient?.tradeName}.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50/80 font-semibold text-slate-600">
                  <tr>
                    <th className="px-4 py-2.5">First Detected</th>
                    <th className="px-4 py-2.5">Last Reviewed</th>
                    <th className="px-4 py-2.5">Invoice No</th>
                    <th className="px-4 py-2.5">Supplier</th>
                    <th className="px-4 py-2.5">Category</th>
                    <th className="px-4 py-2.5 text-right">Financial Impact</th>
                    <th className="px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {carriedForwardHistory.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono text-slate-600">
                        {d.firstDetectedPeriodId}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-600">
                        {d.lastReviewedPeriodId}
                      </td>
                      <td className="px-4 py-2.5 font-mono font-semibold text-[#0F2744]">
                        {d.invoiceNumber}
                      </td>
                      <td className="px-4 py-2.5 text-[#0F172A]">{d.supplierName}</td>
                      <td className="px-4 py-2.5">
                        <StatusBadge
                          tone={outcomeBadgeMeta(d.category).tone}
                          label={outcomeBadgeMeta(d.category).label}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold text-red-700 tabular-nums">
                        {formatINR(d.potentiallyAffectedTax)}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge
                          tone={discrepancyStatusBadge(d.status).tone}
                          label={discrepancyStatusBadge(d.status).label}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          {/* Queue Filters Bar */}
          <div className="space-y-3 border-b border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {(
                  [
                    { id: 'ALL', label: 'All Exceptions' },
                    { id: 'HIGH_VALUE', label: 'High-Value (≥ ₹5k)' },
                    { id: 'MISSING', label: 'Missing Invoices' },
                    { id: 'GSTIN_MISMATCH', label: 'GSTIN Mismatch' },
                    { id: 'TAX_DIFF', label: 'Tax Differences' },
                    { id: 'DUPLICATES', label: 'Duplicates' },
                    { id: 'PENDING_SUPPLIER', label: 'Pending Supplier' },
                  ] as Array<{ id: QueueFilter; label: string }>
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setQuickFilter(f.id)}
                    className={`rounded-md border px-2.5 py-1.5 font-medium transition-colors ${
                      quickFilter === f.id
                        ? 'border-[#0F2744] bg-[#0F2744] text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-[#0F172A]'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {categoryParam !== 'ALL' && (
                <button
                  type="button"
                  onClick={() => {
                    const next = new URLSearchParams(searchParams);
                    next.delete('category');
                    setSearchParams(next, { replace: true });
                  }}
                  className="text-xs font-medium text-[#1D4ED8] hover:underline"
                >
                  Clear category filter ({categoryParam})
                </button>
              )}
            </div>

            <div className="relative max-w-md">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search exception ID, invoice no, supplier, GSTIN..."
                className="w-full rounded-md border border-slate-200 py-1.5 pl-8 pr-3 text-xs focus:border-[#1D4ED8] focus:outline-none"
              />
            </div>
          </div>

          {loading ? (
            <div className="space-y-2 p-6">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-11 animate-pulse rounded bg-slate-100" />
              ))}
            </div>
          ) : filteredDiscrepancies.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No exceptions matching this view"
                description="All evaluated records matched deterministically, or adjust your active exception filters."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50/80 font-semibold text-slate-600">
                  <tr>
                    <th className="px-4 py-2.5">Exception ID</th>
                    <th className="px-4 py-2.5">Supplier / GSTIN</th>
                    <th className="px-4 py-2.5">Invoice No</th>
                    <th className="px-4 py-2.5">Exception Type</th>
                    <th className="px-4 py-2.5 text-right">Financial Impact</th>
                    <th className="px-4 py-2.5">Priority</th>
                    <th className="px-4 py-2.5">Reviewer</th>
                    <th className="px-4 py-2.5 text-right">Ageing</th>
                    <th className="px-4 py-2.5">Resolution Status</th>
                    <th className="px-4 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredDiscrepancies.map((d) => {
                    const catMeta = outcomeBadgeMeta(d.category);
                    const statusMeta = discrepancyStatusBadge(d.status);
                    const ageingDays = computeAgeingDays(d.createdAt);
                    return (
                      <tr
                        key={d.id}
                        onClick={() => openException(d)}
                        className="cursor-pointer transition-colors hover:bg-slate-50/90"
                      >
                        <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500">
                          {d.id.slice(0, 12)}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-[#0F172A] max-w-[180px] truncate">
                            {d.supplierName}
                          </div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {d.supplierGstin}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 font-mono font-semibold text-[#0F2744]">
                          {d.invoiceNumber}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusBadge tone={catMeta.tone} label={catMeta.label} />
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-red-700 tabular-nums">
                          {formatINR(d.potentiallyAffectedTax)}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[11px]">
                          <span
                            className={
                              d.severity === 'HIGH'
                                ? 'font-semibold text-red-700'
                                : d.severity === 'MEDIUM'
                                  ? 'font-medium text-amber-700'
                                  : 'text-slate-600'
                            }
                          >
                            {d.severity}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">
                          {d.resolvedBy ?? (d.needsCaReview ? 'CA Partner' : 'Accountant')}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-500 tabular-nums">
                          {ageingDays === 0 ? 'Today' : `${ageingDays}d`}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusBadge tone={statusMeta.tone} label={statusMeta.label} />
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openException(d);
                            }}
                            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-[#0F2744] hover:bg-slate-50"
                          >
                            <FileSearch className="h-3 w-3" />
                            <span>Investigate</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* SCREEN 3: AI Exception Investigation Slide Drawer */}
      <SlideDrawer
        open={drawerOpen && Boolean(selectedDiscrepancy)}
        onClose={closeDrawer}
        widthClass="max-w-3xl"
        title={
          selectedDiscrepancy && (
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-mono text-base font-bold text-[#0F2744]">
                {selectedDiscrepancy.invoiceNumber}
              </span>
              <StatusBadge
                tone={outcomeBadgeMeta(selectedDiscrepancy.category).tone}
                label={outcomeBadgeMeta(selectedDiscrepancy.category).label}
              />
              <StatusBadge
                tone={discrepancyStatusBadge(selectedDiscrepancy.status).tone}
                label={discrepancyStatusBadge(selectedDiscrepancy.status).label}
              />
            </div>
          )
        }
        subtitle={
          selectedDiscrepancy && (
            <span>
              Exception ID <span className="font-mono">{selectedDiscrepancy.id}</span> ·{' '}
              {selectedDiscrepancy.supplierName} (
              <span className="font-mono">{selectedDiscrepancy.supplierGstin}</span>) · Period{' '}
              {selectedDiscrepancy.firstDetectedPeriodId}
            </span>
          )
        }
        footer={
          selectedDiscrepancy && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={updatingStatus}
                  onClick={() => handleUpdateStatus('UNDER_REVIEW')}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-[#0F172A] hover:bg-slate-50 disabled:opacity-50"
                >
                  <Clock className="h-3.5 w-3.5" />
                  <span>Mark Under Review</span>
                </button>
                <button
                  type="button"
                  disabled={updatingStatus}
                  onClick={() => handleUpdateStatus('AWAITING_SUPPLIER')}
                  className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span>Awaiting Supplier</span>
                </button>
              </div>
              <button
                type="button"
                disabled={updatingStatus}
                onClick={() => setResolveConfirmOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Approve & Resolve</span>
              </button>
            </div>
          )
        }
      >
        {selectedDiscrepancy && (
          <div className="space-y-6 text-xs">
            {/* Action Trigger Strip */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 p-3.5">
              <div className="space-y-0.5">
                <div className="font-semibold text-[#0F172A]">Source Document References</div>
                <div className="font-mono text-[11px] text-slate-500">
                  PR Entry: {linkedResult?.purchaseEntryId ?? 'None'} · GSTR-2B:{' '}
                  {linkedResult?.gstr2bEntryId ?? 'None'} · Invoice:{' '}
                  {linkedResult?.invoiceId ?? 'None'}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={investigating}
                  onClick={handleInvestigate}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#0F2744] px-3 py-1.5 font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>
                    {investigating
                      ? 'Analyzing...'
                      : selectedDiscrepancy.aiInvestigation
                        ? 'Regenerate AI Analysis'
                        : 'Generate AI Investigation'}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={draftingFollowUp}
                  onClick={handleDraftFollowUp}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#0F766E] bg-white px-3 py-1.5 font-medium text-[#0F766E] hover:bg-teal-50 disabled:opacity-50"
                >
                  <Mail className="h-3.5 w-3.5" />
                  <span>{draftingFollowUp ? 'Drafting...' : 'Draft Follow-Up'}</span>
                </button>
              </div>
            </div>

            {/* Financial Impact Summary */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-slate-200 bg-white p-3.5">
                <div className="text-[11px] text-slate-500">Amount Under Investigation</div>
                <div className="mt-1 font-mono text-base font-bold text-[#0F172A] tabular-nums">
                  {formatINR(selectedDiscrepancy.amountUnderInvestigation)}
                </div>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-3.5">
                <div className="text-[11px] text-slate-500">Potentially Affected Tax</div>
                <div className="mt-1 font-mono text-base font-bold text-red-700 tabular-nums">
                  {formatINR(selectedDiscrepancy.potentiallyAffectedTax)}
                </div>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-3.5">
                <div className="text-[11px] text-slate-500">Priority & Severity</div>
                <div className="mt-1 font-mono text-sm font-semibold text-[#0F2744]">
                  {selectedDiscrepancy.severity} ·{' '}
                  {selectedDiscrepancy.needsCaReview ? 'CA Review Required' : 'Standard Review'}
                </div>
              </div>
            </div>

            {/* Side-by-Side Field Comparison */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Verified Record Field Comparison
              </h3>
              <p className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-slate-700 leading-relaxed">
                {selectedDiscrepancy.evidenceSummary}
              </p>
              {linkedResult && (
                <div className="overflow-x-auto rounded-md border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2">Field</th>
                        <th className="px-3 py-2">Source Invoice</th>
                        <th className="px-3 py-2">Purchase Register</th>
                        <th className="px-3 py-2">GSTR-2B</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {linkedResult.fieldsCompared.map((fc, i) => {
                        const isDiff = fc.status === 'DIFF' || fc.status === 'MISSING';
                        return (
                          <tr key={i} className={isDiff ? 'bg-red-50/40' : undefined}>
                            <td className="px-3 py-2 font-medium text-[#0F172A]">{fc.field}</td>
                            <td className="px-3 py-2 font-mono text-slate-600">
                              {fc.invoiceValue ?? '—'}
                            </td>
                            <td className="px-3 py-2 font-mono text-[#0F172A]">
                              {fc.purchaseRegisterValue ?? '—'}
                            </td>
                            <td
                              className={`px-3 py-2 font-mono ${
                                isDiff
                                  ? 'font-semibold text-red-700'
                                  : fc.status === 'TOLERANCE_OK'
                                    ? 'font-medium text-amber-700'
                                    : 'text-emerald-700'
                              }`}
                            >
                              {fc.gstr2bValue ?? '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Visually Distinct AI-Assisted Analysis Block */}
            <div className="rounded-lg border border-blue-200 bg-blue-50/35 p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-200/70 pb-2.5">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[#1D4ED8]" />
                  <span className="font-semibold text-[#0F2744]">
                    AI-Assisted Explanation & Supporting Evidence
                  </span>
                </div>
                <span className="font-mono text-[11px] text-slate-500">
                  {selectedDiscrepancy.aiInvestigation
                    ? `${selectedDiscrepancy.aiInvestigation.modelUsed} · Requires CA Review`
                    : 'Not Yet Generated'}
                </span>
              </div>

              {selectedDiscrepancy.aiInvestigation ? (
                <div className="space-y-4">
                  <div>
                    <div className="font-semibold text-[#0F172A]">What Happened</div>
                    <p className="mt-1 leading-relaxed text-slate-700">
                      {selectedDiscrepancy.aiInvestigation.whatHappened}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="rounded-md border border-emerald-200/70 bg-white p-3">
                      <div className="font-semibold text-emerald-800">
                        Confirmed Facts from Records
                      </div>
                      <ul className="mt-1.5 list-disc space-y-1 pl-4 text-slate-700">
                        {selectedDiscrepancy.aiInvestigation.confirmedFacts.map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-md border border-amber-200/70 bg-white p-3">
                      <div className="font-semibold text-amber-800">
                        Possible Causes (Unconfirmed)
                      </div>
                      <ul className="mt-1.5 list-disc space-y-1 pl-4 text-slate-700">
                        {selectedDiscrepancy.aiInvestigation.possibleCauses.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div>
                    <div className="font-semibold text-[#0F2744]">Suggested Next Actions</div>
                    <ol className="mt-1 list-decimal space-y-1 pl-4 text-slate-700">
                      {selectedDiscrepancy.aiInvestigation.recommendedNextAction.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ol>
                  </div>

                  <div className="rounded border border-amber-200 bg-amber-50/90 p-2.5 text-amber-950">
                    <strong>CA Review Note:</strong>{' '}
                    {selectedDiscrepancy.aiInvestigation.professionalReviewNote}
                  </div>
                </div>
              ) : (
                <div className="py-4 text-center text-slate-600">
                  Click <strong>Generate AI Investigation</strong> above to compile evidence-backed facts, unconfirmed root causes, and next steps from the underlying records.
                </div>
              )}
            </div>

            {/* Reviewer Notes */}
            <div className="space-y-1.5">
              <label className="block font-semibold text-[#0F172A]">
                Reviewer Findings & Resolution Notes
              </label>
              <textarea
                rows={3}
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                placeholder="Document verification notes, supplier credit note ref, or GSTR-1 amendment period..."
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-xs focus:border-[#1D4ED8] focus:outline-none"
              />
            </div>
          </div>
        )}
      </SlideDrawer>

      <ConfirmDialog
        open={resolveConfirmOpen}
        tone="primary"
        busy={updatingStatus}
        title="Approve & Mark Exception Resolved?"
        description={`Confirm that discrepancy ${selectedDiscrepancy?.invoiceNumber ?? ''} has been verified and resolved. This action updates period completion metrics and writes to the compliance audit trail.`}
        confirmLabel="Approve & Resolve"
        onConfirm={() => handleUpdateStatus('RESOLVED')}
        onCancel={() => setResolveConfirmOpen(false)}
      />
    </div>
  );
}
