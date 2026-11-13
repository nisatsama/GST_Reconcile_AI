import { useCallback, useEffect, useState } from 'react';
import { Download, FileSpreadsheet, History, Search } from 'lucide-react';
import * as XLSX from 'xlsx';
import { api } from '../api/client';
import { EmptyState, StatusBadge, type BadgeTone } from '../components/StatusBadge';
import { useToast } from '../components/ToastProvider';
import { useWorkspace } from '../context/WorkspaceContext';
import type { AuditLog } from '../shared/types';

const ENTITY_FILTER_OPTIONS = [
  { value: 'ALL', label: 'All Record Types' },
  { value: 'INVOICE', label: 'Supplier Invoices' },
  { value: 'PURCHASE_REGISTER', label: 'Purchase Register' },
  { value: 'GSTR2B', label: 'GSTR-2B' },
  { value: 'RECONCILIATION', label: 'Reconciliation' },
  { value: 'DISCREPANCY', label: 'Exceptions' },
  { value: 'FOLLOW_UP', label: 'Follow-Ups' },
  { value: 'WORKSPACE', label: 'Workspace' },
];

const APPROVAL_BADGE: Record<
  NonNullable<AuditLog['approvalStatus']>,
  { tone: BadgeTone; label: string }
> = {
  APPROVED: { tone: 'green', label: 'Approved' },
  PENDING_REVIEW: { tone: 'amber', label: 'Pending Review' },
  REJECTED: { tone: 'red', label: 'Rejected' },
  AUTO_LOGGED: { tone: 'neutral', label: 'System Logged' },
};

export function AuditTrailPage() {
  const { selectedClientId, selectedPeriodId, selectedClient, selectedPeriod } = useWorkspace();
  const { pushToast } = useToast();

  const [scope, setScope] = useState<'PERIOD' | 'ALL'>('PERIOD');
  const [entityType, setEntityType] = useState<string>('ALL');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getAuditLogs(selectedClientId, selectedPeriodId, {
        scope,
        entityType,
        search: debouncedSearch,
      });
      setLogs(res.logs);
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Unable to load audit trail',
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setLoading(false);
    }
  }, [selectedClientId, selectedPeriodId, scope, entityType, debouncedSearch, pushToast]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const buildExportRows = () =>
    logs.map((l) => ({
      Timestamp: new Date(l.createdAt).toLocaleString('en-IN'),
      Actor: l.actor,
      Action: l.action,
      EntityType: l.entityType,
      AffectedRecord: l.affectedRecord || l.entityId,
      PreviousState: l.previousState || '—',
      UpdatedState: l.updatedState || l.summary,
      ApprovalStatus: l.approvalStatus || 'AUTO_LOGGED',
      Period: l.periodId,
    }));

  const handleExportCsv = () => {
    const rows = buildExportRows();
    const headers = [
      'Timestamp',
      'Actor',
      'Action',
      'EntityType',
      'AffectedRecord',
      'PreviousState',
      'UpdatedState',
      'ApprovalStatus',
      'Period',
    ];
    const escape = (v: unknown) => {
      const str = String(v ?? '');
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    };
    const csv = [
      headers.join(','),
      ...rows.map((r) => headers.map((h) => escape(r[h as keyof typeof r])).join(',')),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GST_Reconcile_AuditTrail_${selectedClient?.gstin ?? selectedClientId}_${selectedPeriodId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast({
      tone: 'success',
      title: 'Audit trail CSV exported',
      description: `${logs.length} compliance log entries exported.`,
    });
  };

  const handleExportExcel = () => {
    const rows = buildExportRows();
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Audit_Trail');
    XLSX.writeFile(
      wb,
      `GST_Reconcile_AuditTrail_${selectedClient?.gstin ?? selectedClientId}_${selectedPeriodId}.xlsx`
    );
    pushToast({
      tone: 'success',
      title: 'Audit trail Excel exported',
      description: `${logs.length} compliance log entries exported as .xlsx.`,
    });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] lg:flex-row lg:items-center">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-[#0F172A]">
            Compliance Audit Trail
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Immutable operational history of extractions, imports, reconciliation runs, exception status transitions, and approvals for{' '}
            <span className="font-medium text-slate-700">{selectedClient?.tradeName}</span> (
            {scope === 'PERIOD' ? selectedPeriod?.label : 'All Periods'}).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={logs.length === 0 || loading}
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            disabled={logs.length === 0 || loading}
            onClick={handleExportExcel}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#0F2744] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span>Export Excel</span>
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-slate-200 bg-slate-100 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setScope('PERIOD')}
              className={`rounded px-2.5 py-1 font-medium ${
                scope === 'PERIOD' ? 'bg-white text-[#0F172A] shadow-xs' : 'text-slate-600'
              }`}
            >
              {selectedPeriod?.shortLabel ?? 'Current Period'}
            </button>
            <button
              type="button"
              onClick={() => setScope('ALL')}
              className={`rounded px-2.5 py-1 font-medium ${
                scope === 'ALL' ? 'bg-white text-[#0F172A] shadow-xs' : 'text-slate-600'
              }`}
            >
              All Periods
            </button>
          </div>

          <select
            aria-label="Filter by entity type"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-[#1D4ED8] focus:outline-none"
          >
            {ENTITY_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search actor, action, invoice, summary..."
              className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-[#0F172A] placeholder:text-slate-400 focus:border-[#1D4ED8] focus:outline-none"
            />
          </div>
          <span className="font-mono text-[11px] text-slate-500 tabular-nums whitespace-nowrap">
            {logs.length} events
          </span>
        </div>
      </div>

      {/* Audit Log Ledger */}
      {loading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-xs text-slate-500">
          Loading compliance audit trail...
        </div>
      ) : logs.length === 0 ? (
        <EmptyState
          title="No audit events match your filter"
          description="Try switching to All Periods or clearing the search filter to inspect historical workspace actions."
        />
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2.5 whitespace-nowrap">Timestamp</th>
                <th className="px-4 py-2.5">User / Actor</th>
                <th className="px-4 py-2.5">Action Performed</th>
                <th className="px-4 py-2.5">Affected Record</th>
                <th className="px-4 py-2.5">Previous State</th>
                <th className="px-4 py-2.5">Updated State</th>
                <th className="px-4 py-2.5">Approval Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((log) => {
                const badge =
                  APPROVAL_BADGE[log.approvalStatus ?? 'AUTO_LOGGED'] ?? APPROVAL_BADGE.AUTO_LOGGED;
                return (
                  <tr key={log.id} className="hover:bg-slate-50/70 align-top">
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-500 whitespace-nowrap tabular-nums">
                      {new Date(log.createdAt).toLocaleString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-[#0F172A]">{log.actor}</div>
                      <div className="font-mono text-[10px] text-slate-400">{log.periodId}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold text-[#0F2744]">
                        <History className="h-3 w-3 text-slate-400 shrink-0" />
                        <span>{log.action}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500 max-w-xs">
                        {log.summary}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-700 max-w-[180px] break-words">
                      {log.affectedRecord || log.entityId}
                    </td>
                    <td className="px-4 py-3 text-[11px] text-slate-500 max-w-[140px]">
                      {log.previousState || '—'}
                    </td>
                    <td className="px-4 py-3 text-[11px] font-medium text-[#0F172A] max-w-[180px]">
                      {log.updatedState || log.summary}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={badge.tone} label={badge.label} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
