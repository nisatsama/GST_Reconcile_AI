import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Eye,
  FilePlus2,
  FileText,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { api } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState, StatusBadge, invoiceStatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/ToastProvider';
import { useWorkspace } from '../context/WorkspaceContext';
import type { Invoice, InvoiceExtraction } from '../shared/types';
import { formatINR, roundCurrency } from '../shared/validation';

interface EditFormState {
  supplierName: string;
  supplierGstin: string;
  recipientName: string;
  recipientGstin: string;
  invoiceNumber: string;
  invoiceDate: string;
  placeOfSupply: string;
  hsnSacCodes: string;
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  cess: string;
  totalTax: string;
  grandTotal: string;
  reviewNotes: string;
}

function extractionToForm(ext: InvoiceExtraction | null, inv: Invoice | null): EditFormState {
  const numToStr = (val: number | null | undefined) =>
    val !== null && val !== undefined ? String(val) : '';

  return {
    supplierName: ext?.supplierName.value ?? '',
    supplierGstin: ext?.supplierGstin.value ?? '',
    recipientName: ext?.recipientName.value ?? '',
    recipientGstin: ext?.recipientGstin.value ?? '',
    invoiceNumber: ext?.invoiceNumber.value ?? '',
    invoiceDate: ext?.invoiceDate.value ?? '',
    placeOfSupply: ext?.placeOfSupply.value ?? '',
    hsnSacCodes: ext?.hsnSacCodes?.value?.join(', ') ?? '',
    taxableValue: numToStr(ext?.taxableValue.value),
    cgst: numToStr(ext?.cgst.value),
    sgst: numToStr(ext?.sgst.value),
    igst: numToStr(ext?.igst.value),
    cess: numToStr(ext?.cess.value),
    totalTax: numToStr(ext?.totalTax.value),
    grandTotal: numToStr(ext?.grandTotal.value),
    reviewNotes: inv?.reviewNotes ?? '',
  };
}

function isSupportedInvoiceFile(file: File): boolean {
  const type = (file.type || '').toLowerCase();
  if (
    type === 'application/pdf' ||
    type === 'image/png' ||
    type === 'image/jpeg' ||
    type === 'image/jpg'
  ) {
    return true;
  }
  const ext = file.name.toLowerCase().split('.').pop();
  return ext === 'pdf' || ext === 'png' || ext === 'jpg' || ext === 'jpeg';
}

function dataUrlToBlobUrl(dataUrl: string, mimeType: string): string | null {
  try {
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx === -1) return null;
    const base64 = dataUrl.slice(commaIdx + 1);
    const byteString = atob(base64);
    const bytes = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) {
      bytes[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimeType });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

