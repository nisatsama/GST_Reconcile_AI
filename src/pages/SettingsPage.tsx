import React, { useEffect, useState } from 'react';
import { Building2, Check, Database, Plus, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { api } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { useWorkspace } from '../context/WorkspaceContext';
import type { UserRoleView } from '../shared/types';

export function SettingsPage() {
  const {
    workspace,
    clients,
    selectedClientId,
    reconciliationConfig,
    geminiConfigured,
    refreshAll,
    resetDemo,
    setSelectedClientId,
    setUserRoleView,
  } = useWorkspace();
  const { pushToast } = useToast();

  const [dateTol, setDateTol] = useState(reconciliationConfig.dateToleranceDays);
  const [amtTol, setAmtTol] = useState(reconciliationConfig.amountToleranceRupees);
  const [fuzzyEnabled, setFuzzyEnabled] = useState(reconciliationConfig.enableFuzzyMatch);
  const [fuzzyThreshold, setFuzzyThreshold] = useState(
    reconciliationConfig.fuzzySimilarityThreshold
  );

  useEffect(() => {
    setDateTol(reconciliationConfig.dateToleranceDays);
    setAmtTol(reconciliationConfig.amountToleranceRupees);
    setFuzzyEnabled(reconciliationConfig.enableFuzzyMatch);
    setFuzzyThreshold(reconciliationConfig.fuzzySimilarityThreshold);
  }, [reconciliationConfig]);

  // Add client form
  const [legalName, setLegalName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [gstin, setGstin] = useState('');
  const [stateName, setStateName] = useState('West Bengal');
  const [sector, setSector] = useState('Retail & Distribution');
  const [contactEmail, setContactEmail] = useState('');

  const [saving, setSaving] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleSaveTolerances = async () => {
    setSaving(true);
    try {
      await api.updateWorkspaceConfig({
        reconciliationConfig: {
          dateToleranceDays: Number(dateTol),
          amountToleranceRupees: Number(amtTol),
          enableFuzzyMatch: fuzzyEnabled,
          fuzzySimilarityThreshold: Number(fuzzyThreshold),
        },
      });
      await refreshAll();
      pushToast({
        tone: 'success',
        title: 'Matching tolerances saved',
        description: 'Default deterministic reconciliation thresholds updated.',
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Failed to save configuration.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRoleChange = async (role: UserRoleView) => {
    try {
      await setUserRoleView(role);
      pushToast({
        tone: 'info',
        title: 'Role perspective updated',
        description: `Workspace switched to ${role.replace('_', ' ')} mode.`,
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Role switch failed',
        description: err instanceof Error ? err.message : 'Unable to switch role view.',
      });
    }
  };

  const handleConfirmReset = async () => {
    setResetting(true);
    try {
      await resetDemo();
      setResetConfirmOpen(false);
      pushToast({
        tone: 'success',
        title: 'Demo dataset reset',
        description: 'Clean seeded data restored across all clients and GST periods.',
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Reset failed',
        description: err instanceof Error ? err.message : 'Unable to reset workspace.',
      });
    } finally {
      setResetting(false);
    }
  };

  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.createClient({
        legalName,
        tradeName: tradeName || legalName,
        gstin,
        stateName,
        sector,
        contactEmail,
      });
      setLegalName('');
      setTradeName('');
      setGstin('');
      setContactEmail('');
      await refreshAll();
      setSelectedClientId(res.client.id);
      pushToast({
        tone: 'success',
        title: 'Client GST workspace created',
        description: `${res.client.tradeName} (${res.client.gstin}) is now active.`,
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Could not create client',
        description: err instanceof Error ? err.message : 'Validation failed.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <h1 className="font-display text-xl font-bold tracking-tight text-[#0F172A]">
          Workspace, GST Registrations & Engine Settings
        </h1>
        <p className="mt-0.5 text-xs text-slate-500">
          Manage CA firm client GSTIN workspaces, user perspective controls, deterministic matching tolerances, and demo dataset persistence.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Persistence, Role & Demo Reset */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-4">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-[#0F2744]" />
            <h2 className="font-display text-sm font-semibold text-[#0F172A]">
              Workspace Runtime & Role Perspective
            </h2>
          </div>

          <div className="space-y-2 text-xs text-slate-500">
            <div className="flex justify-between border-b border-slate-100 py-1.5">
              <span>Workspace Name</span>
              <span className="font-medium text-[#0F172A]">{workspace?.name}</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 py-1.5">
              <span>Data Persistence Mode</span>
              <span className="font-mono font-medium text-amber-700">
                Server JSON Store (Demo Mode)
              </span>
            </div>
            <div className="flex justify-between border-b border-slate-100 py-1.5">
              <span>Server-Side Gemini Extraction</span>
              <span
                className={`font-mono font-semibold ${
                  geminiConfigured ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {geminiConfigured ? 'Configured (Server-Side)' : 'Not Configured'}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">
              Active User Role Perspective
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'CA_FIRM', label: 'CA Firm Partner' },
                  { id: 'ACCOUNTANT', label: 'Senior Accountant' },
                  { id: 'MSME', label: 'MSME Finance' },
                ] as const
              ).map((r) => {
                const active = workspace?.userRoleView === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => void handleRoleChange(r.id)}
                    className={`rounded-md border px-2.5 py-2 text-xs font-medium transition-colors ${
                      active
                        ? 'border-[#1D4ED8] bg-blue-50/50 text-[#1D4ED8]'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-1">
            <button
              type="button"
              onClick={() => setResetConfirmOpen(true)}
              className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset Demo Dataset to Clean Seed</span>
            </button>
          </div>
        </div>

        {/* Reconciliation Defaults */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#0F2744]" />
            <h2 className="font-display text-sm font-semibold text-[#0F172A]">
              Default Deterministic Matching Tolerances
            </h2>
          </div>
          <p className="text-xs text-slate-500">
            All numeric comparisons run deterministically. Uncertain fuzzy candidates always require explicit CA approval.
          </p>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block font-medium text-slate-600">Date Tolerance (Days)</label>
              <input
                type="number"
                min={0}
                max={30}
                value={dateTol}
                onChange={(e) => setDateTol(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 font-mono text-[#0F172A] focus:border-[#1D4ED8] focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-600">Rounding Tolerance (₹)</label>
              <input
                type="number"
                min={0}
                max={1000}
                value={amtTol}
                onChange={(e) => setAmtTol(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 font-mono text-[#0F172A] focus:border-[#1D4ED8] focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-600">Fuzzy Similarity Threshold</label>
              <input
                type="number"
                step={0.05}
                min={0.5}
                max={0.95}
                value={fuzzyThreshold}
                onChange={(e) => setFuzzyThreshold(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 font-mono text-[#0F172A] focus:border-[#1D4ED8] focus:outline-none"
              />
            </div>
            <div className="flex items-end">
              <label className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-slate-700">
                <input
                  type="checkbox"
                  checked={fuzzyEnabled}
                  onChange={(e) => setFuzzyEnabled(e.target.checked)}
                />
                <span>Enable Fuzzy Candidates</span>
              </label>
            </div>
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSaveTolerances()}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#0F2744] px-4 py-2 text-xs font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            <span>Save Matching Defaults</span>
          </button>
        </div>
      </div>

      {/* Client GST Registrations + Add Client */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] lg:col-span-7">
          <div className="mb-3 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-[#0F2744]" />
            <h2 className="font-display text-sm font-semibold text-[#0F172A]">
              Active Client GST Workspaces ({clients.length})
            </h2>
          </div>
          <div className="divide-y divide-slate-100 text-xs">
            {clients.map((c) => {
              const isCurrent = c.id === selectedClientId;
              return (
                <div key={c.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[#0F172A]">{c.legalName}</span>
                      {isCurrent && (
                        <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-[#1D4ED8]">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-slate-500">
                      <span className="font-mono text-[#0F2744]">{c.gstin}</span> · {c.stateName} ·{' '}
                      {c.sector}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isCurrent}
                    onClick={() => {
                      setSelectedClientId(c.id);
                      pushToast({
                        tone: 'info',
                        title: 'Switched GST workspace',
                        description: `${c.tradeName} (${c.gstin})`,
                      });
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 font-medium text-[#0F2744] hover:bg-slate-50 disabled:opacity-45"
                  >
                    <Check className="h-3 w-3" />
                    <span>{isCurrent ? 'Selected' : 'Switch'}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <form
          onSubmit={handleAddClient}
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-3 lg:col-span-5"
        >
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-[#0F2744]" />
            <h2 className="font-display text-sm font-semibold text-[#0F172A]">
              Add Client GST Registration
            </h2>
          </div>
          <div className="space-y-2.5 text-xs">
            <div>
              <label className="font-medium text-slate-600">Legal Business Name *</label>
              <input
                required
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder="e.g., Horizon Textiles Pvt Ltd"
                className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-[#0F172A] focus:border-[#1D4ED8] focus:outline-none"
              />
            </div>
            <div>
              <label className="font-medium text-slate-600">Trade Name</label>
              <input
                value={tradeName}
                onChange={(e) => setTradeName(e.target.value)}
                placeholder="e.g., Horizon Textiles"
                className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-[#0F172A] focus:border-[#1D4ED8] focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="font-medium text-slate-600">15-Char GSTIN *</label>
                <input
                  required
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value.toUpperCase())}
                  placeholder="19AABCH1234F1Z2"
                  className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 font-mono text-[#0F172A] focus:border-[#1D4ED8] focus:outline-none"
                />
              </div>
              <div>
                <label className="font-medium text-slate-600">State *</label>
                <input
                  required
                  value={stateName}
                  onChange={(e) => setStateName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-[#0F172A] focus:border-[#1D4ED8] focus:outline-none"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="font-medium text-slate-600">Sector</label>
                <input
                  value={sector}
                  onChange={(e) => setSector(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-[#0F172A] focus:border-[#1D4ED8] focus:outline-none"
                />
              </div>
              <div>
                <label className="font-medium text-slate-600">Accounts Email *</label>
                <input
                  required
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="accounts@client.demo"
                  className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-[#0F172A] focus:border-[#1D4ED8] focus:outline-none"
                />
              </div>
            </div>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-md bg-[#0F2744] px-4 py-2 text-xs font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            Create Isolated Client Workspace
          </button>
        </form>
      </div>

      <ConfirmDialog
        open={resetConfirmOpen}
        tone="danger"
        title="Reset Demo Workspace Dataset"
        description="This restores all seeded sample clients, invoices, purchase registers, GSTR-2B filings, discrepancies, follow-ups, and audit logs back to the initial demonstration seed."
        confirmLabel="Reset Dataset"
        busy={resetting}
        onCancel={() => setResetConfirmOpen(false)}
        onConfirm={handleConfirmReset}
      />
    </div>
  );
}
