import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Play,
  RefreshCw,
  Table2,
  Upload,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../api/client';
import { EmptyState, StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/ToastProvider';
import { useWorkspace } from '../context/WorkspaceContext';
import { formatINR } from '../shared/validation';

const EXCEPTION_COLORS = ['#B91C1C', '#D97706', '#1D4ED8', '#0F766E', '#64748B', '#7C3AED'];

export function OverviewPage() {
  const {
    dashboard,
    selectedClient,
    selectedPeriod,
    selectedClientId,
    selectedPeriodId,
    loading,
    error,
    refreshAll,
  } = useWorkspace();
  const { pushToast } = useToast();
  const [runningRecon, setRunningRecon] = useState(false);
  const navigate = useNavigate();

  if (loading && !dashboard) {
    return (
      <div className="space-y-5">
        <div className="h-24 animate-pulse rounded-lg border border-slate-200 bg-white" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg border border-slate-200 bg-white" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="h-72 animate-pulse rounded-lg border border-slate-200 bg-white lg:col-span-2" />
          <div className="h-72 animate-pulse rounded-lg border border-slate-200 bg-white" />
        </div>
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <EmptyState
        title="Unable to load executive overview"
        description={error || 'Workspace data could not be retrieved.'}
        actionLabel="Retry"
        onAction={() => void refreshAll()}
      />
    );
  }

  const {
    kpis,
    monthlyTrend,
    categoryBreakdown,
    pendingReviewQueue,
    latestDocumentImports,
    recentActivity,
  } = dashboard;

  const handleQuickReconcile = async () => {
    setRunningRecon(true);
    try {
      const res = await api.runReconciliation(selectedClientId, selectedPeriodId);
      await refreshAll();
      pushToast({
        tone: 'success',
        title: 'Deterministic reconciliation complete',
        description: `${res.run.summary.matchedCount} matched · ${res.run.summary.discrepancyCount} exceptions flagged for ${selectedPeriod?.shortLabel}.`,
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Reconciliation failed',
        description: err instanceof Error ? err.message : 'Unable to execute reconciliation.',
      });
    } finally {
      setRunningRecon(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Executive Welcome Header & Quick Action */}
      <div className="flex flex-col justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] lg:flex-row lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-semibold text-amber-700">SAMPLE DEMO DATA</span>
            <span aria-hidden="true">·</span>
            <span className="font-medium text-slate-700">{selectedClient?.legalName}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-[#0F2744]">{selectedClient?.gstin}</span>
            <span aria-hidden="true">·</span>
            <span>FY 2026-27 · {selectedPeriod?.label}</span>
          </div>
          <h1 className="mt-1.5 font-display text-xl font-bold text-[#0F172A] sm:text-2xl">
            GST Reconciliation Operations
          </h1>
          <p className="mt-0.5 text-xs text-slate-600 sm:text-sm">
            Deterministic 3-way compliance across uploaded invoices, Purchase Register, and manual GSTR-2B imports.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <Link
            to="/documents"
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-[#0F172A] transition-colors hover:bg-slate-50 whitespace-nowrap"
          >
            <Upload className="h-3.5 w-3.5 text-[#0F766E]" />
            <span>Upload Documents</span>
          </Link>
          <button
            type="button"
            disabled={runningRecon}
            onClick={handleQuickReconcile}
            className="inline-flex items-center gap-2 rounded-md bg-[#0F2744] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:opacity-60 whitespace-nowrap"
          >
            {runningRecon ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            <span>{runningRecon ? 'Reconciling...' : 'Start Reconciliation'}</span>
          </button>
        </div>
      </div>

      {/* Executive KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiMetricCard
          label="Total Purchase Records"
          value={String(kpis.totalPurchaseRegisterEntries)}
          meta={`${kpis.totalInvoicesProcessed} source invoices · ${kpis.totalGstr2bEntries} GSTR-2B rows`}
          onClick={() => navigate('/documents?tab=purchase-register')}
        />
        <KpiMetricCard
          label="Matched Records"
          value={String(kpis.matchedInvoices)}
          tone="green"
          meta="Exact, normalised & confirmed"
          onClick={() => navigate('/reconciliation')}
        />
        <KpiMetricCard
          label="Unmatched Records"
          value={String(kpis.unmatchedInvoices)}
          tone={kpis.unmatchedInvoices > 0 ? 'red' : 'green'}
          meta={`${kpis.openDiscrepancies} open exceptions · ${formatINR(kpis.potentialItcUnderInvestigation)}`}
          onClick={() => navigate('/discrepancies')}
        />
        <KpiMetricCard
          label="Records Requiring Review"
          value={String(kpis.discrepanciesRequiringReview + kpis.invoicesNeedingReview)}
          tone={
            kpis.discrepanciesRequiringReview + kpis.invoicesNeedingReview > 0 ? 'amber' : 'green'
          }
          meta={`${kpis.invoicesNeedingReview} invoice extractions · ${kpis.discrepanciesRequiringReview} CA reviews`}
          onClick={() => navigate('/discrepancies')}
        />
        <div className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Completion Rate</span>
            <span className="font-mono text-[11px] text-slate-500">{selectedPeriod?.shortLabel}</span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-bold text-[#0F2744] tabular-nums">
              {kpis.reconciliationCompletionPercent}%
            </span>
            <span className="font-mono text-[11px] text-emerald-700">
              {kpis.resolvedDiscrepancies} resolved
            </span>
          </div>
          <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-[#0F766E] transition-all duration-300"
              style={{ width: `${Math.min(100, kpis.reconciliationCompletionPercent)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Charts Row: Reconciliation Trend + Exception Distribution */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] lg:col-span-7">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-sm font-semibold text-[#0F172A]">
                Reconciliation Trend
              </h2>
              <p className="text-xs text-slate-500">
                Matched vs unmatched records across FY 2026-27 periods (Aug – Nov 2026)
              </p>
            </div>
            <Link
              to="/reports"
              className="inline-flex items-center gap-1 text-xs font-medium text-[#1D4ED8] hover:underline"
            >
              <span>Full Analytics</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyTrend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis
                  dataKey="periodLabel"
                  tick={{ fontSize: 11, fill: '#64748B' }}
                  axisLine={{ stroke: '#E2E8F0' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748B' }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: '6px',
                    border: '1px solid #E2E8F0',
                    fontSize: '12px',
                    boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)',
                  }}
                />
                <Bar dataKey="matched" name="Matched" fill="#0F766E" radius={[3, 3, 0, 0]} />
                <Bar
                  dataKey="unmatched"
                  name="Unmatched / Exceptions"
                  fill="#DC2626"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Exception Distribution Chart */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] lg:col-span-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-sm font-semibold text-[#0F172A]">
                Exception Distribution
              </h2>
              <p className="text-xs text-slate-500">
                Deterministic discrepancy mix for {selectedPeriod?.shortLabel}
              </p>
            </div>
            <Link
              to="/discrepancies"
              className="text-xs font-medium text-[#1D4ED8] hover:underline"
            >
              Inspect All
            </Link>
          </div>

          {categoryBreakdown.length === 0 ? (
            <div className="flex h-56 flex-col items-center justify-center text-center text-xs text-slate-500">
              <CheckCircle2 className="mb-2 h-6 w-6 text-emerald-700" />
              <span>Zero exceptions recorded for {selectedPeriod?.label}.</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-2">
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryBreakdown}
                      dataKey="count"
                      nameKey="label"
                      innerRadius={44}
                      outerRadius={70}
                      paddingAngle={2}
                    >
                      {categoryBreakdown.map((entry, idx) => (
                        <Cell
                          key={entry.category}
                          fill={EXCEPTION_COLORS[idx % EXCEPTION_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(val: unknown, _name: unknown, props: { payload?: { taxAmount?: number } }) => [
                        `${val} cases (${formatINR(props?.payload?.taxAmount ?? 0)})`,
                        'Volume',
                      ]}
                      contentStyle={{
                        borderRadius: '6px',
                        border: '1px solid #E2E8F0',
                        fontSize: '11px',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2 text-xs">
                {categoryBreakdown.slice(0, 5).map((cat, idx) => (
                  <Link
                    key={cat.category}
                    to={`/discrepancies?category=${encodeURIComponent(cat.category)}`}
                    className="flex items-center justify-between gap-2 rounded px-1.5 py-1 hover:bg-slate-50"
                  >
                    <span className="flex min-w-0 items-center gap-2 text-slate-700">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: EXCEPTION_COLORS[idx % EXCEPTION_COLORS.length] }}
                      />
                      <span className="truncate">{cat.label}</span>
                    </span>
                    <span className="font-mono font-semibold text-[#0F172A] tabular-nums shrink-0">
                      {cat.count}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3-Column Operational Feed: Pending Review Queue + Latest Document Imports + Recent Activity */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Pending Review Queue */}
        <section className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <h2 className="font-display text-sm font-semibold text-[#0F172A]">
                Pending Review Queue
              </h2>
              <p className="text-[11px] text-slate-500">
                Extractions & candidate matches awaiting verification
              </p>
            </div>
            <span className="font-mono text-xs font-semibold text-amber-700 tabular-nums">
              {pendingReviewQueue.length}
            </span>
          </div>
          {pendingReviewQueue.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-500">
              All extractions and candidate matches have been reviewed.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {pendingReviewQueue.slice(0, 5).map((item) => (
                <Link
                  key={item.id}
                  to={item.route}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-xs font-semibold text-[#0F2744] truncate">
                      {item.title}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500 truncate">
                      {item.subtitle}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <StatusBadge
                      tone={item.priority === 'HIGH' ? 'amber' : 'blue'}
                      label={item.statusLabel}
                    />
                    {item.amount !== null && (
                      <div className="mt-1 font-mono text-[11px] text-slate-600 tabular-nums">
                        {formatINR(item.amount)}
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Latest Document Imports */}
        <section className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <h2 className="font-display text-sm font-semibold text-[#0F172A]">
                Latest Document Imports
              </h2>
              <p className="text-[11px] text-slate-500">
                Invoices, Purchase Register & GSTR-2B files
              </p>
            </div>
            <Link to="/documents" className="text-xs font-medium text-[#1D4ED8] hover:underline">
              Documents
            </Link>
          </div>
          {latestDocumentImports.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-500">
              No document imports recorded for {selectedPeriod?.shortLabel}.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {latestDocumentImports.slice(0, 5).map((doc) => {
                const Icon =
                  doc.kind === 'INVOICE'
                    ? FileText
                    : doc.kind === 'PURCHASE_REGISTER'
                      ? FileSpreadsheet
                      : Table2;
                return (
                  <Link
                    key={doc.id}
                    to={doc.route}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Icon className="h-4 w-4 shrink-0 text-[#0F766E]" />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-[#0F172A]">
                          {doc.fileName}
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-slate-500">
                          {doc.recordCountLabel}
                        </div>
                      </div>
                    </div>
                    <StatusBadge tone={doc.tone} label={doc.statusLabel} />
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* Recent Reconciliation Activity */}
        <section className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <h2 className="font-display text-sm font-semibold text-[#0F172A]">
                Recent Activity
              </h2>
              <p className="text-[11px] text-slate-500">
                Auditable actions for {selectedPeriod?.shortLabel}
              </p>
            </div>
            <Link
              to="/audit-trail"
              className="text-xs font-medium text-[#1D4ED8] hover:underline"
            >
              Audit Trail
            </Link>
          </div>
          {recentActivity.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-500">
              No recent activity recorded in this period.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentActivity.slice(0, 5).map((log) => (
                <Link
                  key={log.id}
                  to="/audit-trail"
                  className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-[#0F172A] line-clamp-1">
                      {log.summary}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {log.actor} · <span className="font-mono">{log.action}</span>
                    </div>
                  </div>
                  <span className="flex items-center gap-1 font-mono text-[10px] text-slate-400 shrink-0">
                    <Clock className="h-3 w-3" />
                    {new Date(log.createdAt).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                    })}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Compliance Workflow Footer Bar */}
      <div className="flex flex-col justify-between gap-3 rounded-lg border border-slate-200 bg-white px-5 py-3.5 text-xs md:flex-row md:items-center">
        <div className="text-slate-600">
          <span className="font-semibold text-[#0F172A]">Reconciliation Pipeline: </span>
          Upload → Extract → Validate → Reconcile → Investigate → Human Review → Resolve → Report
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <Link
            to="/documents"
            className="inline-flex items-center gap-1 font-medium text-[#0F2744] hover:underline"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span>Document Centre</span>
          </Link>
          <Link
            to="/reconciliation"
            className="inline-flex items-center gap-1 font-medium text-[#1D4ED8] hover:underline"
          >
            <span>Open Workspace</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function KpiMetricCard({
  label,
  value,
  meta,
  tone = 'default',
  onClick,
}: {
  label: string;
  value: string;
  meta: string;
  tone?: 'default' | 'green' | 'amber' | 'red';
  onClick: () => void;
}) {
  const valueColor =
    tone === 'green'
      ? 'text-emerald-700'
      : tone === 'amber'
        ? 'text-amber-700'
        : tone === 'red'
          ? 'text-red-700'
          : 'text-[#0F2744]';

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors hover:border-[#1D4ED8]/50"
    >
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <span className={`mt-2 font-mono text-2xl font-bold tabular-nums ${valueColor}`}>
        {value}
      </span>
      <span className="mt-1.5 w-full truncate text-[11px] text-slate-500">{meta}</span>
    </button>
  );
}