export function InvoicesPage({ embedded = false }: { embedded?: boolean }) {
  const { selectedClientId, selectedPeriodId, selectedClient, selectedPeriod, refreshAll } =
    useWorkspace();
  const { pushToast } = useToast();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [extractions, setExtractions] = useState<InvoiceExtraction[]>([]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [autoExtractOnUpload, setAutoExtractOnUpload] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [form, setForm] = useState<EditFormState>(extractionToForm(null, null));
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [rejectConfirmOpen, setRejectConfirmOpen] = useState(false);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getInvoices(selectedClientId, selectedPeriodId);
      setInvoices(res.invoices);
      setExtractions(res.extractions);
      setSelectedInvoiceId((prev) => {
        if (prev && res.invoices.some((i) => i.id === prev)) return prev;
        const needsRev = res.invoices.find(
          (i) => i.status === 'NEEDS_REVIEW' || Boolean(i.extractionError)
        );
        return needsRev?.id ?? res.invoices[0]?.id ?? null;
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Failed to load invoices',
        description: err instanceof Error ? err.message : 'Unable to retrieve invoices.',
      });
    } finally {
      setLoading(false);
    }
  }, [selectedClientId, selectedPeriodId, pushToast]);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  const extractionById = useMemo(() => {
    const m = new Map<string, InvoiceExtraction>();
    for (const e of extractions) m.set(e.id, e);
    return m;
  }, [extractions]);

  const selectedInvoice = useMemo(
    () => invoices.find((i) => i.id === selectedInvoiceId) ?? null,
    [invoices, selectedInvoiceId]
  );

  const selectedExtraction = useMemo(
    () =>
      selectedInvoice?.extractionId
        ? extractionById.get(selectedInvoice.extractionId) ?? null
        : null,
    [selectedInvoice, extractionById]
  );

  useEffect(() => {
    setForm(extractionToForm(selectedExtraction, selectedInvoice));
  }, [selectedExtraction, selectedInvoice]);

  useEffect(() => {
    if (
      selectedInvoice?.mimeType === 'application/pdf' &&
      selectedInvoice.fileDataUrl?.includes('base64,')
    ) {
      const objectUrl = dataUrlToBlobUrl(selectedInvoice.fileDataUrl, 'application/pdf');
      setPdfPreviewUrl(objectUrl);
      return () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }
    setPdfPreviewUrl(null);
    return undefined;
  }, [selectedInvoice?.id, selectedInvoice?.mimeType, selectedInvoice?.fileDataUrl]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (statusFilter === 'FAILED') {
        if (!inv.extractionError) return false;
      } else if (statusFilter !== 'ALL' && inv.status !== statusFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const ext = inv.extractionId ? extractionById.get(inv.extractionId) : null;
        const hay = `${inv.fileName} ${ext?.supplierName.value ?? ''} ${ext?.invoiceNumber.value ?? ''} ${ext?.supplierGstin.value ?? ''} ${ext?.recipientGstin.value ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [invoices, statusFilter, searchQuery, extractionById]);

  const toNullableNum = (s: string): number | null => {
    if (!s.trim()) return null;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const arithmeticCheck = useMemo(() => {
    const taxable = toNullableNum(form.taxableValue);
    const cgst = toNullableNum(form.cgst);
    const sgst = toNullableNum(form.sgst);
    const igst = toNullableNum(form.igst);
    const cess = toNullableNum(form.cess);
    const totalTax = toNullableNum(form.totalTax);
    const grandTotal = toNullableNum(form.grandTotal);

    const hasComponent = cgst !== null || sgst !== null || igst !== null || cess !== null;
    const componentSum = hasComponent
      ? roundCurrency((cgst ?? 0) + (sgst ?? 0) + (igst ?? 0) + (cess ?? 0))
      : null;
    const effectiveTax = totalTax ?? componentSum;
    const expectedGrandTotal =
      taxable !== null && effectiveTax !== null ? roundCurrency(taxable + effectiveTax) : null;
    const taxMismatch =
      componentSum !== null && totalTax !== null && Math.abs(componentSum - totalTax) > 1;
    const totalMismatch =
      expectedGrandTotal !== null && grandTotal !== null && Math.abs(expectedGrandTotal - grandTotal) > 1;

    return { componentSum, effectiveTax, expectedGrandTotal, taxMismatch, totalMismatch };
  }, [form.taxableValue, form.cgst, form.sgst, form.igst, form.cess, form.totalTax, form.grandTotal]);

  const canRunGeminiExtraction = Boolean(
    selectedInvoice &&
      selectedInvoice.mimeType !== 'image/svg+xml' &&
      selectedInvoice.fileDataUrl?.includes('base64,')
  );

  const handleFilesSelected = (fileList: FileList | null) => {
    if (!fileList) return;
    const valid: File[] = [];
    const rejected: string[] = [];
    for (const f of Array.from(fileList)) {
      if (!isSupportedInvoiceFile(f)) {
        rejected.push(`${f.name} (use PDF, JPG, or PNG)`);
        continue;
      }
      if (f.size > 10 * 1024 * 1024) {
        rejected.push(`${f.name} (exceeds 10 MB limit)`);
        continue;
      }
      valid.push(f);
    }
    if (rejected.length > 0) {
      pushToast({
        tone: 'warning',
        title: 'Some files were skipped',
        description: rejected.join('; '),
      });
    }
    if (valid.length > 0) {
      setQueuedFiles((prev) => [...prev, ...valid]);
    }
  };

  const handleUploadAndExtract = async () => {
    if (queuedFiles.length === 0) return;
    setUploading(true);
    try {
      const res = await api.uploadInvoices(
        selectedClientId,
        selectedPeriodId,
        queuedFiles,
        autoExtractOnUpload
      );
      setQueuedFiles([]);
      await loadInvoices();
      await refreshAll();
      if (res.invoices[0]) {
        setSelectedInvoiceId(res.invoices[0].id);
      }
      if (res.errors.length > 0) {
        pushToast({
          tone: 'error',
          title: `Uploaded ${res.invoices.length} file(s) with extraction errors`,
          description: res.errors[0].error,
        });
      } else {
        pushToast({
          tone: 'success',
          title: autoExtractOnUpload
            ? `Extracted ${res.invoices.length} invoice(s) via Gemini`
            : `Uploaded ${res.invoices.length} invoice(s)`,
          description: autoExtractOnUpload
            ? 'Review extracted fields and arithmetic checks before approving.'
            : 'Click "Run Extraction" on any uploaded invoice.',
        });
      }
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Upload failed',
        description: err instanceof Error ? err.message : 'Unable to upload invoices.',
      });
    } finally {
      setUploading(false);
    }
  };

  const handleSampleInvoiceUpload = async () => {
    setUploading(true);
    try {
      const res = await api.uploadSampleInvoice(selectedClientId, selectedPeriodId);
      await loadInvoices();
      await refreshAll();
      setSelectedInvoiceId(res.invoice.id);
      if (res.error) {
        pushToast({
          tone: 'warning',
          title: 'Sample PDF uploaded, extraction returned error',
          description: res.error,
        });
      } else {
        pushToast({
          tone: 'success',
          title: 'Sample PDF extracted via Gemini',
          description: `${res.invoice.fileName} is ready for human review.`,
        });
      }
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Sample upload failed',
        description: err instanceof Error ? err.message : 'Request failed.',
      });
    } finally {
      setUploading(false);
    }
  };

  const handleReExtract = async () => {
    if (!selectedInvoice) return;
    setExtractingId(selectedInvoice.id);
    try {
      await api.extractInvoice(selectedInvoice.id, selectedClientId);
      await loadInvoices();
      await refreshAll();
      pushToast({
        tone: 'success',
        title: 'Gemini extraction complete',
        description: `Structured fields updated for ${selectedInvoice.fileName}.`,
      });
    } catch (err) {
      await loadInvoices();
      pushToast({
        tone: 'error',
        title: 'Extraction failed',
        description: err instanceof Error ? err.message : 'Gemini extraction error.',
      });
    } finally {
      setExtractingId(null);
    }
  };

  const parseStrictNullableNum = (label: string, raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const cleaned = trimmed.replace(/[₹,\s]/g, '');
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`${label} must be a non-negative number (or blank for null).`);
    }
    return roundCurrency(n);
  };

  const buildExtractionUpdatePayload = () => ({
    supplierName: form.supplierName.trim() || null,
    supplierGstin: form.supplierGstin.trim() ? form.supplierGstin.trim().toUpperCase() : null,
    recipientName: form.recipientName.trim() || null,
    recipientGstin: form.recipientGstin.trim() ? form.recipientGstin.trim().toUpperCase() : null,
    invoiceNumber: form.invoiceNumber.trim() || null,
    invoiceDate: form.invoiceDate.trim() || null,
    placeOfSupply: form.placeOfSupply.trim() || null,
    hsnSacCodes: form.hsnSacCodes
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    taxableValue: parseStrictNullableNum('Taxable Value', form.taxableValue),
    cgst: parseStrictNullableNum('CGST', form.cgst),
    sgst: parseStrictNullableNum('SGST', form.sgst),
    igst: parseStrictNullableNum('IGST', form.igst),
    cess: parseStrictNullableNum('Cess', form.cess),
    totalTax: parseStrictNullableNum('Total Tax', form.totalTax),
    grandTotal: parseStrictNullableNum('Grand Total', form.grandTotal),
    reviewNotes: form.reviewNotes,
  });

  const handleSaveEdits = async () => {
    if (!selectedInvoice || !selectedExtraction) return;
    setSaving(true);
    try {
      const payload = buildExtractionUpdatePayload();
      await api.updateExtraction(selectedInvoice.id, payload, selectedClientId);
      await loadInvoices();
      pushToast({
        tone: 'success',
        title: 'Field corrections saved',
        description: 'Backend validation rules re-executed on updated fields.',
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Unable to save edits',
        description: err instanceof Error ? err.message : 'Validation failed.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDecision = async (action: 'APPROVE' | 'REJECT' | 'NEEDS_REVIEW') => {
    if (!selectedInvoice) return;
    setSaving(true);
    try {
      if (selectedExtraction && action !== 'REJECT') {
        const payload = buildExtractionUpdatePayload();
        await api.updateExtraction(selectedInvoice.id, payload, selectedClientId);
      }
      await api.decideInvoice(selectedInvoice.id, action, form.reviewNotes, selectedClientId);
      setRejectConfirmOpen(false);
      await loadInvoices();
      await refreshAll();
      pushToast({
        tone: 'success',
        title:
          action === 'APPROVE'
            ? 'Invoice approved for reconciliation'
            : `Invoice marked ${action.replace(/_/g, ' ')}`,
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Decision failed',
        description: err instanceof Error ? err.message : 'Unable to update invoice status.',
      });
    } finally {
      setSaving(false);
    }
  };

  const isExtractingSelected = Boolean(selectedInvoice && extractingId === selectedInvoice.id);

  return (
    <div className="space-y-5">
      {!embedded && (
        <div className="flex flex-col justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] lg:flex-row lg:items-center">
          <div>
            <h1 className="font-display text-xl font-bold text-[#0F172A]">
              Supplier Invoices & Gemini Extraction
            </h1>
            <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">
              Upload PDF, JPG, or PNG invoices for {selectedClient?.tradeName} ({selectedPeriod?.label}). Missing fields remain null until verified.
            </p>
          </div>
          <button
            type="button"
            disabled={uploading}
            onClick={handleSampleInvoiceUpload}
            className="inline-flex items-center gap-2 rounded-md border border-[#0F766E] bg-teal-50/60 px-3.5 py-2 text-xs font-medium text-[#0F766E] hover:bg-teal-50 disabled:opacity-50 whitespace-nowrap"
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FilePlus2 className="h-3.5 w-3.5" />
            )}
            <span>{uploading ? 'Processing...' : 'Upload Sample PDF Invoice'}</span>
          </button>
        </div>
      )}

      {/* Drag & Drop Upload Area */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          handleFilesSelected(e.dataTransfer.files);
        }}
        className={`rounded-lg border-2 border-dashed p-5 transition-colors ${
          dragActive ? 'border-[#1D4ED8] bg-blue-50/40' : 'border-slate-300 bg-white'
        }`}
      >
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-[#0F2744]">
              <Upload className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[#0F172A]">
                Drag and drop supplier invoices, or browse files
              </div>
              <div className="text-xs text-slate-500">
                PDF, PNG, JPG · Max 10 MB per file · Up to 10 files per batch
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {embedded && (
              <button
                type="button"
                disabled={uploading}
                onClick={handleSampleInvoiceUpload}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#0F766E] bg-teal-50/50 px-3 py-2 text-xs font-medium text-[#0F766E] hover:bg-teal-50 disabled:opacity-50"
              >
                {uploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FilePlus2 className="h-3.5 w-3.5" />
                )}
                <span>Sample PDF</span>
              </button>
            )}
            <label className="cursor-pointer rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-[#0F172A] hover:bg-slate-50">
              <span>Browse Files</span>
              <input
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                className="hidden"
                onChange={(e) => {
                  handleFilesSelected(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
            {queuedFiles.length > 0 && (
              <button
                type="button"
                disabled={uploading}
                onClick={handleUploadAndExtract}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#0F2744] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-60"
              >
                {uploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                <span>
                  {uploading
                    ? 'Extracting with Gemini...'
                    : autoExtractOnUpload
                      ? `Upload & Extract (${queuedFiles.length})`
                      : `Upload Queue (${queuedFiles.length})`}
                </span>
              </button>
            )}
          </div>
        </div>

        {queuedFiles.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>Queued files ({queuedFiles.length})</span>
              <label className="inline-flex cursor-pointer items-center gap-1.5 select-none">
                <input
                  type="checkbox"
                  checked={autoExtractOnUpload}
                  onChange={(e) => setAutoExtractOnUpload(e.target.checked)}
                />
                <span>Auto-extract with Gemini on upload</span>
              </label>
            </div>
            <div className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-slate-50 px-3">
              {queuedFiles.map((f, idx) => (
                <div
                  key={`${f.name}-${idx}`}
                  className="flex items-center justify-between py-2 text-xs"
                >
                  <div className="flex items-center gap-2 truncate">
                    <FileText className="h-4 w-4 shrink-0 text-[#0F766E]" />
                    <span className="font-medium text-[#0F172A] truncate">{f.name}</span>
                    <span className="font-mono text-slate-500 tabular-nums">
                      ({(f.size / 1024).toFixed(1)} KB)
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => setQueuedFiles((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-slate-400 hover:text-red-700 disabled:opacity-40"
                    title="Remove from queue"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Split Workspace: Invoice Queue + Preview/Review */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Left Queue */}
        <div className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] xl:col-span-4">
          <div className="space-y-3 border-b border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-[#0F172A]">
                Documents ({filteredInvoices.length})
              </h2>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-[#0F172A]"
              >
                <option value="ALL">All Statuses</option>
                <option value="UPLOADED">Pending Extraction</option>
                <option value="FAILED">Extraction Failed</option>
                <option value="NEEDS_REVIEW">Needs Review</option>
                <option value="EXTRACTED">Extracted</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search invoice no, supplier, GSTIN..."
                className="w-full rounded-md border border-slate-200 py-1.5 pl-8 pr-3 text-xs focus:border-[#1D4ED8] focus:outline-none"
              />
            </div>
          </div>

          <div className="max-h-[680px] divide-y divide-slate-100 overflow-y-auto">
            {loading ? (
              <div className="divide-y divide-slate-100">
                {[0, 1, 2, 3].map((idx) => (
                  <div key={idx} className="animate-pulse space-y-2 p-3.5">
                    <div className="flex justify-between gap-2">
                      <div className="h-3.5 w-36 rounded bg-slate-200" />
                      <div className="h-4 w-16 rounded bg-slate-200" />
                    </div>
                    <div className="h-3 w-48 rounded bg-slate-100" />
                  </div>
                ))}
              </div>
            ) : filteredInvoices.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No invoices match the current filter.
              </div>
            ) : (
              filteredInvoices.map((inv) => {
                const ext = inv.extractionId ? extractionById.get(inv.extractionId) : null;
                const badge = inv.extractionError
                  ? { tone: 'red' as const, label: 'Extract Failed' }
                  : invoiceStatusBadge(inv.status);
                const isSelected = inv.id === selectedInvoiceId;
                return (
                  <button
                    key={inv.id}
                    type="button"
                    onClick={() => setSelectedInvoiceId(inv.id)}
                    className={`w-full p-3.5 text-left transition-colors ${
                      isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono text-xs font-semibold text-[#0F2744] truncate">
                          {ext?.invoiceNumber.value || inv.fileName}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-700 truncate">
                          {ext?.supplierName.value ||
                            (inv.extractionError
                              ? 'Extraction error — click to retry'
                              : 'Pending Gemini extraction')}
                        </div>
                      </div>
                      <StatusBadge tone={badge.tone} label={badge.label} />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                      <span className="font-mono">
                        {ext ? `Conf: ${Math.round(ext.overallConfidence * 100)}%` : inv.mimeType}
                      </span>
                      <span className="font-mono font-medium text-[#0F172A] tabular-nums">
                        {ext?.grandTotal.value !== null && ext?.grandTotal.value !== undefined
                          ? formatINR(ext.grandTotal.value)
                          : '—'}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Document Preview + Extraction Review */}
        <div className="xl:col-span-8">
          {!selectedInvoice ? (
            <EmptyState
              title="Select an invoice to review"
              description="Choose an invoice from the queue or upload a PDF, JPG, or PNG to inspect Gemini's structured extraction."
            />
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              {/* Action Strip */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-sm font-semibold text-[#0F172A] truncate">
                      {selectedInvoice.fileName}
                    </h2>
                    <StatusBadge
                      tone={
                        selectedInvoice.extractionError
                          ? 'red'
                          : invoiceStatusBadge(selectedInvoice.status).tone
                      }
                      label={
                        selectedInvoice.extractionError
                          ? 'Extract Failed'
                          : invoiceStatusBadge(selectedInvoice.status).label
                      }
                    />
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {selectedExtraction
                      ? `Extracted with ${selectedExtraction.modelUsed} · Confidence ${Math.round(selectedExtraction.overallConfidence * 100)}%`
                      : selectedInvoice.extractionError
                        ? 'Extraction failed — retry available'
                        : 'Uploaded · awaiting Gemini extraction'}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isExtractingSelected || !canRunGeminiExtraction}
                    onClick={handleReExtract}
                    title={
                      !canRunGeminiExtraction
                        ? 'Pre-seeded SVG previews are already structured; upload a PDF, JPG, or PNG to run Gemini extraction.'
                        : undefined
                    }
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-[#0F172A] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${isExtractingSelected ? 'animate-spin' : ''}`}
                    />
                    <span>
                      {isExtractingSelected
                        ? 'Extracting...'
                        : selectedInvoice.extractionError
                          ? 'Retry Extraction'
                          : !selectedExtraction
                            ? 'Run Extraction'
                            : 'Re-run'}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={saving || isExtractingSelected}
                    onClick={() => handleDecision('NEEDS_REVIEW')}
                    className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                  >
                    <AlertCircle className="h-3.5 w-3.5" />
                    <span>Flag Review</span>
                  </button>
                  <button
                    type="button"
                    disabled={saving || isExtractingSelected}
                    onClick={() => setRejectConfirmOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    <span>Reject</span>
                  </button>
                  <button
                    type="button"
                    disabled={saving || isExtractingSelected || !selectedExtraction}
                    onClick={() => handleDecision('APPROVE')}
                    className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Approve</span>
                  </button>
                </div>
              </div>

              {selectedInvoice.extractionError && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-5 py-3 text-xs text-red-700">
                  <div className="min-w-0">
                    <div className="font-semibold">Gemini Extraction Error</div>
                    <div className="mt-0.5 text-red-900">{selectedInvoice.extractionError}</div>
                  </div>
                  {canRunGeminiExtraction && (
                    <button
                      type="button"
                      disabled={isExtractingSelected}
                      onClick={handleReExtract}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>{isExtractingSelected ? 'Retrying...' : 'Retry Gemini Extraction'}</span>
                    </button>
                  )}
                </div>
              )}

              {selectedExtraction && selectedExtraction.validationWarnings.length > 0 && (
                <div className="border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-xs text-amber-900">
                  <div className="font-semibold">Backend Validation Alerts:</div>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {selectedExtraction.validationWarnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Split Body: Document Preview + Structured Fields */}
              <div className="grid grid-cols-1 divide-y divide-slate-200 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
                <div className="p-4">
                  <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-500">
                    <span className="flex items-center gap-1.5">
                      <Eye className="h-3.5 w-3.5" />
                      Original Document
                    </span>
                    <div className="flex items-center gap-2 font-mono">
                      <span>{selectedInvoice.mimeType}</span>
                      {(pdfPreviewUrl || selectedInvoice.fileDataUrl) && (
                        <a
                          href={pdfPreviewUrl ?? selectedInvoice.fileDataUrl ?? undefined}
                          download={selectedInvoice.fileName}
                          className="inline-flex items-center gap-1 text-[#1D4ED8] hover:underline"
                        >
                          <Download className="h-3 w-3" />
                          <span>Download</span>
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="flex h-[580px] items-center justify-center overflow-auto rounded-md border border-slate-200 bg-slate-50">
                    {selectedInvoice.fileDataUrl ? (
                      selectedInvoice.mimeType === 'application/pdf' ? (
                        pdfPreviewUrl ? (
                          <iframe
                            title={selectedInvoice.fileName}
                            src={pdfPreviewUrl}
                            className="h-full w-full"
                          />
                        ) : (
                          <div className="text-xs text-slate-500">Preparing PDF preview...</div>
                        )
                      ) : (
                        <img
                          src={selectedInvoice.fileDataUrl}
                          alt={selectedInvoice.fileName}
                          className="max-h-full max-w-full object-contain"
                        />
                      )
                    ) : (
                      <div className="text-xs text-slate-500">Preview unavailable.</div>
                    )}
                  </div>
                </div>

                {/* Extracted Fields Editor */}
                <div className="max-h-[640px] space-y-4 overflow-y-auto p-4">
                  {isExtractingSelected ? (
                    <div className="flex h-[520px] flex-col items-center justify-center gap-3 px-6 text-center">
                      <Loader2 className="h-7 w-7 animate-spin text-[#1D4ED8]" />
                      <div className="text-sm font-semibold text-[#0F172A]">
                        Running Gemini Multimodal Extraction...
                      </div>
                      <p className="max-w-xs text-xs text-slate-500">
                        Reading {selectedInvoice.fileName} on the server, preserving source evidence, and leaving absent fields as null.
                      </p>
                    </div>
                  ) : !selectedExtraction ? (
                    <div className="flex h-[520px] flex-col items-center justify-center gap-3 px-6 text-center">
                      <AlertCircle className="h-7 w-7 text-amber-600" />
                      <div className="text-sm font-semibold text-[#0F172A]">
                        {selectedInvoice.extractionError
                          ? 'Extraction Failed'
                          : 'Extraction Not Yet Run'}
                      </div>
                      <p className="max-w-sm text-xs text-slate-500">
                        {selectedInvoice.extractionError
                          ? selectedInvoice.extractionError
                          : 'Run server-side Gemini multimodal extraction to populate structured GST fields and source evidence.'}
                      </p>
                      {canRunGeminiExtraction && (
                        <button
                          type="button"
                          onClick={handleReExtract}
                          className="inline-flex items-center gap-1.5 rounded-md bg-[#0F2744] px-4 py-2 text-xs font-medium text-white hover:bg-[#1D4ED8]"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          <span>
                            {selectedInvoice.extractionError
                              ? 'Retry Gemini Extraction'
                              : 'Run Gemini Extraction'}
                          </span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                          Extracted GST Fields
                        </span>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={handleSaveEdits}
                          className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-[#0F172A] hover:bg-slate-50 disabled:opacity-50"
                        >
                          {saving ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                          <span>Save Edits</span>
                        </button>
                      </div>

                      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[#0F172A]">
                          <span className="font-medium">Arithmetic Cross-Check</span>
                          <span
                            className={`font-mono font-semibold ${
                              arithmeticCheck.taxMismatch || arithmeticCheck.totalMismatch
                                ? 'text-amber-700'
                                : 'text-emerald-700'
                            }`}
                          >
                            {arithmeticCheck.taxMismatch || arithmeticCheck.totalMismatch
                              ? 'Variance Detected'
                              : 'Consistent'}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-slate-600 tabular-nums">
                          <span>
                            Tax Sum:{' '}
                            {arithmeticCheck.componentSum !== null
                              ? formatINR(arithmeticCheck.componentSum)
                              : 'null'}
                          </span>
                          <span>·</span>
                          <span>
                            Computed Total:{' '}
                            {arithmeticCheck.expectedGrandTotal !== null
                              ? formatINR(arithmeticCheck.expectedGrandTotal)
                              : 'null'}
                          </span>
                          <span>·</span>
                          <span>
                            Grand Total:{' '}
                            {form.grandTotal.trim() ? formatINR(Number(form.grandTotal)) : 'null'}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <FieldInput
                          label="Supplier Legal Name"
                          value={form.supplierName}
                          onChange={(v) => setForm({ ...form, supplierName: v })}
                          meta={selectedExtraction.supplierName}
                          span2
                        />
                        <FieldInput
                          label="Supplier GSTIN"
                          value={form.supplierGstin}
                          onChange={(v) => setForm({ ...form, supplierGstin: v.toUpperCase() })}
                          meta={selectedExtraction.supplierGstin}
                          mono
                        />
                        <FieldInput
                          label="Recipient GSTIN"
                          value={form.recipientGstin}
                          onChange={(v) => setForm({ ...form, recipientGstin: v.toUpperCase() })}
                          meta={selectedExtraction.recipientGstin}
                          mono
                        />
                        <FieldInput
                          label="Recipient Name"
                          value={form.recipientName}
                          onChange={(v) => setForm({ ...form, recipientName: v })}
                          meta={selectedExtraction.recipientName}
                        />
                        <FieldInput
                          label="Invoice Number"
                          value={form.invoiceNumber}
                          onChange={(v) => setForm({ ...form, invoiceNumber: v })}
                          meta={selectedExtraction.invoiceNumber}
                          mono
                        />
                        <FieldInput
                          label="Invoice Date"
                          value={form.invoiceDate}
                          onChange={(v) => setForm({ ...form, invoiceDate: v })}
                          meta={selectedExtraction.invoiceDate}
                          mono
                        />
                        <FieldInput
                          label="Place of Supply"
                          value={form.placeOfSupply}
                          onChange={(v) => setForm({ ...form, placeOfSupply: v })}
                          meta={selectedExtraction.placeOfSupply}
                        />
                        <FieldInput
                          label="HSN / SAC Codes"
                          value={form.hsnSacCodes}
                          onChange={(v) => setForm({ ...form, hsnSacCodes: v })}
                          meta={selectedExtraction.hsnSacCodes}
                          mono
                          span2
                        />
                        <FieldInput
                          label="Taxable Value (₹)"
                          value={form.taxableValue}
                          onChange={(v) => setForm({ ...form, taxableValue: v })}
                          meta={selectedExtraction.taxableValue}
                          mono
                        />
                        <FieldInput
                          label="CGST (₹)"
                          value={form.cgst}
                          onChange={(v) => setForm({ ...form, cgst: v })}
                          meta={selectedExtraction.cgst}
                          mono
                        />
                        <FieldInput
                          label="SGST (₹)"
                          value={form.sgst}
                          onChange={(v) => setForm({ ...form, sgst: v })}
                          meta={selectedExtraction.sgst}
                          mono
                        />
                        <FieldInput
                          label="IGST (₹)"
                          value={form.igst}
                          onChange={(v) => setForm({ ...form, igst: v })}
                          meta={selectedExtraction.igst}
                          mono
                        />
                        <FieldInput
                          label="Cess (₹)"
                          value={form.cess}
                          onChange={(v) => setForm({ ...form, cess: v })}
                          meta={selectedExtraction.cess}
                          mono
                        />
                        <FieldInput
                          label="Total Tax (₹)"
                          value={form.totalTax}
                          onChange={(v) => setForm({ ...form, totalTax: v })}
                          meta={selectedExtraction.totalTax}
                          mono
                        />
                        <FieldInput
                          label="Grand Total (₹)"
                          value={form.grandTotal}
                          onChange={(v) => setForm({ ...form, grandTotal: v })}
                          meta={selectedExtraction.grandTotal}
                          mono
                          span2
                        />
                      </div>

                      {selectedExtraction.lineItems.length > 0 && (
                        <div className="border-t border-slate-200 pt-3">
                          <div className="mb-2 text-xs font-semibold text-slate-500">
                            Extracted Line Items ({selectedExtraction.lineItems.length})
                          </div>
                          <div className="overflow-x-auto rounded border border-slate-200">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-slate-50 text-slate-600">
                                <tr>
                                  <th className="px-2.5 py-1.5">Description</th>
                                  <th className="px-2.5 py-1.5">HSN</th>
                                  <th className="px-2.5 py-1.5 text-right">Taxable</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {selectedExtraction.lineItems.map((li, i) => (
                                  <tr key={i}>
                                    <td className="px-2.5 py-1.5 text-[#0F172A]">
                                      {li.description}
                                    </td>
                                    <td className="px-2.5 py-1.5 font-mono text-slate-500">
                                      {li.hsnSac || '—'}
                                    </td>
                                    <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                                      {formatINR(li.taxableValue)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      <div>
                        <label className="block text-xs font-medium text-slate-600">
                          Reviewer Notes
                        </label>
                        <textarea
                          rows={2}
                          value={form.reviewNotes}
                          onChange={(e) => setForm({ ...form, reviewNotes: e.target.value })}
                          placeholder="Add verification notes for audit trail..."
                          className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs focus:border-[#1D4ED8] focus:outline-none"
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={rejectConfirmOpen}
        tone="danger"
        busy={saving}
        title="Reject Invoice Record?"
        description={`Rejecting ${selectedInvoice?.fileName ?? 'this invoice'} excludes it from approved 3-way invoice matching. You can flag it for review later if needed.`}
        confirmLabel="Reject Invoice"
        onConfirm={() => handleDecision('REJECT')}
        onCancel={() => setRejectConfirmOpen(false)}
      />
    </div>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  meta,
  mono,
  span2,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  meta?: {
    value: unknown;
    confidence: number;
    evidence: string | null;
    validationStatus: string;
    validationMessage?: string;
    editedByUser?: boolean;
  };
  mono?: boolean;
  span2?: boolean;
}) {
  const isError = meta?.validationStatus === 'ERROR' || meta?.validationStatus === 'MISSING';
  const isWarn = meta?.validationStatus === 'WARNING';

  return (
    <div className={span2 ? 'sm:col-span-2' : ''}>
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-[#0F172A]">{label}</label>
        {meta && (
          <span
            className={`font-mono text-[10px] tabular-nums ${
              isError ? 'text-red-700' : isWarn ? 'text-amber-700' : 'text-slate-500'
            }`}
          >
            {meta.editedByUser ? 'Edited · ' : ''}
            {Math.round(meta.confidence * 100)}%
          </span>
        )}
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="null (not found in document)"
        className={`mt-1 w-full rounded-md border px-2.5 py-1.5 text-xs focus:outline-none ${
          mono ? 'font-mono' : ''
        } ${
          isError
            ? 'border-red-300 bg-red-50/40 focus:border-red-600'
            : isWarn
              ? 'border-amber-300 bg-amber-50/40 focus:border-amber-600'
              : 'border-slate-200 focus:border-[#1D4ED8]'
        }`}
      />
      {meta?.validationMessage && (
        <div className="mt-0.5 text-[10px] text-red-700">{meta.validationMessage}</div>
      )}
      {meta?.evidence ? (
        <div className="mt-0.5 truncate text-[10px] text-slate-500" title={meta.evidence}>
          Evidence: {meta.evidence}
        </div>
      ) : meta && (meta.value === null || (Array.isArray(meta.value) && meta.value.length === 0)) ? (
        <div className="mt-0.5 text-[10px] text-slate-500">Not present in document (null)</div>
      ) : null}
    </div>
  );
}
