import express, { type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type {
  DashboardPayload,
  DiscrepancyStatus,
  FollowUpStatus,
  GlobalSearchResult,
  Invoice,
  InvoiceExtraction,
  LatestDocumentImportItem,
  PendingReviewQueueItem,
  ReconciliationOutcome,
} from '../../src/shared/types.ts';
import {
  AssistantQuerySchema,
  FollowUpUpdateSchema,
  InvoiceExtractionUpdateSchema,
  ReconciliationConfigSchema,
  isValidGstinFormat,
  normalizeDateString,
  normalizeInvoiceNumber,
  roundCurrency,
} from '../../src/shared/validation.ts';
import {
  appendAuditLog,
  assertClientOwnership,
  getStore,
  resetDemoStore,
  saveStore,
} from '../persistence/store.ts';
import {
  GSTR2B_EXPECTED_FIELDS,
  PURCHASE_REGISTER_EXPECTED_FIELDS,
  autoDetectColumnMapping,
  generateSampleTemplateBuffer,
  parseCsvOrXlsxBuffer,
  validateAndBuildGstr2bEntries,
  validateAndBuildPurchaseEntries,
} from '../services/fileParserService.ts';
import {
  answerAssistantQueryWithGemini,
  extractInvoiceWithGemini,
  generateFollowUpWithGemini,
  investigateDiscrepancyWithGemini,
  revalidateExtractionRecord,
} from '../services/geminiService.ts';
import { runDeterministicReconciliation } from '../services/reconciliationService.ts';
import { buildReport, type ReportType } from '../services/reportService.ts';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB limit
  },
});

const ALLOWED_INVOICE_MIMES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
]);

function resolveInvoiceMime(mimetype: string, originalname: string): string | null {
  const lower = (mimetype || '').toLowerCase().trim();
  if (lower === 'image/jpg') return 'image/jpeg';
  if (ALLOWED_INVOICE_MIMES.has(lower)) return lower;
  if (!lower || lower === 'application/octet-stream' || lower === 'binary/octet-stream') {
    const ext = originalname.toLowerCase().split('.').pop();
    if (ext === 'pdf') return 'application/pdf';
    if (ext === 'png') return 'image/png';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  }
  return null;
}

function getClientAndPeriod(req: Request) {
  const store = getStore();
  const clientId = String(req.query.clientId || req.body?.clientId || store.clients[0]?.id || '');
  const periodId = String(req.query.periodId || req.body?.periodId || '2026-10');

  if (!assertClientOwnership(store, clientId)) {
    throw Object.assign(new Error('Unauthorized or unknown client workspace.'), { status: 403 });
  }
  const client = store.clients.find((c) => c.id === clientId)!;
  const period = store.periods.find((p) => p.id === periodId) ?? store.periods[2];
  return { store, client, period };
}

function syncLatestRunSummary(
  store: ReturnType<typeof getStore>,
  clientId: string,
  periodId: string
): void {
  const runs = store.reconciliationRuns
    .filter((r) => r.clientId === clientId && r.periodId === periodId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latestRun = runs[0];
  if (!latestRun) return;

  const runResults = store.reconciliationResults.filter((r) => r.runId === latestRun.id);
  const periodDiscs = store.discrepancies.filter(
    (d) => d.clientId === clientId && d.periodId === periodId
  );
  const matchedCount = runResults.filter((r) => r.outcome === 'MATCHED').length;
  const unmatchedCount = runResults.length - matchedCount;
  const needsReviewCount = runResults.filter(
    (r) => r.humanReviewStatus === 'PENDING_REVIEW'
  ).length;
  const potentiallyAffectedTax = roundCurrency(
    periodDiscs
      .filter((d) => d.status !== 'RESOLVED' && d.status !== 'CLOSED')
      .reduce((sum, d) => sum + d.potentiallyAffectedTax, 0)
  );

  latestRun.summary = {
    ...latestRun.summary,
    totalProcessed: runResults.length,
    matchedCount,
    unmatchedCount,
    discrepancyCount: periodDiscs.length,
    needsReviewCount,
    potentiallyAffectedTax,
  };
}

router.get('/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'),
    timestamp: new Date().toISOString(),
  });
});

router.get('/workspace', (_req: Request, res: Response) => {
  const store = getStore();
  res.json({
    workspace: store.workspace,
    clients: store.clients,
    gstRegistrations: store.gstRegistrations,
    periods: store.periods,
    reconciliationConfig: store.reconciliationConfig,
  });
});

router.post('/workspace/reset', (_req: Request, res: Response) => {
  const store = resetDemoStore();
  res.json({ ok: true, workspace: store.workspace, clients: store.clients });
});

