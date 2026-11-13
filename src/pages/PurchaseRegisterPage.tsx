import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Download,
  Edit3,
  FileSpreadsheet,
  Search,
  Upload,
} from 'lucide-react';
import { api } from '../api/client';
import { EmptyState, StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/ToastProvider';
import { useWorkspace } from '../context/WorkspaceContext';
import type {
  ImportRowError,
  PurchaseRegisterEntry,
  PurchaseRegisterImport,
} from '../shared/types';
import { formatINR } from '../shared/validation';

const PR_FIELDS = [
  { key: 'supplierGstin', label: 'Supplier GSTIN *' },
  { key: 'supplierName', label: 'Supplier Name *' },
  { key: 'invoiceNumber', label: 'Invoice Number *' },
  { key: 'invoiceDate', label: 'Invoice Date *' },
  { key: 'taxableValue', label: 'Taxable Value *' },
  { key: 'cgst', label: 'CGST' },
  { key: 'sgst', label: 'SGST' },
  { key: 'igst', label: 'IGST' },
  { key: 'cess', label: 'Cess' },
  { key: 'totalInvoiceValue', label: 'Total Invoice Value' },
];

export function PurchaseRegisterPage({ embedded = false }: { embedded?: boolean }) {
  const { selectedClientId, selectedPeriodId, selectedClient, selectedPeriod, refreshAll } =
    useWorkspace();
  const { pushToast } = useToast();

  const [imports, setImports] = useState<PurchaseRegisterImport[]>([]);
  const [entries, setEntries] = useState<PurchaseRegisterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [validityFilter, setValidityFilter] = useState<'ALL' | 'VALID' | 'INVALID'>('ALL');
  const [dragActive, setDragActive] = useState(false);

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [sampleRows, setSampleRows] = useState<Record<string, unknown>[]>([]);
  const [totalPreviewRows, setTotalPreviewRows] = useState(0);
  const [importing, setImporting] = useState(false);
  const [lastErrors, setLastErrors] = useState<ImportRowError[]>([]);

  const [editingEntry, setEditingEntry] = useState<PurchaseRegisterEntry | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getPurchaseRegister(selectedClientId, selectedPeriodId);
      setImports(res.imports);
      setEntries(res.entries);
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Failed to load Purchase Register',
        description: err instanceof Error ? err.message : 'Unable to fetch records.',
      });
    } finally {
      setLoading(false);
    }
  }, [selectedClientId, selectedPeriodId, pushToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleFileSelect = async (file: File | undefined) => {
    if (!file) return;
    try {
      const preview = await api.previewPurchaseRegister(file);
      setPendingFile(file);
      setHeaders(preview.headers);
      setMapping(preview.detectedMapping);
      setSampleRows(preview.sampleRows);
      setTotalPreviewRows(preview.totalRows);
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Spreadsheet preview failed',
        description: err instanceof Error ? err.message : 'Could not inspect spreadsheet headers.',
      });
    }
  };

  const handleConfirmImport = async () => {
    if (!pendingFile) return;
    setImporting(true);
    try {
      const res = await api.importPurchaseRegister(
        selectedClientId,
        selectedPeriodId,
        pendingFile,
        mapping
      );
      setPendingFile(null);
      setSampleRows([]);
      setLastErrors(res.errors);
      await loadData();
      await refreshAll();
      pushToast({
        tone: 'success',
        title: `Imported ${res.entriesAdded} Purchase Register rows`,
        description: `${res.importRecord.fileName} (${res.importRecord.duplicateCount} duplicate(s) skipped).`,
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Import failed',
        description: err instanceof Error ? err.message : 'Unable to import rows.',
      });
    } finally {
      setImporting(false);
    }
  };

  const handleSaveEntryEdit = async () => {
    if (!editingEntry) return;
    try {
      await api.updatePurchaseEntry(editingEntry.id, {
        supplierGstin: editingEntry.supplierGstin,
        supplierName: editingEntry.supplierName,
        invoiceNumber: editingEntry.invoiceNumber,
        invoiceDate: editingEntry.invoiceDate,
        taxableValue: Number(editingEntry.taxableValue) || 0,
        cgst: Number(editingEntry.cgst) || 0,
        sgst: Number(editingEntry.sgst) || 0,
        igst: Number(editingEntry.igst) || 0,
        cess: Number(editingEntry.cess) || 0,
      });
      setEditingEntry(null);
      await loadData();
      pushToast({
        tone: 'success',
        title: 'Purchase Register entry updated',
        description: 'Row re-validated and saved to ledger.',
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Update failed',
        description: err instanceof Error ? err.message : 'Could not save entry.',
      });
    }
  };

  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      if (validityFilter === 'VALID' && !e.isValid) return false;
      if (validityFilter === 'INVALID' && e.isValid) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const hay = `${e.invoiceNumber} ${e.supplierName} ${e.supplierGstin}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, validityFilter, search]);

  return (
    <div className="space-y-5">
      {!embedded && (
        <div className="flex flex-col justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] lg:flex-row lg:items-center">
          <div>
            <h1 className="font-display text-xl font-bold text-[#0F172A]">
              Purchase Register Import & Ledger
            </h1>
            <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">
              Import CSV or XLSX accounting purchase registers for {selectedClient?.tradeName} ({selectedPeriod?.label}).
            </p>
          </div>
        </div>
      )}

      {/* Drag & Drop + Sample Template Strip */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          void handleFileSelect(e.dataTransfer.files?.[0]);
        }}
        className={`rounded-lg border-2 border-dashed p-5 transition-colors ${
          dragActive ? 'border-[#1D4ED8] bg-blue-50/40' : 'border-slate-300 bg-white'
        }`}
      >
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-[#0F2744]">
              <FileSpreadsheet className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[#0F172A]">
                Drop Purchase Register CSV or XLSX file here
              </div>
              <div className="text-xs text-slate-500">
                Automatic column detection, GSTIN validation & duplicate detection · Max 10 MB
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <a
              href="/api/templates/purchase-register/csv"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-[#0F172A] hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Sample CSV</span>
            </a>
            <a
              href="/api/templates/purchase-register/xlsx"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-[#0F172A] hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Sample XLSX</span>
            </a>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-[#0F2744] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8]">
              <Upload className="h-3.5 w-3.5" />
              <span>Import CSV / XLSX</span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  void handleFileSelect(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </div>
      </div>

      {/* Column Mapping & Sample Rows Preview */}
      {pendingFile && (
        <div className="rounded-lg border border-[#1D4ED8] bg-white p-5 space-y-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-sm font-semibold text-[#0F172A]">
                Column Mapping & Preview — {pendingFile.name}
              </h2>
              <p className="text-xs text-slate-500">
                Detected {totalPreviewRows} row(s). Verify column alignment before validating and importing.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setPendingFile(null);
                  setSampleRows([]);
                }}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-[#0F172A]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={importing}
                onClick={handleConfirmImport}
                className="rounded-md bg-emerald-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {importing ? 'Importing...' : 'Confirm & Import Rows'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {PR_FIELDS.map((f) => (
              <div key={f.key}>
                <label className="block text-xs font-medium text-[#0F172A]">{f.label}</label>
                <select
                  value={mapping[f.key] ?? ''}
                  onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                >
                  <option value="">— Not mapped —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {sampleRows.length > 0 && (
            <div className="overflow-x-auto rounded border border-slate-200">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    {headers.slice(0, 7).map((h) => (
                      <th key={h} className="px-3 py-1.5 font-semibold whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sampleRows.slice(0, 3).map((row, i) => (
                    <tr key={i}>
                      {headers.slice(0, 7).map((h) => (
                        <td key={h} className="px-3 py-1.5 font-mono text-slate-700 truncate max-w-[160px]">
                          {String(row[h] ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {lastErrors.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-900">
            <AlertTriangle className="h-4 w-4" />
            <span>Import Validation Notes ({lastErrors.length})</span>
          </div>
          <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto text-xs text-amber-900">
            {lastErrors.map((err, i) => (
              <li key={i}>
                Row {err.rowNumber} ({err.field}): {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {imports.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Import History ({selectedPeriod?.label})
          </h2>
          <div className="divide-y divide-slate-100 text-xs">
            {imports.map((imp) => (
              <div key={imp.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-[#0F766E]" />
                  <span className="font-medium text-[#0F172A]">{imp.fileName}</span>
                  <span className="text-slate-500">· {imp.rowCount} rows</span>
                </div>
                <div className="flex items-center gap-4 font-mono text-slate-500">
                  <span className="text-emerald-700">{imp.validCount} valid</span>
                  {imp.invalidCount > 0 && (
                    <span className="text-red-700">{imp.invalidCount} invalid</span>
                  )}
                  {imp.duplicateCount > 0 && (
                    <span className="text-amber-700">{imp.duplicateCount} duplicate</span>
                  )}
                  <span>{new Date(imp.createdAt).toLocaleDateString('en-IN')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filterable Ledger Table */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search supplier, GSTIN, invoice..."
              className="w-full rounded-md border border-slate-200 py-1.5 pl-8 pr-3 text-xs focus:border-[#1D4ED8] focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1 text-xs">
            {(['ALL', 'VALID', 'INVALID'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setValidityFilter(tab)}
                className={`rounded px-2.5 py-1 font-medium ${
                  validityFilter === tab
                    ? 'bg-white text-[#0F172A] shadow-sm'
                    : 'text-slate-600 hover:text-[#0F172A]'
                }`}
              >
                {tab === 'ALL' ? `All (${entries.length})` : tab === 'VALID' ? 'Valid' : 'Invalid'}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500">Loading Purchase Register...</div>
        ) : filteredEntries.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No Purchase Register records"
              description="Import a CSV or XLSX Purchase Register spreadsheet for this reporting period."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/80 font-semibold text-slate-600">
                <tr>
                  <th className="px-4 py-2.5">Invoice No</th>
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Supplier</th>
                  <th className="px-4 py-2.5">GSTIN</th>
                  <th className="px-4 py-2.5 text-right">Taxable</th>
                  <th className="px-4 py-2.5 text-right">CGST</th>
                  <th className="px-4 py-2.5 text-right">SGST</th>
                  <th className="px-4 py-2.5 text-right">IGST</th>
                  <th className="px-4 py-2.5 text-right">Total</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5 text-right">Edit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredEntries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono font-semibold text-[#0F2744]">
                      {entry.invoiceNumber}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-600">{entry.invoiceDate}</td>
                    <td className="px-4 py-2.5 text-[#0F172A]">{entry.supplierName}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-600">{entry.supplierGstin}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {formatINR(entry.taxableValue)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {formatINR(entry.cgst)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {formatINR(entry.sgst)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {formatINR(entry.igst)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums">
                      {formatINR(entry.totalInvoiceValue)}
                    </td>
                    <td className="px-4 py-2.5">
                      {entry.isValid ? (
                        <StatusBadge tone="green" label="Valid" />
                      ) : (
                        <StatusBadge
                          tone="red"
                          label={entry.validationErrors[0] || 'Invalid'}
                        />
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => setEditingEntry(entry)}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] text-[#0F172A] hover:bg-slate-100"
                      >
                        <Edit3 className="h-3 w-3" />
                        <span>Fix</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Inline Row Correction Modal */}
      {editingEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-lg space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="font-display text-base font-semibold text-[#0F172A]">
              Edit Purchase Register Entry
            </h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="font-medium text-slate-600">Supplier GSTIN</label>
                <input
                  value={editingEntry.supplierGstin}
                  onChange={(e) =>
                    setEditingEntry({
                      ...editingEntry,
                      supplierGstin: e.target.value.toUpperCase(),
                    })
                  }
                  className="mt-1 w-full rounded border border-slate-200 px-2.5 py-1.5 font-mono"
                />
              </div>
              <div>
                <label className="font-medium text-slate-600">Invoice Number</label>
                <input
                  value={editingEntry.invoiceNumber}
                  onChange={(e) =>
                    setEditingEntry({ ...editingEntry, invoiceNumber: e.target.value })
                  }
                  className="mt-1 w-full rounded border border-slate-200 px-2.5 py-1.5 font-mono"
                />
              </div>
              <div className="col-span-2">
                <label className="font-medium text-slate-600">Supplier Name</label>
                <input
                  value={editingEntry.supplierName}
                  onChange={(e) =>
                    setEditingEntry({ ...editingEntry, supplierName: e.target.value })
                  }
                  className="mt-1 w-full rounded border border-slate-200 px-2.5 py-1.5"
                />
              </div>
              <div>
                <label className="font-medium text-slate-600">Invoice Date</label>
                <input
                  value={editingEntry.invoiceDate}
                  onChange={(e) =>
                    setEditingEntry({ ...editingEntry, invoiceDate: e.target.value })
                  }
                  className="mt-1 w-full rounded border border-slate-200 px-2.5 py-1.5 font-mono"
                />
              </div>
              <div>
                <label className="font-medium text-slate-600">Taxable Value (₹)</label>
                <input
                  type="number"
                  value={editingEntry.taxableValue}
                  onChange={(e) =>
                    setEditingEntry({ ...editingEntry, taxableValue: Number(e.target.value) })
                  }
                  className="mt-1 w-full rounded border border-slate-200 px-2.5 py-1.5 font-mono"
                />
              </div>
              <div>
                <label className="font-medium text-slate-600">CGST (₹)</label>
                <input
                  type="number"
                  value={editingEntry.cgst}
                  onChange={(e) =>
                    setEditingEntry({ ...editingEntry, cgst: Number(e.target.value) })
                  }
                  className="mt-1 w-full rounded border border-slate-200 px-2.5 py-1.5 font-mono"
                />
              </div>
              <div>
                <label className="font-medium text-slate-600">SGST (₹)</label>
                <input
                  type="number"
                  value={editingEntry.sgst}
                  onChange={(e) =>
                    setEditingEntry({ ...editingEntry, sgst: Number(e.target.value) })
                  }
                  className="mt-1 w-full rounded border border-slate-200 px-2.5 py-1.5 font-mono"
                />
              </div>
              <div>
                <label className="font-medium text-slate-600">IGST (₹)</label>
                <input
                  type="number"
                  value={editingEntry.igst}
                  onChange={(e) =>
                    setEditingEntry({ ...editingEntry, igst: Number(e.target.value) })
                  }
                  className="mt-1 w-full rounded border border-slate-200 px-2.5 py-1.5 font-mono"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingEntry(null)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEntryEdit}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#0F2744] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#1D4ED8]"
              >
                <Check className="h-3.5 w-3.5" />
                <span>Save Correction</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
