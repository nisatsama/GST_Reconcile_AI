import type {
  AuditLog,
  BusinessClient,
  DashboardPayload,
  Discrepancy,
  DiscrepancyStatus,
  FollowUpStatus,
  GlobalSearchResult,
  GSTR2BEntry,
  GSTR2BImport,
  GSTRegistration,
  Invoice,
  InvoiceExtraction,
  PurchaseRegisterEntry,
  PurchaseRegisterImport,
  ReconciliationConfig,
  ReconciliationResult,
  ReconciliationRun,
  ReportingPeriod,
  SupplierFollowUp,
  UserRoleView,
  Workspace,
} from '../shared/types';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    if (contentType.includes('application/json')) {
      const errBody = (await res.json()) as { error?: string };
      throw new Error(errBody.error || `Request failed with status ${res.status}`);
    }
    throw new Error(`Request failed with status ${res.status}`);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () =>
    request<{ ok: boolean; geminiConfigured: boolean; timestamp: string }>('/api/health'),

  getWorkspace: () =>
    request<{
      workspace: Workspace;
      clients: BusinessClient[];
      gstRegistrations: GSTRegistration[];
      periods: ReportingPeriod[];
      reconciliationConfig: ReconciliationConfig;
    }>('/api/workspace'),

  resetWorkspace: () =>
    request<{ ok: boolean; workspace: Workspace; clients: BusinessClient[] }>('/api/workspace/reset', {
      method: 'POST',
    }),

  createClient: (payload: {
    legalName: string;
    tradeName: string;
    gstin: string;
    stateName: string;
    sector: string;
    contactEmail: string;
  }) =>
    request<{ client: BusinessClient }>('/api/workspace/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  updateWorkspaceConfig: (payload: {
    reconciliationConfig?: ReconciliationConfig;
    userRoleView?: UserRoleView;
  }) =>
    request<{ workspace: Workspace; reconciliationConfig: ReconciliationConfig }>(
      '/api/workspace/config',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    ),

  getDashboard: (clientId: string, periodId: string) =>
    request<DashboardPayload>(
      `/api/dashboard?clientId=${encodeURIComponent(clientId)}&periodId=${encodeURIComponent(periodId)}`
    ),

  getAuditLogs: (
    clientId: string,
    periodId: string,
    opts?: { scope?: 'PERIOD' | 'ALL'; entityType?: string; search?: string }
  ) => {
    const params = new URLSearchParams({
      clientId,
      periodId,
      scope: opts?.scope ?? 'PERIOD',
      entityType: opts?.entityType ?? 'ALL',
      search: opts?.search ?? '',
    });
    return request<{ logs: AuditLog[] }>(`/api/audit-logs?${params.toString()}`);
  },

  globalSearch: (clientId: string, periodId: string, q: string) =>
    request<{ results: GlobalSearchResult[] }>(
      `/api/search?clientId=${encodeURIComponent(clientId)}&periodId=${encodeURIComponent(periodId)}&q=${encodeURIComponent(q)}`
    ),

  getInvoices: (clientId: string, periodId: string) =>
    request<{ invoices: Invoice[]; extractions: InvoiceExtraction[] }>(
      `/api/invoices?clientId=${encodeURIComponent(clientId)}&periodId=${encodeURIComponent(periodId)}`
    ),

  uploadInvoices: (clientId: string, periodId: string, files: File[], autoExtract: boolean) => {
    const fd = new FormData();
    fd.append('clientId', clientId);
    fd.append('periodId', periodId);
    fd.append('autoExtract', String(autoExtract));
    files.forEach((f) => fd.append('files', f));
    return request<{
      invoices: Invoice[];
      extractions: InvoiceExtraction[];
      errors: Array<{ fileName: string; error: string }>;
    }>('/api/invoices/upload', { method: 'POST', body: fd });
  },

  uploadSampleInvoice: (clientId: string, periodId: string) =>
    request<{ invoice: Invoice; extraction: InvoiceExtraction | null; error: string | null }>(
      '/api/invoices/sample-upload',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, periodId }),
      }
    ),

  extractInvoice: (invoiceId: string, clientId?: string) =>
    request<{ invoice: Invoice; extraction: InvoiceExtraction }>(
      `/api/invoices/${encodeURIComponent(invoiceId)}/extract${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ''}`,
      { method: 'POST' }
    ),

  updateExtraction: (
    invoiceId: string,
    payload: {
      supplierName: string | null;
      supplierGstin: string | null;
      recipientName: string | null;
      recipientGstin: string | null;
      invoiceNumber: string | null;
      invoiceDate: string | null;
      placeOfSupply: string | null;
      hsnSacCodes?: string[];
      taxableValue: number | null;
      cgst: number | null;
      sgst: number | null;
      igst: number | null;
      cess: number | null;
      totalTax: number | null;
      grandTotal: number | null;
      reviewNotes?: string;
    },
    clientId?: string
  ) =>
    request<{ invoice: Invoice; extraction: InvoiceExtraction }>(
      `/api/invoices/${encodeURIComponent(invoiceId)}/extraction${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ''}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    ),

  decideInvoice: (
    invoiceId: string,
    action: 'APPROVE' | 'REJECT' | 'NEEDS_REVIEW',
    reviewNotes?: string,
    clientId?: string
  ) =>
    request<{ invoice: Invoice }>(
      `/api/invoices/${encodeURIComponent(invoiceId)}/decision${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ''}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reviewNotes, clientId }),
      }
    ),

  getPurchaseRegister: (clientId: string, periodId: string) =>
    request<{ imports: PurchaseRegisterImport[]; entries: PurchaseRegisterEntry[] }>(
      `/api/purchase-register?clientId=${encodeURIComponent(clientId)}&periodId=${encodeURIComponent(periodId)}`
    ),

  previewPurchaseRegister: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<{
      fileName: string;
      headers: string[];
      detectedMapping: Record<string, string>;
      totalRows: number;
      sampleRows: Record<string, unknown>[];
    }>('/api/purchase-register/preview', { method: 'POST', body: fd });
  },

  importPurchaseRegister: (
    clientId: string,
    periodId: string,
    file: File,
    columnMapping: Record<string, string>
  ) => {
    const fd = new FormData();
    fd.append('clientId', clientId);
    fd.append('periodId', periodId);
    fd.append('columnMapping', JSON.stringify(columnMapping));
    fd.append('file', file);
    return request<{
      importRecord: PurchaseRegisterImport;
      entriesAdded: number;
      errors: Array<{ rowNumber: number; field: string; message: string; rawValue?: string }>;
    }>('/api/purchase-register/import', { method: 'POST', body: fd });
  },

  updatePurchaseEntry: (
    entryId: string,
    payload: {
      supplierGstin: string;
      supplierName: string;
      invoiceNumber: string;
      invoiceDate: string;
      taxableValue: number;
      cgst: number;
      sgst: number;
      igst: number;
      cess: number;
    }
  ) =>
    request<{ entry: PurchaseRegisterEntry }>(
      `/api/purchase-register/entries/${encodeURIComponent(entryId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    ),

  getGstr2b: (clientId: string, periodId: string) =>
    request<{ imports: GSTR2BImport[]; entries: GSTR2BEntry[] }>(
      `/api/gstr2b?clientId=${encodeURIComponent(clientId)}&periodId=${encodeURIComponent(periodId)}`
    ),

  previewGstr2b: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<{
      fileName: string;
      headers: string[];
      detectedMapping: Record<string, string>;
      totalRows: number;
      sampleRows: Record<string, unknown>[];
    }>('/api/gstr2b/preview', { method: 'POST', body: fd });
  },

  importGstr2b: (
    clientId: string,
    periodId: string,
    file: File,
    columnMapping: Record<string, string>
  ) => {
    const fd = new FormData();
    fd.append('clientId', clientId);
    fd.append('periodId', periodId);
    fd.append('columnMapping', JSON.stringify(columnMapping));
    fd.append('file', file);
    return request<{
      importRecord: GSTR2BImport;
      entriesAdded: number;
      errors: Array<{ rowNumber: number; field: string; message: string; rawValue?: string }>;
    }>('/api/gstr2b/import', { method: 'POST', body: fd });
  },

  getReconciliation: (clientId: string, periodId: string) =>
    request<{
      config: ReconciliationConfig;
      latestRun: ReconciliationRun | null;
      runs: ReconciliationRun[];
      results: ReconciliationResult[];
    }>(
      `/api/reconciliation?clientId=${encodeURIComponent(clientId)}&periodId=${encodeURIComponent(periodId)}`
    ),

  runReconciliation: (clientId: string, periodId: string, config?: ReconciliationConfig) =>
    request<{
      run: ReconciliationRun;
      results: ReconciliationResult[];
      discrepancies: Discrepancy[];
    }>('/api/reconciliation/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, periodId, config }),
    }),

  reviewReconciliationResult: (resultId: string, decision: 'HUMAN_APPROVED' | 'HUMAN_REJECTED') =>
    request<{ result: ReconciliationResult }>(
      `/api/reconciliation/results/${encodeURIComponent(resultId)}/review`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      }
    ),

  getDiscrepancies: (clientId: string, periodId: string) =>
    request<{
      discrepancies: Discrepancy[];
      carriedForwardHistory: Discrepancy[];
      results: ReconciliationResult[];
      followUps: SupplierFollowUp[];
    }>(
      `/api/discrepancies?clientId=${encodeURIComponent(clientId)}&periodId=${encodeURIComponent(periodId)}`
    ),

  investigateDiscrepancy: (discrepancyId: string) =>
    request<{ discrepancy: Discrepancy }>(
      `/api/discrepancies/${encodeURIComponent(discrepancyId)}/investigate`,
      { method: 'POST' }
    ),

  updateDiscrepancyStatus: (
    discrepancyId: string,
    status: DiscrepancyStatus,
    resolutionNotes?: string
  ) =>
    request<{ discrepancy: Discrepancy }>(
      `/api/discrepancies/${encodeURIComponent(discrepancyId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, resolutionNotes }),
      }
    ),

  getSuppliers: (clientId: string) =>
    request<{
      suppliers: Array<{
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
      }>;
    }>(`/api/suppliers?clientId=${encodeURIComponent(clientId)}`),

  getFollowUps: (clientId: string, periodId: string) =>
    request<{ followUps: SupplierFollowUp[] }>(
      `/api/followups?clientId=${encodeURIComponent(clientId)}&periodId=${encodeURIComponent(periodId)}`
    ),

  generateFollowUp: (discrepancyId: string) =>
    request<{ followUp: SupplierFollowUp }>('/api/followups/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discrepancyId }),
    }),

  updateFollowUp: (
    followUpId: string,
    payload: {
      channel?: 'EMAIL' | 'WHATSAPP';
      subject?: string;
      emailBody?: string;
      whatsappBody?: string;
      responseNotes?: string;
      status?: FollowUpStatus;
    }
  ) =>
    request<{ followUp: SupplierFollowUp }>(
      `/api/followups/${encodeURIComponent(followUpId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    ),

  getReport: (clientId: string, periodId: string, type: string) =>
    request<{
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
    }>(
      `/api/reports?clientId=${encodeURIComponent(clientId)}&periodId=${encodeURIComponent(periodId)}&type=${encodeURIComponent(type)}`
    ),

  askAssistant: (clientId: string, periodId: string, question: string) =>
    request<{ answer: string; citedInvoices: string[]; disclaimer: string }>(
      '/api/assistant/query',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, periodId, question }),
      }
    ),
};