router.post('/workspace/clients', (req: Request, res: Response) => {
  const schema = z.object({
    legalName: z.string().trim().min(2).max(150),
    tradeName: z.string().trim().min(2).max(150),
    gstin: z.string().trim().toUpperCase(),
    stateName: z.string().trim().min(2).max(80),
    sector: z.string().trim().min(2).max(100),
    contactEmail: z.string().trim().email(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid client details.' });
    return;
  }
  if (!isValidGstinFormat(parsed.data.gstin)) {
    res.status(400).json({ error: 'Invalid 15-character GSTIN format.' });
    return;
  }
  const now = new Date().toISOString();
  const id = `client_${Date.now()}`;
  const stateCode = parsed.data.gstin.slice(0, 2);

  const updated = saveStore((store) => {
    store.clients.push({
      id,
      workspaceId: store.workspace.id,
      legalName: parsed.data.legalName,
      tradeName: parsed.data.tradeName,
      gstin: parsed.data.gstin,
      stateCode,
      stateName: parsed.data.stateName,
      sector: parsed.data.sector,
      contactEmail: parsed.data.contactEmail,
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    });
    store.gstRegistrations.push({
      id: `gstreg_${Date.now()}`,
      workspaceId: store.workspace.id,
      clientId: id,
      gstin: parsed.data.gstin,
      stateName: parsed.data.stateName,
      registrationType: 'REGULAR',
      filingFrequency: 'MONTHLY',
    });
    appendAuditLog(store, {
      workspaceId: store.workspace.id,
      clientId: id,
      periodId: '2026-10',
      actor: 'Workspace Admin',
      action: 'CLIENT_CREATED',
      entityType: 'WORKSPACE',
      entityId: id,
      summary: `Added GST client workspace ${parsed.data.tradeName} (${parsed.data.gstin}).`,
    });
  });

  res.status(201).json({ client: updated.clients.find((c) => c.id === id) });
});

router.patch('/workspace/config', (req: Request, res: Response) => {
  const bodySchema = z.object({
    reconciliationConfig: ReconciliationConfigSchema.optional(),
    userRoleView: z.enum(['MSME', 'ACCOUNTANT', 'CA_FIRM']).optional(),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid workspace configuration.' });
    return;
  }
  const store = saveStore((s) => {
    if (parsed.data.reconciliationConfig) {
      s.reconciliationConfig = parsed.data.reconciliationConfig;
    }
    if (parsed.data.userRoleView) {
      s.workspace.userRoleView = parsed.data.userRoleView;
    }
  });
  res.json({
    workspace: store.workspace,
    reconciliationConfig: store.reconciliationConfig,
  });
});

// =========================================================================
// DASHBOARD
// =========================================================================
router.get('/dashboard', (req: Request, res: Response) => {
  const { store, client, period } = getClientAndPeriod(req);

  const clientInvoices = store.invoices.filter(
    (i) => i.clientId === client.id && i.periodId === period.id
  );
  const clientPr = store.purchaseEntries.filter(
    (p) => p.clientId === client.id && p.periodId === period.id
  );
  const client2b = store.gstr2bEntries.filter(
    (g) => g.clientId === client.id && g.periodId === period.id
  );
  const clientRuns = store.reconciliationRuns
    .filter((r) => r.clientId === client.id && r.periodId === period.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latestRun = clientRuns[0] ?? null;

  const clientResults = latestRun
    ? store.reconciliationResults.filter((r) => r.runId === latestRun.id)
    : [];
  const clientDiscs = store.discrepancies.filter(
    (d) => d.clientId === client.id && d.periodId === period.id
  );

  const matchedInvoices = clientResults.filter((r) => r.outcome === 'MATCHED').length;
  const unmatchedInvoices = clientResults.length - matchedInvoices;
  const openDiscs = clientDiscs.filter((d) => d.status !== 'RESOLVED' && d.status !== 'CLOSED');
  const resolvedDiscs = clientDiscs.filter((d) => d.status === 'RESOLVED' || d.status === 'CLOSED');
  const potentialItcUnderInvestigation = roundCurrency(
    openDiscs.reduce((sum, d) => sum + d.potentiallyAffectedTax, 0)
  );
  const totalEvaluated = clientResults.length;
  const completionPct =
    totalEvaluated > 0
      ? Math.round(((matchedInvoices + resolvedDiscs.length) / totalEvaluated) * 100)
      : 0;

  // Monthly trend across all periods for this client
  const monthlyTrend = store.periods.map((p) => {
    const pRuns = store.reconciliationRuns
      .filter((r) => r.clientId === client.id && r.periodId === p.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const r = pRuns[0];
    const matched = r?.summary.matchedCount ?? 0;
    const unmatched = r?.summary.unmatchedCount ?? 0;
    const total = matched + unmatched;
    const pDiscs = store.discrepancies.filter(
      (d) => d.clientId === client.id && d.periodId === p.id && d.status !== 'RESOLVED' && d.status !== 'CLOSED'
    );
    return {
      periodId: p.id,
      periodLabel: p.shortLabel,
      matched,
      unmatched,
      completionPercent: total > 0 ? Math.round((matched / total) * 100) : 0,
      openDiscrepancies: pDiscs.length,
      potentiallyAffectedTax: roundCurrency(
        pDiscs.reduce((sum, d) => sum + d.potentiallyAffectedTax, 0)
      ),
    };
  });

  // Category breakdown
  const catMap = new Map<ReconciliationOutcome, { count: number; taxAmount: number }>();
  for (const d of clientDiscs) {
    const prev = catMap.get(d.category) ?? { count: 0, taxAmount: 0 };
    prev.count += 1;
    prev.taxAmount = roundCurrency(prev.taxAmount + d.potentiallyAffectedTax);
    catMap.set(d.category, prev);
  }
  const categoryLabels: Record<string, string> = {
    MISSING_IN_GSTR2B: 'Missing in GSTR-2B',
    TAX_AMOUNT_MISMATCH: 'Tax Amount Mismatch',
    TAXABLE_VALUE_MISMATCH: 'Taxable Value Mismatch',
    GSTIN_MISMATCH: 'GSTIN Mismatch',
    POSSIBLE_DUPLICATE: 'Possible Duplicate',
    NEEDS_MANUAL_REVIEW: 'Needs Manual Review',
    MISSING_IN_PURCHASE_REGISTER: 'Extra in GSTR-2B',
    INVOICE_NUMBER_MISMATCH: 'Invoice No. Mismatch',
    DATE_MISMATCH: 'Date Mismatch',
  };
  const categoryBreakdown = Array.from(catMap.entries()).map(([category, stats]) => ({
    category,
    label: categoryLabels[category] ?? category,
    count: stats.count,
    taxAmount: stats.taxAmount,
  }));

  // Supplier-wise outstanding discrepancies (across periods for recurring count)
  const supMap = new Map<
    string,
    { supplierGstin: string; supplierName: string; openCount: number; periods: Set<string>; taxUnderInvestigation: number }
  >();
  for (const d of store.discrepancies.filter((x) => x.clientId === client.id && x.status !== 'RESOLVED' && x.status !== 'CLOSED')) {
    const entry = supMap.get(d.supplierGstin) ?? {
      supplierGstin: d.supplierGstin,
      supplierName: d.supplierName,
      openCount: 0,
      periods: new Set<string>(),
      taxUnderInvestigation: 0,
    };
    entry.periods.add(d.periodId);
    if (d.periodId === period.id) {
      entry.openCount += 1;
      entry.taxUnderInvestigation = roundCurrency(entry.taxUnderInvestigation + d.potentiallyAffectedTax);
    }
    supMap.set(d.supplierGstin, entry);
  }
  const supplierOutstanding = Array.from(supMap.values())
    .filter((s) => s.openCount > 0)
    .map((s) => ({
      supplierGstin: s.supplierGstin,
      supplierName: s.supplierName,
      openCount: s.openCount,
      recurringPeriods: s.periods.size,
      taxUnderInvestigation: s.taxUnderInvestigation,
    }))
    .sort((a, b) => b.taxUnderInvestigation - a.taxUnderInvestigation);

  const recentActivity = store.auditLogs
    .filter((l) => l.clientId === client.id && l.periodId === period.id)
    .slice(0, 12);

  // Pending review queue combining invoices needing review + pending reconciliation/discrepancy reviews
  const pendingReviewQueue: PendingReviewQueueItem[] = [];
  for (const inv of clientInvoices) {
    if (inv.status === 'NEEDS_REVIEW' || inv.status === 'EXTRACTED' || Boolean(inv.extractionError)) {
      const ext = inv.extractionId
        ? store.extractions.find((e) => e.id === inv.extractionId)
        : null;
      pendingReviewQueue.push({
        id: inv.id,
        kind: 'INVOICE_EXTRACTION',
        title: ext?.invoiceNumber.value || inv.fileName,
        subtitle: ext?.supplierName.value || (inv.extractionError ? 'Extraction failed — retry needed' : 'Pending review'),
        amount: ext?.grandTotal.value ?? null,
        statusLabel: inv.extractionError ? 'Extract Failed' : inv.status === 'NEEDS_REVIEW' ? 'Needs Review' : 'Extracted',
        priority: inv.extractionError || inv.status === 'NEEDS_REVIEW' ? 'HIGH' : 'MEDIUM',
        route: '/documents',
      });
    }
  }
  for (const r of clientResults) {
    if (r.humanReviewStatus === 'PENDING_REVIEW' && r.outcome !== 'MATCHED') {
      pendingReviewQueue.push({
        id: r.id,
        kind: r.matchMethod === 'FUZZY_CANDIDATE' ? 'FUZZY_MATCH' : 'DISCREPANCY',
        title: r.invoiceNumber,
        subtitle: `${r.supplierName} · ${r.matchMethod === 'FUZZY_CANDIDATE' ? 'Fuzzy candidate match' : r.outcome.replace(/_/g, ' ')}`,
        amount: Math.abs(r.taxDifference) > 0 ? Math.abs(r.taxDifference) : r.prTotalTax,
        statusLabel: r.matchMethod === 'FUZZY_CANDIDATE' ? 'Confirm Candidate' : 'Review Match',
        priority: Math.abs(r.taxDifference) >= 5000 ? 'HIGH' : 'MEDIUM',
        route: r.discrepancyId ? `/discrepancies?id=${encodeURIComponent(r.discrepancyId)}` : '/reconciliation',
      });
    }
  }

  // Latest document imports across invoices, PR, and GSTR-2B
  const latestDocumentImports: LatestDocumentImportItem[] = [
    ...clientInvoices.slice(0, 6).map((inv): LatestDocumentImportItem => ({
      id: inv.id,
      kind: 'INVOICE',
      fileName: inv.fileName,
      recordCountLabel: inv.mimeType.replace('application/', '').replace('image/', '').toUpperCase(),
      statusLabel: inv.extractionError ? 'Failed' : inv.status,
      tone: inv.extractionError
        ? 'red'
        : inv.status === 'APPROVED'
          ? 'green'
          : inv.status === 'NEEDS_REVIEW'
            ? 'amber'
            : 'blue',
      createdAt: inv.createdAt,
      route: '/documents?tab=invoices',
    })),
    ...store.purchaseImports
      .filter((imp) => imp.clientId === client.id && imp.periodId === period.id)
      .slice(0, 4)
      .map((imp): LatestDocumentImportItem => ({
        id: imp.id,
        kind: 'PURCHASE_REGISTER',
        fileName: imp.fileName,
        recordCountLabel: `${imp.validCount}/${imp.rowCount} valid rows`,
        statusLabel: imp.invalidCount > 0 ? `${imp.invalidCount} Invalid` : 'Imported',
        tone: imp.invalidCount > 0 ? 'amber' : 'green',
        createdAt: imp.createdAt,
        route: '/documents?tab=purchase-register',
      })),
    ...store.gstr2bImports
      .filter((imp) => imp.clientId === client.id && imp.periodId === period.id)
      .slice(0, 4)
      .map((imp): LatestDocumentImportItem => ({
        id: imp.id,
        kind: 'GSTR2B',
        fileName: imp.fileName,
        recordCountLabel: `${imp.validCount}/${imp.rowCount} docs`,
        statusLabel: imp.invalidCount > 0 ? `${imp.invalidCount} Invalid` : 'Imported',
        tone: imp.invalidCount > 0 ? 'amber' : 'green',
        createdAt: imp.createdAt,
        route: '/documents?tab=gstr-2b',
      })),
  ]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8);

  // Tax Component Summary (PR vs GSTR-2B)
  const taxComponentSummary = {
    taxablePr: roundCurrency(clientPr.reduce((s, p) => s + p.taxableValue, 0)),
    taxable2b: roundCurrency(client2b.reduce((s, g) => s + g.taxableValue, 0)),
    cgstPr: roundCurrency(clientPr.reduce((s, p) => s + p.cgst, 0)),
    cgst2b: roundCurrency(client2b.reduce((s, g) => s + g.cgst, 0)),
    sgstPr: roundCurrency(clientPr.reduce((s, p) => s + p.sgst, 0)),
    sgst2b: roundCurrency(client2b.reduce((s, g) => s + g.sgst, 0)),
    igstPr: roundCurrency(clientPr.reduce((s, p) => s + p.igst, 0)),
    igst2b: roundCurrency(client2b.reduce((s, g) => s + g.igst, 0)),
    cessPr: roundCurrency(clientPr.reduce((s, p) => s + p.cess, 0)),
    cess2b: roundCurrency(client2b.reduce((s, g) => s + g.cess, 0)),
    totalTaxPr: roundCurrency(clientPr.reduce((s, p) => s + p.totalTax, 0)),
    totalTax2b: roundCurrency(client2b.reduce((s, g) => s + g.totalTax, 0)),
  };

  const payload: DashboardPayload = {
    workspace: store.workspace,
    client,
    clients: store.clients,
    period,
    periods: store.periods,
    kpis: {
      totalInvoicesProcessed: clientInvoices.length,
      approvedInvoices: clientInvoices.filter((i) => i.status === 'APPROVED').length,
      invoicesNeedingReview: clientInvoices.filter(
        (i) => i.status === 'NEEDS_REVIEW' || i.status === 'EXTRACTED'
      ).length,
      totalPurchaseRegisterEntries: clientPr.length,
      totalGstr2bEntries: client2b.length,
      matchedInvoices,
      unmatchedInvoices,
      discrepanciesRequiringReview: clientDiscs.filter((d) => d.needsCaReview && d.status !== 'RESOLVED').length,
      openDiscrepancies: openDiscs.length,
      resolvedDiscrepancies: resolvedDiscs.length,
      potentialItcUnderInvestigation,
      reconciliationCompletionPercent: completionPct,
    },
    monthlyTrend,
    categoryBreakdown,
    supplierOutstanding,
    pendingReviewQueue: pendingReviewQueue.slice(0, 8),
    latestDocumentImports,
    taxComponentSummary,
    recentActivity,
    latestRun,
  };

  res.json(payload);
});

// =========================================================================
// AUDIT LOGS & GLOBAL SEARCH
// =========================================================================
router.get('/audit-logs', (req: Request, res: Response) => {
  const { store, client, period } = getClientAndPeriod(req);
  const scope = String(req.query.scope || 'PERIOD');
  const entityType = String(req.query.entityType || 'ALL');
  const search = String(req.query.search || '').trim().toLowerCase();

  let logs = store.auditLogs.filter((l) => l.clientId === client.id);
  if (scope !== 'ALL') {
    logs = logs.filter((l) => l.periodId === period.id);
  }
  if (entityType !== 'ALL') {
    logs = logs.filter((l) => l.entityType === entityType);
  }
  if (search) {
    logs = logs.filter((l) =>
      `${l.summary} ${l.actor} ${l.action} ${l.entityId} ${l.affectedRecord ?? ''}`
        .toLowerCase()
        .includes(search)
    );
  }

  const normalized = logs.map((l) => {
    let approvalStatus = l.approvalStatus;
    if (!approvalStatus) {
      if (l.action.includes('APPROVE') || l.action.includes('RESOLVED')) {
        approvalStatus = 'APPROVED';
      } else if (l.action.includes('REJECT')) {
        approvalStatus = 'REJECTED';
      } else if (l.action.includes('NEEDS_REVIEW') || l.action.includes('DRAFT')) {
        approvalStatus = 'PENDING_REVIEW';
      } else {
        approvalStatus = 'AUTO_LOGGED';
      }
    }
    return {
      ...l,
      affectedRecord: l.affectedRecord || l.entityId,
      previousState: l.previousState || '—',
      updatedState: l.updatedState || l.action.replace(/_/g, ' '),
      approvalStatus,
    };
  });

  res.json({ logs: normalized });
});

router.get('/search', (req: Request, res: Response) => {
  const { store, client, period } = getClientAndPeriod(req);
  const q = String(req.query.q || '').trim().toLowerCase();
  if (!q) {
    res.json({ results: [] });
    return;
  }

  const results: GlobalSearchResult[] = [];

  for (const inv of store.invoices.filter((i) => i.clientId === client.id && i.periodId === period.id)) {
    const ext = inv.extractionId ? store.extractions.find((e) => e.id === inv.extractionId) : null;
    const hay = `${inv.fileName} ${ext?.invoiceNumber.value ?? ''} ${ext?.supplierName.value ?? ''} ${ext?.supplierGstin.value ?? ''}`.toLowerCase();
    if (hay.includes(q)) {
      results.push({
        id: `inv_${inv.id}`,
        kind: 'INVOICE',
        title: ext?.invoiceNumber.value || inv.fileName,
        subtitle: ext?.supplierName.value || inv.fileName,
        meta: `Invoice · ${inv.status}`,
        route: '/documents?tab=invoices',
      });
    }
  }

  for (const d of store.discrepancies.filter((x) => x.clientId === client.id && x.periodId === period.id)) {
    const hay = `${d.invoiceNumber} ${d.supplierName} ${d.supplierGstin} ${d.category}`.toLowerCase();
    if (hay.includes(q)) {
      results.push({
        id: `disc_${d.id}`,
        kind: 'DISCREPANCY',
        title: d.invoiceNumber,
        subtitle: `${d.supplierName} · ${d.category.replace(/_/g, ' ')}`,
        meta: `Exception · ${d.status}`,
        route: `/discrepancies?id=${encodeURIComponent(d.id)}`,
      });
    }
  }

  const runs = store.reconciliationRuns
    .filter((r) => r.clientId === client.id && r.periodId === period.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (runs[0]) {
    for (const r of store.reconciliationResults.filter((x) => x.runId === runs[0].id)) {
      const hay = `${r.invoiceNumber} ${r.supplierName} ${r.supplierGstin} ${r.outcome}`.toLowerCase();
      if (hay.includes(q)) {
        results.push({
          id: `rec_${r.id}`,
          kind: 'RECONCILIATION',
          title: r.invoiceNumber,
          subtitle: `${r.supplierName} · ${r.outcome.replace(/_/g, ' ')}`,
          meta: `Reconciliation · ${r.matchMethod}`,
          route: '/reconciliation',
        });
      }
    }
  }

  for (const s of store.suppliers) {
    const hay = `${s.legalName} ${s.gstin} ${s.category} ${s.email}`.toLowerCase();
    if (hay.includes(q)) {
      results.push({
        id: `sup_${s.id}`,
        kind: 'SUPPLIER',
        title: s.legalName,
        subtitle: `${s.gstin} · ${s.category}`,
        meta: 'Supplier Directory',
        route: '/suppliers',
      });
    }
  }

  res.json({ results: results.slice(0, 16) });
});

// =========================================================================
// INVOICES & GEMINI EXTRACTION
// =========================================================================
router.get('/invoices', (req: Request, res: Response) => {
  const { store, client, period } = getClientAndPeriod(req);
  const invoices = store.invoices
    .filter((i) => i.clientId === client.id && i.periodId === period.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const invoiceIds = new Set(invoices.map((i) => i.id));
  const extractions = store.extractions.filter((e) => invoiceIds.has(e.invoiceId));
  res.json({ invoices, extractions });
});

router.post('/invoices/upload', upload.array('files', 10), async (req: Request, res: Response) => {
  try {
    const { store, client, period } = getClientAndPeriod(req);
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (files.length === 0) {
      res.status(400).json({ error: 'Please select at least one PDF, JPG, or PNG invoice file.' });
      return;
    }

    const autoExtract = String(req.body?.autoExtract ?? 'true') === 'true';
    const createdInvoices: Invoice[] = [];
    const createdExtractions: InvoiceExtraction[] = [];
    const extractionErrors: Array<{ fileName: string; error: string }> = [];

    for (const file of files) {
      const normalizedMime = resolveInvoiceMime(file.mimetype, file.originalname);
      if (!normalizedMime) {
        extractionErrors.push({
          fileName: file.originalname,
          error: `Unsupported file type (${file.mimetype || 'unknown'}). Allowed: PDF, PNG, JPG.`,
        });
        continue;
      }

      const now = new Date().toISOString();
      const invoiceId = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const dataUrl = `data:${normalizedMime};base64,${file.buffer.toString('base64')}`;

      const invoice: Invoice = {
        id: invoiceId,
        workspaceId: store.workspace.id,
        clientId: client.id,
        periodId: period.id,
        fileName: file.originalname,
        mimeType: normalizedMime,
        fileSize: file.size,
        fileDataUrl: dataUrl,
        uploadSource: 'USER_UPLOAD',
        status: 'UPLOADED',
        extractionId: null,
        extractionError: null,
        extractedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      if (autoExtract) {
        try {
          const extraction = await extractInvoiceWithGemini({
            invoiceId,
            fileBuffer: file.buffer,
            mimeType: normalizedMime,
            fileName: file.originalname,
          });
          invoice.extractionId = extraction.id;
          invoice.status = extraction.reviewRequired ? 'NEEDS_REVIEW' : 'EXTRACTED';
          invoice.extractionError = null;
          invoice.extractedAt = extraction.createdAt;
          createdExtractions.push(extraction);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'Extraction failed.';
          invoice.extractionError = errMsg;
          invoice.extractedAt = null;
          extractionErrors.push({
            fileName: file.originalname,
            error: errMsg,
          });
        }
      }

      createdInvoices.push(invoice);
    }

    if (createdInvoices.length === 0 && extractionErrors.length > 0) {
      res.status(400).json({
        error: extractionErrors[0].error,
        errors: extractionErrors,
      });
      return;
    }

    saveStore((s) => {
      s.invoices.unshift(...createdInvoices);
      s.extractions.unshift(...createdExtractions);
      for (const inv of createdInvoices) {
        appendAuditLog(s, {
          workspaceId: s.workspace.id,
          clientId: client.id,
          periodId: period.id,
          actor: 'User',
          action: inv.extractionId
            ? 'INVOICE_EXTRACTED'
            : inv.extractionError
              ? 'INVOICE_EXTRACTION_FAILED'
              : 'INVOICE_UPLOADED',
          entityType: 'INVOICE',
          entityId: inv.id,
          summary: inv.extractionId
            ? `Uploaded & extracted ${inv.fileName} via Gemini multimodal parser.`
            : inv.extractionError
              ? `Uploaded ${inv.fileName}; Gemini extraction failed (${inv.extractionError}).`
              : `Uploaded ${inv.fileName} (extraction pending).`,
        });
      }
    });

    res.status(201).json({
      invoices: createdInvoices,
      extractions: createdExtractions,
      errors: extractionErrors,
    });
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Invoice upload failed.' });
  }
});

// Helper to test Step 2-5 with a realistic synthetic PDF invoice sent through Gemini
router.post('/invoices/sample-upload', async (req: Request, res: Response) => {
  try {
    const { store, client, period } = getClientAndPeriod(req);
    const now = new Date().toISOString();
    const invoiceId = `inv_sample_${Date.now()}`;
    const invNum = `ABC/SAMP/${Math.floor(100 + Math.random() * 899)}`;
    const pdfBuffer = buildMinimalInvoicePdf({
      supplierName: 'ABC Distributors (Demo)',
      supplierGstin: '19ABCDE1234F1Z5',
      recipientName: client.legalName,
      recipientGstin: client.gstin,
      invoiceNumber: invNum,
      invoiceDate: `${period.id}-15`,
      taxableValue: 18500,
      cgst: 1665,
      sgst: 1665,
      totalTax: 3330,
      grandTotal: 21830,
    });

    const invoice: Invoice = {
      id: invoiceId,
      workspaceId: store.workspace.id,
      clientId: client.id,
      periodId: period.id,
      fileName: `${invNum.replace(/\//g, '_')}_sample.pdf`,
      mimeType: 'application/pdf',
      fileSize: pdfBuffer.length,
      fileDataUrl: `data:application/pdf;base64,${pdfBuffer.toString('base64')}`,
      uploadSource: 'USER_UPLOAD',
      status: 'UPLOADED',
      extractionId: null,
      extractionError: null,
      extractedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    let extraction: InvoiceExtraction | null = null;
    let extractionError: string | null = null;

    try {
      extraction = await extractInvoiceWithGemini({
        invoiceId,
        fileBuffer: pdfBuffer,
        mimeType: 'application/pdf',
        fileName: invoice.fileName,
      });
      invoice.extractionId = extraction.id;
      invoice.status = extraction.reviewRequired ? 'NEEDS_REVIEW' : 'EXTRACTED';
      invoice.extractionError = null;
      invoice.extractedAt = extraction.createdAt;
    } catch (err) {
      extractionError = err instanceof Error ? err.message : 'Extraction failed';
      invoice.extractionError = extractionError;
      invoice.extractedAt = null;
    }

    saveStore((s) => {
      s.invoices.unshift(invoice);
      if (extraction) s.extractions.unshift(extraction);
      appendAuditLog(s, {
        workspaceId: s.workspace.id,
        clientId: client.id,
        periodId: period.id,
        actor: 'User',
        action: extraction ? 'INVOICE_EXTRACTED' : 'INVOICE_EXTRACTION_FAILED',
        entityType: 'INVOICE',
        entityId: invoice.id,
        summary: extraction
          ? `Uploaded sample PDF invoice ${invoice.fileName} and extracted structured GST fields via Gemini.`
          : `Uploaded sample PDF invoice ${invoice.fileName} (extraction error: ${extractionError}).`,
      });
    });

    res.status(201).json({ invoice, extraction, error: extractionError });
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Sample upload failed.' });
  }
});

router.post('/invoices/:id/extract', async (req: Request, res: Response) => {
  const store = getStore();
  const invoice = store.invoices.find((i) => i.id === req.params.id);
  if (!invoice) {
    res.status(404).json({ error: 'Invoice not found.' });
    return;
  }

  const requestedClientId = req.query.clientId || req.body?.clientId;
  if (requestedClientId && String(requestedClientId) !== invoice.clientId) {
    res.status(403).json({ error: 'Invoice does not belong to the selected client workspace.' });
    return;
  }

  const normalizedMime = resolveInvoiceMime(invoice.mimeType, invoice.fileName);
  if (!normalizedMime || !invoice.fileDataUrl || !invoice.fileDataUrl.includes('base64,')) {
    res.status(400).json({
      error: 'Extraction requires an uploaded PDF, PNG, or JPG invoice (pre-seeded SVG previews are already structured).',
    });
    return;
  }

  const base64Part = invoice.fileDataUrl.split('base64,')[1];
  const fileBuffer = Buffer.from(base64Part, 'base64');

  try {
    const extraction = await extractInvoiceWithGemini({
      invoiceId: invoice.id,
      fileBuffer,
      mimeType: normalizedMime,
      fileName: invoice.fileName,
    });

    const updated = saveStore((s) => {
      const target = s.invoices.find((i) => i.id === invoice.id);
      if (target) {
        target.extractionId = extraction.id;
        target.status = extraction.reviewRequired ? 'NEEDS_REVIEW' : 'EXTRACTED';
        target.extractionError = null;
        target.extractedAt = extraction.createdAt;
        target.updatedAt = new Date().toISOString();
      }
      s.extractions.unshift(extraction);
      appendAuditLog(s, {
        workspaceId: s.workspace.id,
        clientId: invoice.clientId,
        periodId: invoice.periodId,
        actor: 'User',
        action: 'INVOICE_REEXTRACTED',
        entityType: 'INVOICE',
        entityId: invoice.id,
        summary: `Extracted ${invoice.fileName} via Gemini (overall confidence ${Math.round(extraction.overallConfidence * 100)}%).`,
      });
    });

    res.json({ invoice: updated.invoices.find((i) => i.id === invoice.id), extraction });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Gemini extraction failed.';
    const updated = saveStore((s) => {
      const target = s.invoices.find((i) => i.id === invoice.id);
      if (target) {
        target.extractionError = errMsg;
        target.updatedAt = new Date().toISOString();
      }
      appendAuditLog(s, {
        workspaceId: s.workspace.id,
        clientId: invoice.clientId,
        periodId: invoice.periodId,
        actor: 'User',
        action: 'INVOICE_EXTRACTION_FAILED',
        entityType: 'INVOICE',
        entityId: invoice.id,
        summary: `Gemini extraction retry failed for ${invoice.fileName}: ${errMsg}`,
      });
    });
    res.status(502).json({
      error: errMsg,
      invoice: updated.invoices.find((i) => i.id === invoice.id),
    });
  }
});

router.patch('/invoices/:id/extraction', (req: Request, res: Response) => {
  const parsed = InvoiceExtractionUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid extraction values.' });
    return;
  }

  const store = getStore();
  const invoice = store.invoices.find((i) => i.id === req.params.id);
  if (!invoice || !invoice.extractionId) {
    res.status(404).json({ error: 'Invoice extraction not found.' });
    return;
  }

  const requestedClientId = req.query.clientId || req.body?.clientId;
  if (requestedClientId && String(requestedClientId) !== invoice.clientId) {
    res.status(403).json({ error: 'Invoice does not belong to the selected client workspace.' });
    return;
  }

  const data = parsed.data;
  const updated = saveStore((s) => {
    const ext = s.extractions.find((e) => e.id === invoice.extractionId);
    if (!ext) return;
    const now = new Date().toISOString();

    const nextSupplierName = data.supplierName?.trim() || null;
    const nextSupplierGstin = data.supplierGstin?.trim() ? data.supplierGstin.trim().toUpperCase() : null;
    const nextRecipientName = data.recipientName?.trim() || null;
    const nextRecipientGstin = data.recipientGstin?.trim() ? data.recipientGstin.trim().toUpperCase() : null;
    const nextInvoiceNumber = data.invoiceNumber?.trim() || null;
    const nextInvoiceDateRaw = data.invoiceDate?.trim() || null;
    const nextInvoiceDate = nextInvoiceDateRaw ? (normalizeDateString(nextInvoiceDateRaw) ?? nextInvoiceDateRaw) : null;
    const nextPlaceOfSupply = data.placeOfSupply?.trim() || null;

    ext.supplierName = {
      ...ext.supplierName,
      value: nextSupplierName,
      editedByUser: ext.supplierName.editedByUser || nextSupplierName !== ext.supplierName.value,
    };
    ext.supplierGstin = {
      ...ext.supplierGstin,
      value: nextSupplierGstin,
      editedByUser: ext.supplierGstin.editedByUser || nextSupplierGstin !== ext.supplierGstin.value,
    };
    ext.recipientName = {
      ...ext.recipientName,
      value: nextRecipientName,
      editedByUser: ext.recipientName.editedByUser || nextRecipientName !== ext.recipientName.value,
    };
    ext.recipientGstin = {
      ...ext.recipientGstin,
      value: nextRecipientGstin,
      editedByUser: ext.recipientGstin.editedByUser || nextRecipientGstin !== ext.recipientGstin.value,
    };
    ext.invoiceNumber = {
      ...ext.invoiceNumber,
      value: nextInvoiceNumber,
      editedByUser: ext.invoiceNumber.editedByUser || nextInvoiceNumber !== ext.invoiceNumber.value,
    };
    ext.invoiceDate = {
      ...ext.invoiceDate,
      value: nextInvoiceDate,
      editedByUser: ext.invoiceDate.editedByUser || nextInvoiceDate !== ext.invoiceDate.value,
    };
    ext.placeOfSupply = {
      ...ext.placeOfSupply,
      value: nextPlaceOfSupply,
      editedByUser: ext.placeOfSupply.editedByUser || nextPlaceOfSupply !== ext.placeOfSupply.value,
    };

    if (data.hsnSacCodes !== undefined) {
      const prevHsn = ext.hsnSacCodes.value.join(',');
      const nextHsn = data.hsnSacCodes.join(',');
      ext.hsnSacCodes = {
        ...ext.hsnSacCodes,
        value: data.hsnSacCodes,
        editedByUser: ext.hsnSacCodes.editedByUser || prevHsn !== nextHsn,
      };
    }

    ext.taxableValue = {
      ...ext.taxableValue,
      value: data.taxableValue,
      editedByUser: ext.taxableValue.editedByUser || data.taxableValue !== ext.taxableValue.value,
    };
    ext.cgst = {
      ...ext.cgst,
      value: data.cgst,
      editedByUser: ext.cgst.editedByUser || data.cgst !== ext.cgst.value,
    };
    ext.sgst = {
      ...ext.sgst,
      value: data.sgst,
      editedByUser: ext.sgst.editedByUser || data.sgst !== ext.sgst.value,
    };
    ext.igst = {
      ...ext.igst,
      value: data.igst,
      editedByUser: ext.igst.editedByUser || data.igst !== ext.igst.value,
    };
    ext.cess = {
      ...ext.cess,
      value: data.cess,
      editedByUser: ext.cess.editedByUser || data.cess !== ext.cess.value,
    };
    ext.totalTax = {
      ...ext.totalTax,
      value: data.totalTax,
      editedByUser: ext.totalTax.editedByUser || data.totalTax !== ext.totalTax.value,
    };
    ext.grandTotal = {
      ...ext.grandTotal,
      value: data.grandTotal,
      editedByUser: ext.grandTotal.editedByUser || data.grandTotal !== ext.grandTotal.value,
    };
    ext.updatedAt = now;

    revalidateExtractionRecord(ext);

    const inv = s.invoices.find((i) => i.id === invoice.id);
    if (inv) {
      if (data.reviewNotes !== undefined) {
        inv.reviewNotes = data.reviewNotes;
      }
      if (inv.status !== 'APPROVED' && inv.status !== 'REJECTED') {
        inv.status = ext.reviewRequired ? 'NEEDS_REVIEW' : 'EXTRACTED';
      }
      inv.updatedAt = now;
    }

    appendAuditLog(s, {
      workspaceId: s.workspace.id,
      clientId: invoice.clientId,
      periodId: invoice.periodId,
      actor: 'Accountant',
      action: 'EXTRACTION_EDITED',
      entityType: 'INVOICE',
      entityId: invoice.id,
      summary: `Edited extracted fields for ${invoice.fileName} (${nextInvoiceNumber ?? 'N/A'}).`,
    });
  });

  res.json({
    invoice: updated.invoices.find((i) => i.id === invoice.id),
    extraction: updated.extractions.find((e) => e.id === invoice.extractionId),
  });
});

router.post('/invoices/:id/decision', (req: Request, res: Response) => {
  const schema = z.object({
    action: z.enum(['APPROVE', 'REJECT', 'NEEDS_REVIEW']),
    reviewNotes: z.string().max(1000).optional(),
    clientId: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid decision payload.' });
    return;
  }

  const store = getStore();
  const invoice = store.invoices.find((i) => i.id === req.params.id);
  if (!invoice) {
    res.status(404).json({ error: 'Invoice not found.' });
    return;
  }

  const requestedClientId = req.query.clientId || parsed.data.clientId;
  if (requestedClientId && String(requestedClientId) !== invoice.clientId) {
    res.status(403).json({ error: 'Invoice does not belong to the selected client workspace.' });
    return;
  }

  if (parsed.data.action === 'APPROVE' && !invoice.extractionId) {
    res.status(400).json({
      error: 'Cannot approve an invoice before extraction completes. Retry extraction first.',
    });
    return;
  }

  const now = new Date().toISOString();
  const prevStatus = invoice.status;
  const updated = saveStore((s) => {
    const inv = s.invoices.find((i) => i.id === invoice.id);
    if (!inv) return;
    inv.status =
      parsed.data.action === 'APPROVE'
        ? 'APPROVED'
        : parsed.data.action === 'REJECT'
          ? 'REJECTED'
          : 'NEEDS_REVIEW';
    inv.reviewNotes = parsed.data.reviewNotes ?? inv.reviewNotes;
    inv.updatedAt = now;
    if (parsed.data.action === 'APPROVE') {
      inv.approvedBy = 'Accountant / CA Reviewer';
      inv.approvedAt = now;
      const ext = s.extractions.find((e) => e.id === inv.extractionId);
      if (ext) ext.reviewRequired = false;
    }
    appendAuditLog(s, {
      workspaceId: s.workspace.id,
      clientId: inv.clientId,
      periodId: inv.periodId,
      actor: 'Accountant / CA',
      action: `INVOICE_${parsed.data.action}`,
      entityType: 'INVOICE',
      entityId: inv.id,
      summary: `Marked invoice ${inv.fileName} as ${inv.status}.`,
      affectedRecord: inv.fileName,
      previousState: prevStatus,
      updatedState: inv.status,
      approvalStatus:
        parsed.data.action === 'APPROVE'
          ? 'APPROVED'
          : parsed.data.action === 'REJECT'
            ? 'REJECTED'
            : 'PENDING_REVIEW',
    });
  });

  res.json({ invoice: updated.invoices.find((i) => i.id === invoice.id) });
});

// =========================================================================
// PURCHASE REGISTER IMPORT
// =========================================================================
router.get('/templates/:kind/:format', (req: Request, res: Response) => {
  const kind = req.params.kind === 'gstr-2b' ? 'gstr-2b' : 'purchase-register';
  const format = req.params.format === 'xlsx' ? 'xlsx' : 'csv';
  const result = generateSampleTemplateBuffer(kind, format);
  res.setHeader('Content-Type', result.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
  res.send(result.buffer);
});

router.get('/purchase-register', (req: Request, res: Response) => {
  const { store, client, period } = getClientAndPeriod(req);
  const imports = store.purchaseImports
    .filter((imp) => imp.clientId === client.id && imp.periodId === period.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const entries = store.purchaseEntries.filter(
    (e) => e.clientId === client.id && e.periodId === period.id
  );
  res.json({ imports, entries });
});

router.post('/purchase-register/preview', upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No spreadsheet file uploaded.' });
    return;
  }
  try {
    const parsed = parseCsvOrXlsxBuffer(req.file.buffer, req.file.originalname);
    const detectedMapping = autoDetectColumnMapping(
      parsed.headers,
      PURCHASE_REGISTER_EXPECTED_FIELDS
    );
    res.json({
      fileName: req.file.originalname,
      headers: parsed.headers,
      detectedMapping,
      totalRows: parsed.rows.length,
      sampleRows: parsed.rows.slice(0, 5),
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to parse file.' });
  }
});

router.post('/purchase-register/import', upload.single('file'), (req: Request, res: Response) => {
  const { store, client, period } = getClientAndPeriod(req);
  if (!req.file) {
    res.status(400).json({ error: 'Please select a CSV or XLSX Purchase Register file.' });
    return;
  }

  try {
    const parsed = parseCsvOrXlsxBuffer(req.file.buffer, req.file.originalname);
    if (parsed.rows.length === 0) {
      res.status(400).json({ error: 'Uploaded Purchase Register file contains no data rows.' });
      return;
    }
    let columnMapping = autoDetectColumnMapping(
      parsed.headers,
      PURCHASE_REGISTER_EXPECTED_FIELDS
    );
    if (req.body?.columnMapping) {
      columnMapping = {
        ...columnMapping,
        ...(JSON.parse(String(req.body.columnMapping)) as Record<string, string>),
      };
    }

    const importId = `primp_${Date.now()}`;
    const existingEntries = store.purchaseEntries.filter(
      (e) => e.clientId === client.id && e.periodId === period.id
    );

    const { entries, errors, duplicateCount } = validateAndBuildPurchaseEntries({
      rows: parsed.rows,
      columnMapping,
      workspaceId: store.workspace.id,
      clientId: client.id,
      periodId: period.id,
      importId,
      existingEntries,
    });

    const importRecord = {
      id: importId,
      workspaceId: store.workspace.id,
      clientId: client.id,
      periodId: period.id,
      fileName: req.file.originalname,
      rowCount: parsed.rows.length,
      validCount: entries.filter((e) => e.isValid).length,
      invalidCount: entries.filter((e) => !e.isValid).length,
      duplicateCount,
      columnMapping,
      errors,
      source: 'USER_UPLOAD' as const,
      createdAt: new Date().toISOString(),
    };

    saveStore((s) => {
      s.purchaseImports.unshift(importRecord);
      s.purchaseEntries.push(...entries);
      appendAuditLog(s, {
        workspaceId: s.workspace.id,
        clientId: client.id,
        periodId: period.id,
        actor: 'User',
        action: 'PURCHASE_REGISTER_IMPORTED',
        entityType: 'PURCHASE_REGISTER',
        entityId: importId,
        summary: `Imported ${entries.length} Purchase Register entries from ${req.file!.originalname} (${duplicateCount} duplicates skipped).`,
      });
    });

    res.status(201).json({ importRecord, entriesAdded: entries.length, errors });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Purchase Register import failed.' });
  }
});

router.patch('/purchase-register/entries/:id', (req: Request, res: Response) => {
  const schema = z.object({
    supplierGstin: z.string().trim().toUpperCase(),
    supplierName: z.string().trim().min(1),
    invoiceNumber: z.string().trim().min(1),
    invoiceDate: z.string().trim(),
    taxableValue: z.number().nonnegative(),
    cgst: z.number().nonnegative(),
    sgst: z.number().nonnegative(),
    igst: z.number().nonnegative(),
    cess: z.number().nonnegative().default(0),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid purchase register entry fields.' });
    return;
  }
  const store = getStore();
  const target = store.purchaseEntries.find((e) => e.id === req.params.id);
  if (!target) {
    res.status(404).json({ error: 'Purchase Register entry not found.' });
    return;
  }

  const d = parsed.data;
  const totalTax = roundCurrency(d.cgst + d.sgst + d.igst + d.cess);
  const totalInvoiceValue = roundCurrency(d.taxableValue + totalTax);
  const errs: string[] = [];
  if (!isValidGstinFormat(d.supplierGstin)) errs.push('Invalid GSTIN format');
  const normDate = normalizeDateString(d.invoiceDate);
  if (!normDate) errs.push('Invalid date format');

  const updated = saveStore((s) => {
    const entry = s.purchaseEntries.find((e) => e.id === target.id);
    if (!entry) return;
    entry.supplierGstin = d.supplierGstin;
    entry.supplierName = d.supplierName;
    entry.invoiceNumber = d.invoiceNumber;
    entry.normalizedInvoiceNumber = normalizeInvoiceNumber(d.invoiceNumber);
    entry.invoiceDate = normDate ?? d.invoiceDate;
    entry.taxableValue = roundCurrency(d.taxableValue);
    entry.cgst = roundCurrency(d.cgst);
    entry.sgst = roundCurrency(d.sgst);
    entry.igst = roundCurrency(d.igst);
    entry.cess = roundCurrency(d.cess);
    entry.totalTax = totalTax;
    entry.totalInvoiceValue = totalInvoiceValue;
    entry.validationErrors = errs;
    entry.isValid = errs.length === 0;
    entry.updatedAt = new Date().toISOString();
  });

  res.json({ entry: updated.purchaseEntries.find((e) => e.id === target.id) });
});

// =========================================================================
// GSTR-2B IMPORT
// =========================================================================
router.get('/gstr2b', (req: Request, res: Response) => {
  const { store, client, period } = getClientAndPeriod(req);
  const imports = store.gstr2bImports
    .filter((imp) => imp.clientId === client.id && imp.periodId === period.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const entries = store.gstr2bEntries.filter(
    (e) => e.clientId === client.id && e.periodId === period.id
  );
  res.json({ imports, entries });
});

router.post('/gstr2b/preview', upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No GSTR-2B file uploaded.' });
    return;
  }
  try {
    const parsed = parseCsvOrXlsxBuffer(req.file.buffer, req.file.originalname);
    const detectedMapping = autoDetectColumnMapping(parsed.headers, GSTR2B_EXPECTED_FIELDS);
    res.json({
      fileName: req.file.originalname,
      headers: parsed.headers,
      detectedMapping,
      totalRows: parsed.rows.length,
      sampleRows: parsed.rows.slice(0, 5),
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to parse GSTR-2B file.' });
  }
});

router.post('/gstr2b/import', upload.single('file'), (req: Request, res: Response) => {
  const { store, client, period } = getClientAndPeriod(req);
  if (!req.file) {
    res.status(400).json({ error: 'Please select a CSV or XLSX GSTR-2B export file.' });
    return;
  }
  try {
    const parsed = parseCsvOrXlsxBuffer(req.file.buffer, req.file.originalname);
    if (parsed.rows.length === 0) {
      res.status(400).json({ error: 'Uploaded GSTR-2B file contains no data rows.' });
      return;
    }
    let columnMapping = autoDetectColumnMapping(parsed.headers, GSTR2B_EXPECTED_FIELDS);
    if (req.body?.columnMapping) {
      columnMapping = {
        ...columnMapping,
        ...(JSON.parse(String(req.body.columnMapping)) as Record<string, string>),
      };
    }

    const importId = `gstr2b_${Date.now()}`;
    const existingEntries = store.gstr2bEntries.filter(
      (e) => e.clientId === client.id && e.periodId === period.id
    );

    const { entries, errors, duplicateCount } = validateAndBuildGstr2bEntries({
      rows: parsed.rows,
      columnMapping,
      workspaceId: store.workspace.id,
      clientId: client.id,
      periodId: period.id,
      importId,
      existingEntries,
    });

    const importRecord = {
      id: importId,
      workspaceId: store.workspace.id,
      clientId: client.id,
      periodId: period.id,
      fileName: req.file.originalname,
      rowCount: parsed.rows.length,
      validCount: entries.filter((e) => e.isValid).length,
      invalidCount: entries.filter((e) => !e.isValid).length,
      duplicateCount,
      errors,
      source: 'USER_UPLOAD' as const,
      createdAt: new Date().toISOString(),
    };

    saveStore((s) => {
      s.gstr2bImports.unshift(importRecord);
      s.gstr2bEntries.push(...entries);
      appendAuditLog(s, {
        workspaceId: s.workspace.id,
        clientId: client.id,
        periodId: period.id,
        actor: 'User',
        action: 'GSTR2B_IMPORTED',
        entityType: 'GSTR2B',
        entityId: importId,
        summary: `Imported ${entries.length} manual GSTR-2B records from ${req.file!.originalname} (${duplicateCount} duplicates skipped).`,
      });
    });

    res.status(201).json({ importRecord, entriesAdded: entries.length, errors });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'GSTR-2B import failed.' });
  }
});

// =========================================================================
// DETERMINISTIC RECONCILIATION
// =========================================================================
router.get('/reconciliation', (req: Request, res: Response) => {
  const { store, client, period } = getClientAndPeriod(req);
  const runs = store.reconciliationRuns
    .filter((r) => r.clientId === client.id && r.periodId === period.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latestRun = runs[0] ?? null;
  const results = latestRun
    ? store.reconciliationResults.filter((r) => r.runId === latestRun.id)
    : [];

  res.json({
    config: store.reconciliationConfig,
    latestRun,
    runs,
    results,
  });
});

router.post('/reconciliation/run', (req: Request, res: Response) => {
  const { store, client, period } = getClientAndPeriod(req);
  const parsedConfig = req.body?.config
    ? ReconciliationConfigSchema.safeParse(req.body.config)
    : { success: true as const, data: store.reconciliationConfig };

  if (!parsedConfig.success) {
    res.status(400).json({ error: 'Invalid tolerance configuration.' });
    return;
  }

  const config = parsedConfig.data;
  const invoices = store.invoices.filter(
    (i) => i.clientId === client.id && i.periodId === period.id
  );
  const invoiceIds = new Set(invoices.map((i) => i.id));
  const extractions = store.extractions.filter((e) => invoiceIds.has(e.invoiceId));
  const purchaseEntries = store.purchaseEntries.filter(
    (p) => p.clientId === client.id && p.periodId === period.id
  );
  const gstr2bEntries = store.gstr2bEntries.filter(
    (g) => g.clientId === client.id && g.periodId === period.id
  );
  const existingDiscrepancies = store.discrepancies.filter(
    (d) => d.clientId === client.id && d.periodId === period.id
  );
  const previousPeriodDiscrepancies = store.discrepancies.filter(
    (d) => d.clientId === client.id && d.periodId < period.id
  );

  const output = runDeterministicReconciliation({
    workspaceId: store.workspace.id,
    clientId: client.id,
    periodId: period.id,
    config,
    invoices,
    extractions,
    purchaseEntries,
    gstr2bEntries,
    existingDiscrepancies,
    previousPeriodDiscrepancies,
  });

  saveStore((s) => {
    s.reconciliationConfig = config;
    s.reconciliationRuns.push(output.run);
    // Replace results & discrepancies for this client + period with fresh deterministic evaluation
    s.reconciliationResults = s.reconciliationResults.filter(
      (r) => !(r.clientId === client.id && r.periodId === period.id)
    );
    s.reconciliationResults.push(...output.results);

    s.discrepancies = s.discrepancies.filter(
      (d) => !(d.clientId === client.id && d.periodId === period.id)
    );
    s.discrepancies.push(...output.discrepancies);

    appendAuditLog(s, {
      workspaceId: s.workspace.id,
      clientId: client.id,
      periodId: period.id,
      actor: 'Deterministic Engine',
      action: 'RECONCILIATION_RUN',
      entityType: 'RECONCILIATION',
      entityId: output.run.id,
      summary: `Ran deterministic reconciliation for ${period.label}: ${output.run.summary.matchedCount} matched, ${output.run.summary.discrepancyCount} discrepancies.`,
    });
  });

  res.json({
    run: output.run,
    results: output.results,
    discrepancies: output.discrepancies,
  });
});

router.post('/reconciliation/results/:id/review', (req: Request, res: Response) => {
  const schema = z.object({
    decision: z.enum(['HUMAN_APPROVED', 'HUMAN_REJECTED']),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid human review decision.' });
    return;
  }

  const store = getStore();
  const target = store.reconciliationResults.find((r) => r.id === req.params.id);
  if (!target) {
    res.status(404).json({ error: 'Reconciliation result not found.' });
    return;
  }

  const now = new Date().toISOString();
  const prevOutcome = target.outcome;
  const updated = saveStore((s) => {
    const row = s.reconciliationResults.find((r) => r.id === target.id);
    if (!row) return;
    row.humanReviewStatus = parsed.data.decision;
    row.updatedAt = now;
    if (parsed.data.decision === 'HUMAN_APPROVED') {
      row.outcome = 'MATCHED';
      row.discrepancyCategory = null;
      row.matchMethod = 'HUMAN_CONFIRMED';
      row.explanation = `${row.explanation} Confirmed by human reviewer.`;
      if (row.discrepancyId) {
        const disc = s.discrepancies.find((d) => d.id === row.discrepancyId);
        if (disc) {
          disc.status = 'RESOLVED';
          disc.resolvedBy = 'CA / Accountant Reviewer';
          disc.resolvedAt = now;
          disc.resolutionNotes = 'Match manually confirmed during reconciliation review.';
          disc.updatedAt = now;
        }
      }
    } else if (parsed.data.decision === 'HUMAN_REJECTED') {
      if (row.outcome === 'MATCHED') {
        row.outcome = 'NEEDS_MANUAL_REVIEW';
      }
      row.discrepancyCategory = row.outcome;
      row.explanation = `${row.explanation} Candidate match rejected by human reviewer.`;
      if (row.discrepancyId) {
        const disc = s.discrepancies.find((d) => d.id === row.discrepancyId);
        if (disc) {
          disc.status = 'UNDER_REVIEW';
          disc.resolutionNotes = 'Candidate match rejected during reconciliation review; requires correction.';
          disc.updatedAt = now;
        }
      }
    }
    appendAuditLog(s, {
      workspaceId: s.workspace.id,
      clientId: row.clientId,
      periodId: row.periodId,
      actor: 'CA / Accountant',
      action: `RECONCILIATION_${parsed.data.decision}`,
      entityType: 'RECONCILIATION',
      entityId: row.id,
      summary: `Marked ${row.invoiceNumber} as ${parsed.data.decision}.`,
      affectedRecord: row.invoiceNumber,
      previousState: prevOutcome,
      updatedState: row.outcome,
      approvalStatus: parsed.data.decision === 'HUMAN_APPROVED' ? 'APPROVED' : 'REJECTED',
    });
    syncLatestRunSummary(s, row.clientId, row.periodId);
  });

  res.json({ result: updated.reconciliationResults.find((r) => r.id === target.id) });
});

// =========================================================================
// DISCREPANCIES & AI INVESTIGATION
// =========================================================================
router.get('/discrepancies', (req: Request, res: Response) => {
  const { store, client, period } = getClientAndPeriod(req);
  const discrepancies = store.discrepancies.filter(
    (d) => d.clientId === client.id && d.periodId === period.id
  );
  const carriedForwardHistory = store.discrepancies.filter(
    (d) => d.clientId === client.id && d.periodId !== period.id && d.status !== 'RESOLVED' && d.status !== 'CLOSED'
  );
  const results = store.reconciliationResults.filter(
    (r) => r.clientId === client.id && r.periodId === period.id
  );
  const followUps = store.followUps.filter(
    (f) => f.clientId === client.id && f.periodId === period.id
  );
  res.json({ discrepancies, carriedForwardHistory, results, followUps });
});

router.post('/discrepancies/:id/investigate', async (req: Request, res: Response) => {
  const store = getStore();
  const discrepancy = store.discrepancies.find((d) => d.id === req.params.id);
  if (!discrepancy) {
    res.status(404).json({ error: 'Discrepancy not found.' });
    return;
  }

  const client = store.clients.find((c) => c.id === discrepancy.clientId)!;
  const period = store.periods.find((p) => p.id === discrepancy.periodId) ?? store.periods[2];
  const result = store.reconciliationResults.find((r) => r.id === discrepancy.reconciliationResultId) ?? null;
  const invoice = result?.invoiceId ? store.invoices.find((i) => i.id === result.invoiceId) ?? null : null;
  const extraction = invoice?.extractionId
    ? store.extractions.find((e) => e.id === invoice.extractionId) ?? null
    : null;
  const purchaseEntry = result?.purchaseEntryId
    ? store.purchaseEntries.find((p) => p.id === result.purchaseEntryId) ?? null
    : null;
  const gstr2bEntry = result?.gstr2bEntryId
    ? store.gstr2bEntries.find((g) => g.id === result.gstr2bEntryId) ?? null
    : null;

  try {
    const report = await investigateDiscrepancyWithGemini({
      discrepancy,
      result,
      invoice,
      extraction,
      purchaseEntry,
      gstr2bEntry,
      client,
      period,
    });

    const updated = saveStore((s) => {
      const target = s.discrepancies.find((d) => d.id === discrepancy.id);
      if (target) {
        target.aiInvestigation = report;
        if (target.status === 'OPEN') target.status = 'UNDER_REVIEW';
        target.updatedAt = new Date().toISOString();
      }
      appendAuditLog(s, {
        workspaceId: s.workspace.id,
        clientId: discrepancy.clientId,
        periodId: discrepancy.periodId,
        actor: 'Gemini Investigation',
        action: 'DISCREPANCY_INVESTIGATED',
        entityType: 'DISCREPANCY',
        entityId: discrepancy.id,
        summary: `Generated evidence-grounded AI investigation for ${discrepancy.invoiceNumber}.`,
      });
    });

    res.json({ discrepancy: updated.discrepancies.find((d) => d.id === discrepancy.id) });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'AI investigation failed.' });
  }
});

router.patch('/discrepancies/:id', (req: Request, res: Response) => {
  const schema = z.object({
    status: z.enum(['OPEN', 'UNDER_REVIEW', 'AWAITING_SUPPLIER', 'RESOLVED', 'CLOSED']),
    resolutionNotes: z.string().max(2000).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid discrepancy update.' });
    return;
  }

  const store = getStore();
  const target = store.discrepancies.find((d) => d.id === req.params.id);
  if (!target) {
    res.status(404).json({ error: 'Discrepancy not found.' });
    return;
  }

  const now = new Date().toISOString();
  const prevStatus = target.status;
  const updated = saveStore((s) => {
    const d = s.discrepancies.find((x) => x.id === target.id);
    if (!d) return;
    d.status = parsed.data.status as DiscrepancyStatus;
    if (parsed.data.resolutionNotes !== undefined) {
      d.resolutionNotes = parsed.data.resolutionNotes;
    }
    if (parsed.data.status === 'RESOLVED' || parsed.data.status === 'CLOSED') {
      d.resolvedBy = 'CA / Accountant Reviewer';
      d.resolvedAt = now;
    }
    d.updatedAt = now;
    appendAuditLog(s, {
      workspaceId: s.workspace.id,
      clientId: d.clientId,
      periodId: d.periodId,
      actor: 'CA / Accountant',
      action: `DISCREPANCY_${d.status}`,
      entityType: 'DISCREPANCY',
      entityId: d.id,
      summary: `Updated discrepancy ${d.invoiceNumber} status to ${d.status}.`,
      affectedRecord: d.invoiceNumber,
      previousState: prevStatus,
      updatedState: d.status,
      approvalStatus:
        d.status === 'RESOLVED' || d.status === 'CLOSED' ? 'APPROVED' : 'PENDING_REVIEW',
    });
    syncLatestRunSummary(s, d.clientId, d.periodId);
  });

  res.json({ discrepancy: updated.discrepancies.find((d) => d.id === target.id) });
});

// =========================================================================
// SUPPLIERS & FOLLOW-UPS
// =========================================================================
router.get('/suppliers', (req: Request, res: Response) => {
  const { store, client } = getClientAndPeriod(req);
  const clientDiscs = store.discrepancies.filter((d) => d.clientId === client.id);
  const clientPr = store.purchaseEntries.filter((p) => p.clientId === client.id);
  const clientFollowUps = store.followUps.filter((f) => f.clientId === client.id);
  const clientResults = store.reconciliationResults.filter((r) => r.clientId === client.id);

  const supplierSummaries = store.suppliers.map((sup) => {
    const supPr = clientPr.filter((p) => p.supplierGstin === sup.gstin);
    const supDiscs = clientDiscs.filter((d) => d.supplierGstin === sup.gstin);
    const openDiscs = supDiscs.filter((d) => d.status !== 'RESOLVED' && d.status !== 'CLOSED');
    const supResults = clientResults.filter((r) => r.supplierGstin === sup.gstin);
    const matchedResultsCount = supResults.filter((r) => r.outcome === 'MATCHED').length;
    const matchedRate =
      supResults.length > 0
        ? Math.round((matchedResultsCount / supResults.length) * 100)
        : supPr.length > 0
          ? 100
          : 0;
    const pendingResponses = clientFollowUps.filter(
      (f) =>
        f.supplierGstin === sup.gstin &&
        (f.status === 'DRAFT' ||
          f.status === 'APPROVED' ||
          f.status === 'SENT_MANUALLY' ||
          f.status === 'AWAITING_RESPONSE')
    ).length;
    const periodsAffected = new Set(supDiscs.map((d) => d.periodId));
    const totalTaxUnderInvestigation = roundCurrency(
      openDiscs.reduce((sum, d) => sum + d.potentiallyAffectedTax, 0)
    );
    return {
      ...sup,
      invoiceCount: supPr.length,
      matchedRate,
      totalDiscrepancies: supDiscs.length,
      openDiscrepancies: openDiscs.length,
      pendingResponses,
      recurringPeriodsCount: periodsAffected.size,
      isRecurring: periodsAffected.size >= 2 || supDiscs.length >= 2,
      totalTaxUnderInvestigation,
    };
  });

  res.json({ suppliers: supplierSummaries });
});

router.get('/followups', (req: Request, res: Response) => {
  const { store, client, period } = getClientAndPeriod(req);
  const followUps = store.followUps
    .filter((f) => f.clientId === client.id && f.periodId === period.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  res.json({ followUps });
});

router.post('/followups/generate', async (req: Request, res: Response) => {
  const discrepancyId = String(req.body?.discrepancyId || '');
  const store = getStore();
  const discrepancy = store.discrepancies.find((d) => d.id === discrepancyId);
  if (!discrepancy) {
    res.status(404).json({ error: 'Discrepancy not found.' });
    return;
  }

  const client = store.clients.find((c) => c.id === discrepancy.clientId)!;
  const period = store.periods.find((p) => p.id === discrepancy.periodId) ?? store.periods[2];
  const result = store.reconciliationResults.find((r) => r.id === discrepancy.reconciliationResultId);
  const purchaseEntry = result?.purchaseEntryId
    ? store.purchaseEntries.find((p) => p.id === result.purchaseEntryId) ?? null
    : null;
  const gstr2bEntry = result?.gstr2bEntryId
    ? store.gstr2bEntries.find((g) => g.id === result.gstr2bEntryId) ?? null
    : null;
  const supplier = store.suppliers.find((s) => s.gstin === discrepancy.supplierGstin);

  try {
    const draft = await generateFollowUpWithGemini({
      discrepancy,
      client,
      period,
      purchaseEntry,
      gstr2bEntry,
    });

    const now = new Date().toISOString();
    const id = `fu_${Date.now()}`;
    const followUp = {
      id,
      workspaceId: store.workspace.id,
      clientId: client.id,
      periodId: period.id,
      discrepancyId: discrepancy.id,
      invoiceNumber: discrepancy.invoiceNumber,
      supplierName: discrepancy.supplierName,
      supplierGstin: discrepancy.supplierGstin,
      supplierEmail: supplier?.email ?? 'accounts@supplier.demo',
      channel: 'EMAIL' as const,
      subject: draft.subject,
      emailBody: draft.emailBody,
      whatsappBody: draft.whatsappBody,
      status: 'DRAFT' as const,
      approvedBy: null,
      approvedAt: null,
      sentAt: null,
      responseNotes: null,
      createdAt: now,
      updatedAt: now,
    };

    saveStore((s) => {
      s.followUps.unshift(followUp);
      appendAuditLog(s, {
        workspaceId: s.workspace.id,
        clientId: client.id,
        periodId: period.id,
        actor: 'Gemini Follow-Up Agent',
        action: 'FOLLOW_UP_DRAFTED',
        entityType: 'FOLLOW_UP',
        entityId: id,
        summary: `Drafted supplier clarification email & WhatsApp message for ${discrepancy.invoiceNumber} (${discrepancy.supplierName}).`,
      });
    });

    res.status(201).json({ followUp });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Follow-up generation failed.' });
  }
});

router.patch('/followups/:id', (req: Request, res: Response) => {
  const parsed = FollowUpUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid follow-up update payload.' });
    return;
  }

  const store = getStore();
  const target = store.followUps.find((f) => f.id === req.params.id);
  if (!target) {
    res.status(404).json({ error: 'Follow-up record not found.' });
    return;
  }

  if (parsed.data.status === 'SENT_MANUALLY' && target.status !== 'APPROVED' && !target.approvedAt) {
    res.status(400).json({ error: 'Human approval is required before marking a follow-up as manually sent.' });
    return;
  }

  const now = new Date().toISOString();
  const updated = saveStore((s) => {
    const f = s.followUps.find((x) => x.id === target.id);
    if (!f) return;
    if (parsed.data.channel) f.channel = parsed.data.channel;
    if (parsed.data.subject) f.subject = parsed.data.subject;
    if (parsed.data.emailBody) f.emailBody = parsed.data.emailBody;
    if (parsed.data.whatsappBody) f.whatsappBody = parsed.data.whatsappBody;
    if (parsed.data.responseNotes !== undefined) f.responseNotes = parsed.data.responseNotes;

    if (parsed.data.status) {
      f.status = parsed.data.status as FollowUpStatus;
      if (parsed.data.status === 'APPROVED') {
        f.approvedBy = 'Accountant / CA Reviewer';
        f.approvedAt = now;
      }
      if (parsed.data.status === 'SENT_MANUALLY') {
        f.sentAt = now;
        const disc = s.discrepancies.find((d) => d.id === f.discrepancyId);
        if (disc && disc.status !== 'RESOLVED') {
          disc.status = 'AWAITING_SUPPLIER';
          disc.updatedAt = now;
        }
      }
      if (parsed.data.status === 'RESOLVED') {
        const disc = s.discrepancies.find((d) => d.id === f.discrepancyId);
        if (disc) {
          disc.status = 'RESOLVED';
          disc.resolvedBy = 'Accountant / CA Reviewer';
          disc.resolvedAt = now;
          disc.resolutionNotes = f.responseNotes || 'Resolved after supplier verification.';
          disc.updatedAt = now;
        }
      }
    }
    f.updatedAt = now;

    appendAuditLog(s, {
      workspaceId: s.workspace.id,
      clientId: f.clientId,
      periodId: f.periodId,
      actor: 'Accountant / CA',
      action: `FOLLOW_UP_${f.status}`,
      entityType: 'FOLLOW_UP',
      entityId: f.id,
      summary: `Updated follow-up for ${f.invoiceNumber} (${f.supplierName}) to ${f.status}.`,
    });
    syncLatestRunSummary(s, f.clientId, f.periodId);
  });

  res.json({ followUp: updated.followUps.find((f) => f.id === target.id) });
});

// =========================================================================
// REPORTS
// =========================================================================
router.get('/reports', (req: Request, res: Response) => {
  const { store, client, period } = getClientAndPeriod(req);
  const reportType = (String(req.query.type || 'MONTHLY_SUMMARY') as ReportType);

  const runs = store.reconciliationRuns
    .filter((r) => r.clientId === client.id && r.periodId === period.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latestRun = runs[0] ?? null;
  const results = latestRun
    ? store.reconciliationResults.filter((r) => r.runId === latestRun.id)
    : [];
  const discrepancies = store.discrepancies.filter(
    (d) => d.clientId === client.id && d.periodId === period.id
  );
  const auditLogs = store.auditLogs.filter(
    (l) => l.clientId === client.id && l.periodId === period.id
  );

  const report = buildReport({
    reportType,
    client,
    period,
    latestRun,
    results,
    discrepancies,
    auditLogs,
  });

  res.json(report);
});

// =========================================================================
// AI ASSISTANT
// =========================================================================
router.post('/assistant/query', async (req: Request, res: Response) => {
  const parsed = AssistantQuerySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid assistant query.' });
    return;
  }

  const store = getStore();
  if (!assertClientOwnership(store, parsed.data.clientId)) {
    res.status(403).json({ error: 'Unauthorized client workspace.' });
    return;
  }

  const client = store.clients.find((c) => c.id === parsed.data.clientId)!;
  const period = store.periods.find((p) => p.id === parsed.data.periodId) ?? store.periods[2];
  const runs = store.reconciliationRuns
    .filter((r) => r.clientId === client.id && r.periodId === period.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latestRun = runs[0] ?? null;
  const results = latestRun
    ? store.reconciliationResults.filter((r) => r.runId === latestRun.id)
    : [];
  const discrepancies = store.discrepancies.filter(
    (d) => d.clientId === client.id && d.periodId === period.id
  );
  const followUpsCount = store.followUps.filter(
    (f) => f.clientId === client.id && f.periodId === period.id
  ).length;

  try {
    const response = await answerAssistantQueryWithGemini({
      question: parsed.data.question,
      client,
      period,
      latestRun,
      results,
      discrepancies,
      followUpsCount,
    });
    res.json(response);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'AI assistant error.' });
  }
});

// Minimal valid single-page PDF generator (pure JS, zero external deps) for demo sample invoice upload
function buildMinimalInvoicePdf(params: {
  supplierName: string;
  supplierGstin: string;
  recipientName: string;
  recipientGstin: string;
  invoiceNumber: string;
  invoiceDate: string;
  taxableValue: number;
  cgst: number;
  sgst: number;
  totalTax: number;
  grandTotal: number;
}): Buffer {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const lines = [
    `TAX INVOICE (DEMO SAMPLE)`,
    `Supplier: ${params.supplierName}`,
    `Supplier GSTIN: ${params.supplierGstin}`,
    `Recipient: ${params.recipientName}`,
    `Recipient GSTIN: ${params.recipientGstin}`,
    `Invoice Number: ${params.invoiceNumber}`,
    `Invoice Date: ${params.invoiceDate}`,
    `Place of Supply: 19-West Bengal`,
    `Description: Assorted Packaged Consumer Goods | HSN: 2106 | Qty: 1`,
    `Taxable Value: INR ${params.taxableValue.toFixed(2)}`,
    `CGST (9%): INR ${params.cgst.toFixed(2)}`,
    `SGST (9%): INR ${params.sgst.toFixed(2)}`,
    `IGST (0%): INR 0.00`,
    `Total Tax: INR ${params.totalTax.toFixed(2)}`,
    `Grand Total: INR ${params.grandTotal.toFixed(2)}`,
  ];

  const streamOps = [
    'BT',
    '/F1 12 Tf',
    '50 760 Td',
    '18 TL',
    ...lines.map((line, i) => `${i === 0 ? '' : 'T* '}(${esc(line)}) Tj`),
    'ET',
  ].join('\n');

  const objs = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(streamOps, 'utf8')} >>\nstream\n${streamOps}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objs) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

export default router;
