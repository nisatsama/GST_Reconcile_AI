import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, Info, Search, Table2, Upload } from 'lucide-react';
import { api } from '../api/client';
import { EmptyState, StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/ToastProvider';
import { useWorkspace } from '../context/WorkspaceContext';
import type { GSTR2BEntry, GSTR2BImport, ImportRowError } from '../shared/types';
import { formatINR } from '../shared/validation';

const GSTR2B_FIELDS = [
  { key: 'supplierGstin', label: 'Supplier GSTIN *' },
  { key: 'supplierName', label: 'Supplier Name' },
  { key: 'documentNumber', label: 'Document Number *' },
  { key: 'documentDate', label: 'Document Date *' },
  { key: 'taxableValue', label: 'Taxable Value *' },
  { key: 'igst', label: 'IGST' },
  { key: 'cgst', label: 'CGST' },
  { key: 'sgst', label: 'SGST' },
  { key: 'cess', label: 'Cess' },
  { key: 'totalTax', label: 'Total Tax' },
];

export function Gstr2bPage({ embedded = false }: { embedded?: boolean }) {
  const { selectedClientId, selectedPeriodId, selectedClient, selectedPeriod, refreshAll } =
    useWorkspace();
  const { pushToast } = useToast();

  const [imports, setImports] = useState<GSTR2BImport[]>([]);
  const [entries, setEntries] = useState<GSTR2BEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dragActive, setDragActive] = useState(false);

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [sampleRows, setSampleRows] = useState<Record<string, unknown>[]>([]);
  const [totalPreviewRows, setTotalPreviewRows] = useState(0);
  const [importing, setImporting] = useState(false);
  const [lastErrors, setLastErrors] = useState<ImportRowError[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getGstr2b(selectedClientId, selectedPeriodId);
      setImports(res.imports);
      setEntries(res.entries);
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Failed to load GSTR-2B statement',
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
      const preview = await api.previewGstr2b(file);
      setPendingFile(file);
      setHeaders(preview.headers);
      setMapping(preview.detectedMapping);
      setSampleRows(preview.sampleRows);
      setTotalPreviewRows(preview.totalRows);
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Failed to inspect GSTR-2B file',
        description: err instanceof Error ? err.message : 'Invalid spreadsheet format.',
      });
    }
  };

  const handleConfirmImport = async () => {
    if (!pendingFile) return;
    setImporting(true);
    try {
      const res = await api.importGstr2b(selectedClientId, selectedPeriodId, pendingFile, mapping);
      setPendingFile(null);
      setSampleRows([]);
      setLastErrors(res.errors);
      await loadData();
      await refreshAll();
      pushToast({
        tone: 'success',
        title: `Imported ${res.entriesAdded} GSTR-2B record(s)`,
        description: `${res.importRecord.fileName} (${res.importRecord.duplicateCount} duplicate(s) skipped).`,
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'GSTR-2B import failed',
        description: err instanceof Error ? err.message : 'Unable to import rows.',
      });
    } finally {
      setImporting(false);
    }
  };

  const filteredEntries = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter((e) =>
      `${e.documentNumber} ${e.supplierName} ${e.supplierGstin}`.toLowerCase().includes(q)
    );
  }, [entries, search]);

  return (
    <div className="space-y-5">
      {!embedded && (
        <div className="flex flex-col justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] lg:flex-row lg:items-center">
          <div>
            <h1 className="font-display text-xl font-bold text-[#0F172A]">
              GSTR-2B Statement Import (Manual File Upload)
            </h1>
            <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">
              Upload exported GSTR-2B CSV or XLSX data for {selectedClient?.tradeName} ({selectedPeriod?.label}).
            </p>
          </div>
        </div>
      )}

      {/* GST Compliance Note */}
      <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50/40 p-4 text-xs text-[#0F2744]">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#1D4ED8]" />
        <div>
          <span className="font-semibold">Read-Only Supplier Statement:</span> GSTR-2B reflects supplier-reported GSTR-1/IFF filings and is never edited directly. Reconcile against Purchase Register and request supplier amendments where discrepancies exist.
        </div>
      </div>

      {/* Drag & Drop Dropzone */}
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
              <Table2 className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[#0F172A]">
                Drop exported GSTR-2B CSV or XLSX statement here
              </div>
              <div className="text-xs text-slate-500">
                Supports B2B invoice schedules, credit/debit notes & ITC availability notes
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <a
              href="/api/templates/gstr-2b/csv"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-[#0F172A] hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Sample CSV</span>
            </a>
            <a
              href="/api/templates/gstr-2b/xlsx"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-[#0F172A] hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Sample XLSX</span>
            </a>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-[#0F2744] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8]">
              <Upload className="h-3.5 w-3.5" />
              <span>Upload GSTR-2B</span>
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

      {/* Column Mapping Card */}
      {pendingFile && (
        <div className="rounded-lg border border-[#1D4ED8] bg-white p-5 space-y-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-sm font-semibold text-[#0F172A]">
                Verify GSTR-2B Columns — {pendingFile.name}
              </h2>
              <p className="text-xs text-slate-500">
                Detected {totalPreviewRows} document row(s). Confirm column mapping to import.
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
                {importing ? 'Importing...' : 'Confirm & Import GSTR-2B'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {GSTR2B_FIELDS.map((f) => (
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
            <span>GSTR-2B Validation Notes ({lastErrors.length})</span>
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
            GSTR-2B Import History ({selectedPeriod?.label})
          </h2>
          <div className="divide-y divide-slate-100 text-xs">
            {imports.map((imp) => (
              <div key={imp.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="flex items-center gap-2">
                  <Table2 className="h-4 w-4 text-[#0F766E]" />
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

      {/* GSTR-2B Table */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search document no, supplier, GSTIN..."
              className="w-full rounded-md border border-slate-200 py-1.5 pl-8 pr-3 text-xs focus:border-[#1D4ED8] focus:outline-none"
            />
          </div>
          <div className="font-mono text-xs text-slate-500">
            Showing {filteredEntries.length} of {entries.length} supplier-reported records
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500">Loading GSTR-2B records...</div>
        ) : filteredEntries.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No GSTR-2B records for this period"
              description="Upload a GSTR-2B CSV or XLSX statement to reconcile against your Purchase Register and invoices."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/80 font-semibold text-slate-600">
                <tr>
                  <th className="px-4 py-2.5">Document No</th>
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Supplier</th>
                  <th className="px-4 py-2.5">Supplier GSTIN</th>
                  <th className="px-4 py-2.5 text-right">Taxable</th>
                  <th className="px-4 py-2.5 text-right">IGST</th>
                  <th className="px-4 py-2.5 text-right">CGST</th>
                  <th className="px-4 py-2.5 text-right">SGST</th>
                  <th className="px-4 py-2.5 text-right">Total Tax</th>
                  <th className="px-4 py-2.5">Validation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredEntries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono font-semibold text-[#0F2744]">
                      {entry.documentNumber}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-600">{entry.documentDate}</td>
                    <td className="px-4 py-2.5 text-[#0F172A]">{entry.supplierName}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-600">{entry.supplierGstin}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {formatINR(entry.taxableValue)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {formatINR(entry.igst)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {formatINR(entry.cgst)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {formatINR(entry.sgst)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums">
                      {formatINR(entry.totalTax)}
                    </td>
                    <td className="px-4 py-2.5">
                      {entry.isValid ? (
                        <StatusBadge tone="green" label="Valid" />
                      ) : (
                        <StatusBadge tone="red" label={entry.validationErrors[0] || 'Invalid'} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
