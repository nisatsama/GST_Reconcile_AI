import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Check,
  CheckCircle2,
  Copy,
  Mail,
  MessageSquare,
  Search,
  Send,
  ShieldAlert,
} from 'lucide-react';
import { api } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState, StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/ToastProvider';
import { useWorkspace } from '../context/WorkspaceContext';
import type { FollowUpStatus, SupplierFollowUp } from '../shared/types';
import { formatINR } from '../shared/validation';

interface SupplierSummary {
  id: string;
  gstin: string;
  legalName: string;
  email: string;
  phone: string;
  stateName: string;
  category: string;
  invoiceCount: number;
  matchedRate: number;
  totalDiscrepancies: number;
  openDiscrepancies: number;
  pendingResponses: number;
  recurringPeriodsCount: number;
  isRecurring: boolean;
  totalTaxUnderInvestigation: number;
}

const FOLLOWUP_TONE: Record<FollowUpStatus, 'neutral' | 'blue' | 'amber' | 'green'> = {
  DRAFT: 'neutral',
  APPROVED: 'blue',
  SENT_MANUALLY: 'amber',
  AWAITING_RESPONSE: 'amber',
  RESOLVED: 'green',
  CLOSED: 'green',
};

export function SuppliersPage() {
  const { selectedClientId, selectedPeriodId, selectedClient, selectedPeriod, refreshAll } =
    useWorkspace();
  const { pushToast } = useToast();
  const [searchParams] = useSearchParams();

  const [suppliers, setSuppliers] = useState<SupplierSummary[]>([]);
  const [followUps, setFollowUps] = useState<SupplierFollowUp[]>([]);
  const queryFollowUpId = searchParams.get('followup');
  const queryTab = searchParams.get('tab');

  const [selectedFuId, setSelectedFuId] = useState<string | null>(queryFollowUpId);
  const [tab, setTab] = useState<'DIRECTORY' | 'FOLLOWUPS'>(
    queryFollowUpId || queryTab === 'FOLLOWUPS' ? 'FOLLOWUPS' : 'DIRECTORY'
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  // Directory filters
  const [dirSearch, setDirSearch] = useState('');
  const [recurringOnly, setRecurringOnly] = useState(false);
  const [supplierFilterGstin, setSupplierFilterGstin] = useState<string | null>(null);

  // Confirmation modal for status transitions
  const [pendingTransition, setPendingTransition] = useState<{
    status: FollowUpStatus;
    title: string;
    description: string;
    confirmLabel: string;
  } | null>(null);

  useEffect(() => {
    if (queryFollowUpId) {
      setSelectedFuId(queryFollowUpId);
      setTab('FOLLOWUPS');
    }
  }, [queryFollowUpId]);

  // Editable draft state
  const [channel, setChannel] = useState<'EMAIL' | 'WHATSAPP'>('EMAIL');
  const [subject, setSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [whatsappBody, setWhatsappBody] = useState('');
  const [responseNotes, setResponseNotes] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [supRes, fuRes] = await Promise.all([
        api.getSuppliers(selectedClientId),
        api.getFollowUps(selectedClientId, selectedPeriodId),
      ]);
      setSuppliers(supRes.suppliers);
      setFollowUps(fuRes.followUps);
      setSelectedFuId((prev) => {
        if (prev && fuRes.followUps.some((f) => f.id === prev)) return prev;
        return fuRes.followUps[0]?.id ?? null;
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Unable to load supplier records',
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setLoading(false);
    }
  }, [selectedClientId, selectedPeriodId, pushToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredSuppliers = useMemo(() => {
    const q = dirSearch.trim().toLowerCase();
    return suppliers.filter((s) => {
      if (recurringOnly && !s.isRecurring) return false;
      if (!q) return true;
      return (
        s.legalName.toLowerCase().includes(q) ||
        s.gstin.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q)
      );
    });
  }, [suppliers, dirSearch, recurringOnly]);

  const visibleFollowUps = useMemo(() => {
    if (!supplierFilterGstin) return followUps;
    return followUps.filter((f) => f.supplierGstin === supplierFilterGstin);
  }, [followUps, supplierFilterGstin]);

  const selectedFu = useMemo(
    () =>
      visibleFollowUps.find((f) => f.id === selectedFuId) ?? visibleFollowUps[0] ?? null,
    [visibleFollowUps, selectedFuId]
  );

  useEffect(() => {
    if (selectedFu) {
      setChannel(selectedFu.channel);
      setSubject(selectedFu.subject);
      setEmailBody(selectedFu.emailBody);
      setWhatsappBody(selectedFu.whatsappBody);
      setResponseNotes(selectedFu.responseNotes ?? '');
    }
  }, [selectedFu]);

  const handleSaveAndTransition = async (nextStatus?: FollowUpStatus) => {
    if (!selectedFu) return;
    setSaving(true);
    try {
      const res = await api.updateFollowUp(selectedFu.id, {
        channel,
        subject,
        emailBody,
        whatsappBody,
        responseNotes,
        status: nextStatus,
      });
      setFollowUps((prev) => prev.map((f) => (f.id === res.followUp.id ? res.followUp : f)));
      await refreshAll();
      pushToast({
        tone: 'success',
        title: nextStatus
          ? `Follow-up status set to ${nextStatus.replace(/_/g, ' ')}`
          : 'Follow-up draft saved',
        description: `${res.followUp.invoiceNumber} · ${res.followUp.supplierName}`,
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Update failed',
        description: err instanceof Error ? err.message : 'Unable to save changes.',
      });
    } finally {
      setSaving(false);
      setPendingTransition(null);
    }
  };

  const handleCopy = async () => {
    const textToCopy =
      channel === 'EMAIL' ? `Subject: ${subject}\n\n${emailBody}` : whatsappBody;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      pushToast({
        tone: 'success',
        title: `${channel === 'EMAIL' ? 'Email' : 'WhatsApp'} draft copied`,
        description: 'Ready to paste into your verified external communication channel.',
      });
    } catch {
      pushToast({
        tone: 'warning',
        title: 'Clipboard access blocked',
        description: 'Select and copy the message text manually from the editor.',
      });
    }
  };

  const openSupplierFollowUps = (gstin: string) => {
    setSupplierFilterGstin(gstin);
    const matching = followUps.find((f) => f.supplierGstin === gstin);
    if (matching) setSelectedFuId(matching.id);
    setTab('FOLLOWUPS');
  };

  return (
    <div className="space-y-5">
      {/* Header & Segmented Switch */}
      <div className="flex flex-col justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] lg:flex-row lg:items-center">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-[#0F172A]">
            Supplier Management & Follow-Up Queue
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Monitor vendor match performance, recurring filing discrepancies, and human-approved supplier communications for{' '}
            <span className="font-medium text-slate-700">{selectedClient?.tradeName}</span> (
            {selectedPeriod?.label}).
          </p>
        </div>

        <div className="inline-flex rounded-md border border-slate-200 bg-slate-100/80 p-1 text-xs shrink-0">
          <button
            type="button"
            onClick={() => setTab('DIRECTORY')}
            className={`rounded px-3 py-1.5 font-medium transition-colors ${
              tab === 'DIRECTORY'
                ? 'bg-white text-[#0F172A] shadow-xs'
                : 'text-slate-600 hover:text-[#0F172A]'
            }`}
          >
            Supplier Directory ({suppliers.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('FOLLOWUPS')}
            className={`rounded px-3 py-1.5 font-medium transition-colors ${
              tab === 'FOLLOWUPS'
                ? 'bg-white text-[#0F172A] shadow-xs'
                : 'text-slate-600 hover:text-[#0F172A]'
            }`}
          >
            Follow-Up Queue ({followUps.length})
          </button>
        </div>
      </div>

      {/* Human-in-the-loop Governance Notice */}
      <div className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-2.5 text-xs text-slate-600">
        <ShieldAlert className="h-4 w-4 text-[#0F2744] shrink-0" />
        <span>
          Human-in-the-Loop Governance: GST Reconcile AI never sends emails or WhatsApp messages automatically. Edit, approve, copy, and mark follow-ups sent manually via your firm&apos;s verified channels.
        </span>
      </div>

      {tab === 'DIRECTORY' ? (
        <div className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          {/* Directory Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={dirSearch}
                onChange={(e) => setDirSearch(e.target.value)}
                placeholder="Filter by supplier name, GSTIN, or category..."
                className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-[#0F172A] placeholder:text-slate-400 focus:border-[#1D4ED8] focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-3 text-xs">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-700 hover:bg-slate-100">
                <input
                  type="checkbox"
                  checked={recurringOnly}
                  onChange={(e) => setRecurringOnly(e.target.checked)}
                  className="rounded border-slate-300 text-[#0F2744]"
                />
                <span>Recurring Mismatches Only</span>
              </label>
              <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                {filteredSuppliers.length} of {suppliers.length} suppliers
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            {loading ? (
              <div className="p-8 text-center text-xs text-slate-500">
                Loading supplier metrics...
              </div>
            ) : filteredSuppliers.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No suppliers match your current filter.
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">Supplier</th>
                    <th className="px-4 py-2.5">GSTIN</th>
                    <th className="px-4 py-2.5 text-right">Total Invoices</th>
                    <th className="px-4 py-2.5 text-right">Matched %</th>
                    <th className="px-4 py-2.5 text-right">Open Discrepancies</th>
                    <th className="px-4 py-2.5 text-right">Pending Responses</th>
                    <th className="px-4 py-2.5">Recurring Pattern</th>
                    <th className="px-4 py-2.5 text-right">Tax Under Investigation</th>
                    <th className="px-4 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSuppliers.map((sup) => (
                    <tr key={sup.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <div className="font-medium text-[#0F172A]">{sup.legalName}</div>
                        <div className="text-[11px] text-slate-500">
                          {sup.category} · {sup.email}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-600">{sup.gstin}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-[#0F172A]">
                        {sup.invoiceCount}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={`font-mono font-semibold tabular-nums ${
                            sup.matchedRate >= 90
                              ? 'text-emerald-700'
                              : sup.matchedRate >= 60
                                ? 'text-amber-700'
                                : 'text-red-700'
                          }`}
                        >
                          {sup.matchedRate}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-[#0F172A]">
                        {sup.openDiscrepancies}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                        {sup.pendingResponses}
                      </td>
                      <td className="px-4 py-3">
                        {sup.isRecurring ? (
                          <StatusBadge
                            tone="amber"
                            label={`Recurring (${sup.recurringPeriodsCount} mo)`}
                          />
                        ) : (
                          <span className="text-slate-500">Nominal</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-red-700">
                        {formatINR(sup.totalTaxUnderInvestigation)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => openSupplierFollowUps(sup.gstin)}
                          className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-[#0F2744] hover:border-[#1D4ED8] hover:text-[#1D4ED8]"
                        >
                          Follow-Ups
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : loading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-xs text-slate-500">
          Loading follow-up queue...
        </div>
      ) : visibleFollowUps.length === 0 ? (
        <div className="space-y-3">
          {supplierFilterGstin && (
            <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-2.5 text-xs">
              <span className="text-slate-600">
                Filtered by supplier GSTIN{' '}
                <span className="font-mono font-semibold text-[#0F172A]">
                  {supplierFilterGstin}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setSupplierFilterGstin(null)}
                className="font-medium text-[#1D4ED8] hover:underline"
              >
                Clear supplier filter
              </button>
            </div>
          )}
          <EmptyState
            title="No supplier follow-ups drafted for this selection"
            description="Open any discrepancy in the Exceptions workspace and click 'Draft Supplier Follow-Up' to generate an editable Email and WhatsApp message."
          />
        </div>
      ) : (
        <div className="space-y-3">
          {supplierFilterGstin && (
            <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-2.5 text-xs">
              <span className="text-slate-600">
                Showing follow-ups for GSTIN{' '}
                <span className="font-mono font-semibold text-[#0F172A]">
                  {supplierFilterGstin}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setSupplierFilterGstin(null)}
                className="font-medium text-[#1D4ED8] hover:underline"
              >
                Show all follow-ups ({followUps.length})
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
            {/* Left Queue */}
            <div className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] xl:col-span-4">
              <div className="border-b border-slate-200 px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Communication Queue ({visibleFollowUps.length})
              </div>
              <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
                {visibleFollowUps.map((fu) => (
                  <button
                    key={fu.id}
                    type="button"
                    onClick={() => setSelectedFuId(fu.id)}
                    className={`w-full p-3.5 text-left transition-colors ${
                      fu.id === selectedFu?.id
                        ? 'bg-blue-50/60'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono text-xs font-bold text-[#0F2744]">
                          {fu.invoiceNumber}
                        </div>
                        <div className="mt-0.5 text-xs font-medium text-[#0F172A] truncate">
                          {fu.supplierName}
                        </div>
                      </div>
                      <StatusBadge tone={FOLLOWUP_TONE[fu.status]} label={fu.status} />
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-slate-500 truncate">
                      {fu.supplierGstin} · {fu.supplierEmail}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Right Editor */}
            <div className="xl:col-span-8">
              {selectedFu && (
                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="font-mono text-base font-bold text-[#0F2744]">
                          {selectedFu.invoiceNumber}
                        </h2>
                        <StatusBadge
                          tone={FOLLOWUP_TONE[selectedFu.status]}
                          label={selectedFu.status}
                        />
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {selectedFu.supplierName} ·{' '}
                        <span className="font-mono">{selectedFu.supplierGstin}</span> ·{' '}
                        {selectedFu.supplierEmail}
                      </div>
                    </div>

                    {/* Channel Toggle */}
                    <div className="inline-flex rounded-md border border-slate-200 bg-slate-100 p-1 text-xs">
                      <button
                        type="button"
                        onClick={() => setChannel('EMAIL')}
                        className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-medium ${
                          channel === 'EMAIL'
                            ? 'bg-white text-[#0F172A] shadow-xs'
                            : 'text-slate-600'
                        }`}
                      >
                        <Mail className="h-3.5 w-3.5" />
                        <span>Email Draft</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setChannel('WHATSAPP')}
                        className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-medium ${
                          channel === 'WHATSAPP'
                            ? 'bg-white text-[#0F172A] shadow-xs'
                            : 'text-slate-600'
                        }`}
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        <span>WhatsApp Draft</span>
                      </button>
                    </div>
                  </div>

                  {channel === 'EMAIL' ? (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-600">
                          Email Subject (Editable)
                        </label>
                        <input
                          type="text"
                          value={subject}
                          onChange={(e) => setSubject(e.target.value)}
                          className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-[#0F172A] focus:border-[#1D4ED8] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600">
                          Email Body (Editable)
                        </label>
                        <textarea
                          rows={10}
                          value={emailBody}
                          onChange={(e) => setEmailBody(e.target.value)}
                          className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-xs leading-relaxed text-[#0F172A] focus:border-[#1D4ED8] focus:outline-none"
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-medium text-slate-600">
                        Concise WhatsApp Message (Editable)
                      </label>
                      <textarea
                        rows={6}
                        value={whatsappBody}
                        onChange={(e) => setWhatsappBody(e.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-xs leading-relaxed text-[#0F172A] focus:border-[#1D4ED8] focus:outline-none"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-slate-600">
                      Supplier Response Notes
                    </label>
                    <textarea
                      rows={2}
                      value={responseNotes}
                      onChange={(e) => setResponseNotes(e.target.value)}
                      placeholder="Record supplier reply, revised invoice/credit note details, or GSTR-1 amendment date..."
                      className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-xs text-[#0F172A] focus:border-[#1D4ED8] focus:outline-none"
                    />
                  </div>

                  {/* Action Workflow Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleSaveAndTransition()}
                        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Save Edits
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCopy()}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {copied ? (
                          <Check className="h-3.5 w-3.5 text-emerald-700" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        <span>{copied ? 'Copied' : 'Copy Message'}</span>
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleSaveAndTransition('APPROVED')}
                        className="inline-flex items-center gap-1.5 rounded-md bg-[#1D4ED8] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#1E40AF] disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>Approve Draft</span>
                      </button>
                      <button
                        type="button"
                        disabled={
                          saving || (selectedFu.status !== 'APPROVED' && !selectedFu.approvedAt)
                        }
                        onClick={() =>
                          setPendingTransition({
                            status: 'SENT_MANUALLY',
                            title: 'Confirm Manual Dispatch',
                            description: `Confirm that you have manually sent this ${channel.toLowerCase()} communication for invoice ${selectedFu.invoiceNumber} to ${selectedFu.supplierName}.`,
                            confirmLabel: 'Mark Sent Manually',
                          })
                        }
                        title="Approve draft first before marking sent manually"
                        className="inline-flex items-center gap-1.5 rounded-md bg-[#0F2744] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#1E3A5F] disabled:opacity-45"
                      >
                        <Send className="h-3.5 w-3.5" />
                        <span>Mark Sent Manually</span>
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() =>
                          setPendingTransition({
                            status: 'RESOLVED',
                            title: 'Mark Supplier Follow-Up Resolved',
                            description: `Mark follow-up for invoice ${selectedFu.invoiceNumber} as resolved and log response notes to the audit trail?`,
                            confirmLabel: 'Mark Resolved',
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-md bg-[#0F766E] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#0D5D57] disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Mark Resolved</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingTransition)}
        title={pendingTransition?.title ?? ''}
        description={pendingTransition?.description ?? ''}
        confirmLabel={pendingTransition?.confirmLabel ?? 'Confirm'}
        busy={saving}
        onCancel={() => setPendingTransition(null)}
        onConfirm={() => {
          if (pendingTransition) {
            void handleSaveAndTransition(pendingTransition.status);
          }
        }}
      />
    </div>
  );
}
