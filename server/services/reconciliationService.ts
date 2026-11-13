import {
  type Discrepancy,
  type DiscrepancySeverity,
  type FieldComparison,
  type GSTR2BEntry,
  type Invoice,
  type InvoiceExtraction,
  type MatchMethod,
  type PurchaseRegisterEntry,
  type ReconciliationConfig,
  type ReconciliationOutcome,
  type ReconciliationResult,
  type ReconciliationRun,
} from '../../src/shared/types.ts';
import {
  normalizeDateString,
  normalizeInvoiceNumber,
  roundCurrency,
} from '../../src/shared/validation.ts';

function stringSimilarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  const lenA = a.length;
  const lenB = b.length;
  const dp: number[][] = Array.from({ length: lenA + 1 }, () => Array(lenB + 1).fill(0));
  for (let i = 0; i <= lenA; i++) dp[i][0] = i;
  for (let j = 0; j <= lenB; j++) dp[0][j] = j;
  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  const maxLen = Math.max(lenA, lenB);
  return maxLen === 0 ? 1 : (maxLen - dp[lenA][lenB]) / maxLen;
}

function daysBetween(dateA: string | null, dateB: string | null): number {
  if (!dateA || !dateB) return 999;
  const a = new Date(dateA).getTime();
  const b = new Date(dateB).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 999;
  return Math.abs(Math.round((a - b) / (1000 * 60 * 60 * 24)));
}

function pairwiseMaxNumberDiff(values: Array<number | null | undefined>): number {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (nums.length < 2) return 0;
  return roundCurrency(Math.max(...nums) - Math.min(...nums));
}

function pairwiseMaxDateDiff(dates: Array<string | null | undefined>): number {
  const norm = dates
    .map((d) => normalizeDateString(d))
    .filter((d): d is string => Boolean(d));
  if (norm.length < 2) return 0;
  let maxDays = 0;
  for (let i = 0; i < norm.length; i++) {
    for (let j = i + 1; j < norm.length; j++) {
      maxDays = Math.max(maxDays, daysBetween(norm[i], norm[j]));
    }
  }
  return maxDays;
}

function formatRupee(n: number): string {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function getCategorySeverity(outcome: ReconciliationOutcome, taxDiff: number): DiscrepancySeverity {
  if (
    outcome === 'MISSING_IN_GSTR2B' ||
    outcome === 'GSTIN_MISMATCH' ||
    outcome === 'POSSIBLE_DUPLICATE' ||
    taxDiff >= 5000
  ) {
    return 'HIGH';
  }
  if (
    outcome === 'TAX_AMOUNT_MISMATCH' ||
    outcome === 'TAXABLE_VALUE_MISMATCH' ||
    outcome === 'NEEDS_MANUAL_REVIEW' ||
    outcome === 'INVOICE_NUMBER_MISMATCH' ||
    outcome === 'MISSING_IN_PURCHASE_REGISTER'
  ) {
    return 'MEDIUM';
  }
  return 'LOW';
}

interface LinkedInvoiceRecord {
  invoice: Invoice;
  extraction: InvoiceExtraction | null;
  gstin: string;
  rawInvNo: string;
  normInvNo: string;
  date: string | null;
  taxableValue: number | null;
  totalTax: number | null;
}

function getEffectiveInvoiceTaxComponents(ext: InvoiceExtraction | null): {
  cgst: number | null;
  sgst: number | null;
  igst: number | null;
  cess: number | null;
} {
  if (!ext) {
    return { cgst: null, sgst: null, igst: null, cess: null };
  }
  const rawCgst = ext.cgst.value;
  const rawSgst = ext.sgst.value;
  const rawIgst = ext.igst.value;
  const rawCess = ext.cess.value;
  const anyHeadPrinted =
    rawCgst !== null || rawSgst !== null || rawIgst !== null || rawCess !== null;
  if (!anyHeadPrinted) {
    return { cgst: null, sgst: null, igst: null, cess: null };
  }
  return {
    cgst: rawCgst ?? 0,
    sgst: rawSgst ?? 0,
    igst: rawIgst ?? 0,
    cess: rawCess ?? 0,
  };
}

function buildNumberFieldComparison(params: {
  field: string;
  invoiceDisplay: number | null;
  invoiceCompare: number | null;
  prVal: number | null;
  gstr2bVal: number | null;
  tolerance: number;
}): FieldComparison {
  const { field, invoiceDisplay, invoiceCompare, prVal, gstr2bVal, tolerance } = params;
  const presentForCompare = [invoiceCompare, prVal, gstr2bVal].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v)
  );
  const diff = pairwiseMaxNumberDiff(presentForCompare);

  if (prVal === null || gstr2bVal === null) {
    return {
      field,
      invoiceValue: invoiceDisplay,
      purchaseRegisterValue: prVal ?? 'Not found',
      gstr2bValue: gstr2bVal ?? 'Not found',
      status: 'MISSING',
      difference: diff > 0 ? formatRupee(diff) : undefined,
    };
  }

  const prMinus2b = roundCurrency(prVal - gstr2bVal);
  return {
    field,
    invoiceValue: invoiceDisplay,
    purchaseRegisterValue: prVal,
    gstr2bValue: gstr2bVal,
    status: diff === 0 ? 'MATCH' : diff <= tolerance ? 'TOLERANCE_OK' : 'DIFF',
    difference:
      diff === 0
        ? undefined
        : prMinus2b !== 0
          ? formatRupee(prMinus2b)
          : `Max 3-way diff ${formatRupee(diff)}`,
  };
}

function findCandidate2b(params: {
  gstin: string;
  rawInvNo: string;
  normInvNo: string;
  date: string | null;
  taxableValue: number;
  totalTax: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  approvedExt: InvoiceExtraction | null;
  gstr2bEntries: GSTR2BEntry[];
  usedGstr2bIds: Set<string>;
  config: ReconciliationConfig;
}): {
  entry: GSTR2BEntry | null;
  matchMethod: MatchMethod;
  matchConfidence: number;
} {
  const {
    gstin,
    rawInvNo,
    normInvNo,
    date,
    taxableValue,
    totalTax,
    cgst,
    sgst,
    igst,
    cess,
    approvedExt,
    gstr2bEntries,
    usedGstr2bIds,
    config,
  } = params;

  const invEffHeads = getEffectiveInvoiceTaxComponents(approvedExt);

  // Level 1 (EXACT), Level 2 (NORMALISED_INVOICE), and Level 3a (TOLERANCE_CANDIDATE on same GSTIN + normInvNo)
  const sameKeyCandidates: Array<{
    entry: GSTR2BEntry;
    method: MatchMethod;
    confidence: number;
    penalty: number;
  }> = [];

  for (const g of gstr2bEntries) {
    if (usedGstr2bIds.has(g.id)) continue;
    const gGstin = g.supplierGstin.trim().toUpperCase();
    const gNormNum = g.normalizedDocumentNumber || normalizeInvoiceNumber(g.documentNumber);
    if (gGstin !== gstin || gNormNum !== normInvNo) continue;

    const gDate = normalizeDateString(g.documentDate);
    const invDate = approvedExt?.invoiceDate.value ? normalizeDateString(approvedExt.invoiceDate.value) : null;
    const invRawNum = approvedExt?.invoiceNumber.value ?? null;
    const invGstin = approvedExt?.supplierGstin.value?.trim().toUpperCase() ?? null;

    const rawExact2b = g.documentNumber.trim().toUpperCase() === rawInvNo.trim().toUpperCase();
    const rawExactInv = !invRawNum || invRawNum.trim().toUpperCase() === g.documentNumber.trim().toUpperCase();
    const gstinExactInv = !invGstin || invGstin === gGstin;

    const dateDiff = pairwiseMaxDateDiff([date, gDate, invDate]);
    const valDiff = pairwiseMaxNumberDiff([taxableValue, g.taxableValue, approvedExt?.taxableValue.value]);
    const taxDiff = pairwiseMaxNumberDiff([totalTax, g.totalTax, approvedExt?.totalTax.value]);
    const headDiff = Math.max(
      pairwiseMaxNumberDiff([cgst, g.cgst, invEffHeads.cgst]),
      pairwiseMaxNumberDiff([sgst, g.sgst, invEffHeads.sgst]),
      pairwiseMaxNumberDiff([igst, g.igst, invEffHeads.igst]),
      pairwiseMaxNumberDiff([cess, g.cess, invEffHeads.cess])
    );

    if (
      gstinExactInv &&
      rawExact2b &&
      rawExactInv &&
      dateDiff === 0 &&
      valDiff === 0 &&
      taxDiff === 0 &&
      headDiff === 0
    ) {
      sameKeyCandidates.push({
        entry: g,
        method: 'EXACT',
        confidence: 1.0,
        penalty: 0,
      });
    } else if (
      gstinExactInv &&
      (!rawExact2b || !rawExactInv) &&
      dateDiff === 0 &&
      valDiff === 0 &&
      taxDiff === 0 &&
      headDiff === 0
    ) {
      sameKeyCandidates.push({
        entry: g,
        method: 'NORMALISED_INVOICE',
        confidence: 0.96,
        penalty: 0.01,
      });
    } else {
      sameKeyCandidates.push({
        entry: g,
        method: 'TOLERANCE_CANDIDATE',
        confidence: 0.9,
        penalty: 1 + valDiff + taxDiff + headDiff + dateDiff * 10,
      });
    }
  }

  if (sameKeyCandidates.length > 0) {
    sameKeyCandidates.sort((a, b) => a.penalty - b.penalty);
    const best = sameKeyCandidates[0];
    return {
      entry: best.entry,
      matchMethod: best.method,
      matchConfidence: best.confidence,
    };
  }

  // Level 3b: GSTIN Mismatch candidate (same normalized invoice number, different GSTIN)
  const approvedGstin = approvedExt?.supplierGstin.value?.trim().toUpperCase() ?? null;
  let bestGstinMismatch: { entry: GSTR2BEntry; penalty: number } | null = null;
  for (const g of gstr2bEntries) {
    if (usedGstr2bIds.has(g.id)) continue;
    const gGstin = g.supplierGstin.trim().toUpperCase();
    const gNormNum = g.normalizedDocumentNumber || normalizeInvoiceNumber(g.documentNumber);
    if (gNormNum !== normInvNo) continue;

    const valDiff = Math.abs(roundCurrency(taxableValue - g.taxableValue));
    const gDate = normalizeDateString(g.documentDate);
    const dateDiff = daysBetween(date, gDate);
    const amountClose = valDiff <= Math.max(config.amountToleranceRupees, taxableValue * 0.05);
    const dateAligned = dateDiff <= config.dateToleranceDays;
    const confirmedByApprovedInvoice = Boolean(approvedGstin && approvedGstin === gGstin);

    if (confirmedByApprovedInvoice || amountClose || dateAligned) {
      const penalty = (confirmedByApprovedInvoice ? 0 : 100) + valDiff + dateDiff * 10;
      if (!bestGstinMismatch || penalty < bestGstinMismatch.penalty) {
        bestGstinMismatch = { entry: g, penalty };
      }
    }
  }

  if (bestGstinMismatch) {
    return {
      entry: bestGstinMismatch.entry,
      matchMethod: 'TOLERANCE_CANDIDATE',
      matchConfidence: 0.84,
    };
  }

  // Level 4: Fuzzy Candidate (same GSTIN, similar normalized invoice number) — NEVER auto-confirmed
  if (config.enableFuzzyMatch) {
    let bestScore = -1;
    let bestSimilarity = 0;
    let bestEntry: GSTR2BEntry | null = null;

    for (const g of gstr2bEntries) {
      if (usedGstr2bIds.has(g.id)) continue;
      const gGstin = g.supplierGstin.trim().toUpperCase();
      if (gGstin !== gstin) continue;
      const gNormNum = g.normalizedDocumentNumber || normalizeInvoiceNumber(g.documentNumber);
      const sim = stringSimilarity(normInvNo, gNormNum);
      if (sim < config.fuzzySimilarityThreshold) continue;

      const valDiff = Math.abs(roundCurrency(taxableValue - g.taxableValue));
      const gDate = normalizeDateString(g.documentDate);
      const dateDiff = daysBetween(date, gDate);
      const valueTieBreak = Math.min(0.03, (valDiff / Math.max(1, taxableValue)) * 0.03);
      const dateTieBreak = Math.min(0.01, (Math.min(dateDiff, 30) / 30) * 0.01);
      const compositeScore = sim - valueTieBreak - dateTieBreak;

      if (compositeScore > bestScore) {
        bestScore = compositeScore;
        bestSimilarity = sim;
        bestEntry = g;
      }
    }

    if (bestEntry) {
      return {
        entry: bestEntry,
        matchMethod: 'FUZZY_CANDIDATE',
        matchConfidence: roundCurrency(bestSimilarity),
      };
    }
  }

  return { entry: null, matchMethod: 'UNMATCHED', matchConfidence: 0 };
}

export interface ReconcileInput {
  workspaceId: string;
  clientId: string;
  periodId: string;
  config: ReconciliationConfig;
  invoices: Invoice[];
  extractions: InvoiceExtraction[];
  purchaseEntries: PurchaseRegisterEntry[];
  gstr2bEntries: GSTR2BEntry[];
  existingDiscrepancies: Discrepancy[];
  previousPeriodDiscrepancies: Discrepancy[];
  runTimestamp?: string;
}

export interface ReconcileOutput {
  run: ReconciliationRun;
  results: ReconciliationResult[];
  discrepancies: Discrepancy[];
}

export function runDeterministicReconciliation(input: ReconcileInput): ReconcileOutput {
  const {
    workspaceId,
    clientId,
    periodId,
    config,
    invoices,
    extractions,
    purchaseEntries,
    gstr2bEntries,
    existingDiscrepancies,
    previousPeriodDiscrepancies,
    runTimestamp,
  } = input;

  const now = runTimestamp ?? new Date().toISOString();
  const runId = `run_${periodId}_${Date.now()}`;

  const extractionById = new Map<string, InvoiceExtraction>();
  const extractionByInvoiceId = new Map<string, InvoiceExtraction>();
  for (const ext of extractions) {
    extractionById.set(ext.id, ext);
    extractionByInvoiceId.set(ext.invoiceId, ext);
  }

  // Build ordered invoice records excluding REJECTED invoices; APPROVED invoices take priority
  const activeInvoices: LinkedInvoiceRecord[] = invoices
    .filter((inv) => inv.status !== 'REJECTED')
    .sort((a, b) => {
      if (a.status === 'APPROVED' && b.status !== 'APPROVED') return -1;
      if (a.status !== 'APPROVED' && b.status === 'APPROVED') return 1;
      return a.createdAt.localeCompare(b.createdAt);
    })
    .map((inv) => {
      const ext =
        (inv.extractionId ? extractionById.get(inv.extractionId) : undefined) ??
        extractionByInvoiceId.get(inv.id) ??
        null;
      const gstin = ext?.supplierGstin.value ? ext.supplierGstin.value.trim().toUpperCase() : '';
      const rawInvNo = ext?.invoiceNumber.value ? ext.invoiceNumber.value.trim() : '';
      const normInvNo = rawInvNo ? normalizeInvoiceNumber(rawInvNo) : '';
      return {
        invoice: inv,
        extraction: ext,
        gstin,
        rawInvNo,
        normInvNo,
        date: normalizeDateString(ext?.invoiceDate.value ?? null),
        taxableValue: ext?.taxableValue.value ?? null,
        totalTax: ext?.totalTax.value ?? null,
      };
    });

  const invoicesByKey = new Map<string, LinkedInvoiceRecord[]>();
  const invoicesByNormNum = new Map<string, LinkedInvoiceRecord[]>();
  for (const rec of activeInvoices) {
    if (rec.gstin && rec.normInvNo) {
      const k = `${rec.gstin}::${rec.normInvNo}`;
      const list = invoicesByKey.get(k) ?? [];
      list.push(rec);
      invoicesByKey.set(k, list);
    }
    if (rec.normInvNo) {
      const list = invoicesByNormNum.get(rec.normInvNo) ?? [];
      list.push(rec);
      invoicesByNormNum.set(rec.normInvNo, list);
    }
  }

  const usedInvoiceIds = new Set<string>();
  const takeMatchingInvoice = (
    prGstin: string,
    prNormNum: string,
    prDate: string | null,
    prTaxable: number
  ): LinkedInvoiceRecord | null => {
    const exactList = invoicesByKey.get(`${prGstin}::${prNormNum}`) ?? [];
    for (const rec of exactList) {
      if (!usedInvoiceIds.has(rec.invoice.id)) {
        usedInvoiceIds.add(rec.invoice.id);
        return rec;
      }
    }

    // Fallback when GSTIN differs (possible GSTIN typo on PR vs Approved Invoice):
    // Only link an unused invoice if amount or date aligns closely so unrelated suppliers with "001" never collide
    const normList = (invoicesByNormNum.get(prNormNum) ?? []).filter(
      (rec) => !usedInvoiceIds.has(rec.invoice.id)
    );
    const compatible = normList.filter((rec) => {
      const amountAligned =
        rec.taxableValue !== null &&
        Math.abs(roundCurrency(prTaxable - rec.taxableValue)) <=
          Math.max(config.amountToleranceRupees, prTaxable * 0.05);
      const dateAligned = rec.date !== null && daysBetween(prDate, rec.date) <= config.dateToleranceDays;
      return amountAligned || dateAligned;
    });
    if (compatible.length === 1) {
      usedInvoiceIds.add(compatible[0].invoice.id);
      return compatible[0];
    }
    return null;
  };

  // Track duplicates in Purchase Register (same GSTIN + normalized invoice number)
  const prKeyCounts = new Map<string, number>();
  for (const pr of purchaseEntries) {
    const key = `${pr.supplierGstin.trim().toUpperCase()}::${pr.normalizedInvoiceNumber || normalizeInvoiceNumber(pr.invoiceNumber)}`;
    prKeyCounts.set(key, (prKeyCounts.get(key) ?? 0) + 1);
  }
  const seenPrKeys = new Set<string>();
  const usedGstr2bIds = new Set<string>();
  const seen2bKeys = new Set<string>();
  const reconciledInvoiceKeys = new Set<string>();

  const results: ReconciliationResult[] = [];
  const discrepancies: Discrepancy[] = [];

  // Map existing discrepancy resolution status to preserve human workflow state
  const existingDiscByKey = new Map<string, Discrepancy>();
  for (const d of existingDiscrepancies) {
    existingDiscByKey.set(`${d.supplierGstin}::${normalizeInvoiceNumber(d.invoiceNumber)}::${d.category}`, d);
  }

  const prevCarryForwardByKey = new Map<string, Discrepancy>();
  for (const pd of previousPeriodDiscrepancies) {
    if (pd.status !== 'RESOLVED' && pd.status !== 'CLOSED') {
      prevCarryForwardByKey.set(`${pd.supplierGstin}::${normalizeInvoiceNumber(pd.invoiceNumber)}`, pd);
    }
  }

  for (const pr of purchaseEntries) {
    const prGstin = pr.supplierGstin.trim().toUpperCase();
    const prNormNum = pr.normalizedInvoiceNumber || normalizeInvoiceNumber(pr.invoiceNumber);
    const prDate = normalizeDateString(pr.invoiceDate);
    const prKey = `${prGstin}::${prNormNum}`;

    const linkedInv = takeMatchingInvoice(prGstin, prNormNum, prDate, pr.taxableValue);
    const isDuplicateInPr = (prKeyCounts.get(prKey) ?? 0) > 1 && seenPrKeys.has(prKey);
    seenPrKeys.add(prKey);
    reconciledInvoiceKeys.add(prKey);

    const invStatus = linkedInv?.invoice.status ?? null;
    const isApprovedInvoice = invStatus === 'APPROVED';
    const approvedExt = isApprovedInvoice ? linkedInv?.extraction ?? null : null;
    const anyExt = linkedInv?.extraction ?? null;
    const invNeedsReview = Boolean(
      linkedInv &&
        (invStatus === 'NEEDS_REVIEW' ||
          invStatus === 'EXTRACTED' ||
          invStatus === 'UPLOADED' ||
          linkedInv.extraction?.reviewRequired === true)
    );

    if (isDuplicateInPr) {
      const resultId = `res_${runId}_${results.length + 1}`;
      const outcome: ReconciliationOutcome = 'POSSIBLE_DUPLICATE';
      const evidence = [
        `Purchase Register row #${pr.sourceRowNumber}: ${pr.invoiceNumber} (${prGstin}) taxable ${formatRupee(pr.taxableValue)}, tax ${formatRupee(pr.totalTax)}.`,
        `Duplicate key ${prKey} already evaluated in Purchase Register for period ${periodId}.`,
      ];
      if (linkedInv) {
        evidence.push(`Linked invoice file: ${linkedInv.invoice.fileName} (${linkedInv.invoice.status}).`);
      }

      const discId = createOrUpdateDiscrepancy({
        workspaceId,
        clientId,
        periodId,
        resultId,
        invoiceNumber: pr.invoiceNumber,
        supplierName: pr.supplierName,
        supplierGstin: prGstin,
        category: outcome,
        amountUnderInvestigation: pr.taxableValue,
        potentiallyAffectedTax: pr.totalTax,
        evidenceSummary: `Invoice ${pr.invoiceNumber} from ${pr.supplierName} (${prGstin}) appears multiple times in the Purchase Register for ${periodId}.`,
        now,
        existingDiscByKey,
        prevCarryForwardByKey,
        discrepancies,
      });

      results.push({
        id: resultId,
        runId,
        workspaceId,
        clientId,
        periodId,
        invoiceId: linkedInv?.invoice.id ?? null,
        purchaseEntryId: pr.id,
        gstr2bEntryId: null,
        invoiceNumber: pr.invoiceNumber,
        supplierName: pr.supplierName,
        supplierGstin: prGstin,
        invoiceDate: pr.invoiceDate,
        prTaxableValue: pr.taxableValue,
        prTotalTax: pr.totalTax,
        gstr2bTaxableValue: 0,
        gstr2bTotalTax: 0,
        valueDifference: pr.taxableValue,
        taxDifference: pr.totalTax,
        outcome,
        discrepancyCategory: outcome,
        matchMethod: 'UNMATCHED',
        matchConfidence: 0.98,
        humanReviewStatus: 'PENDING_REVIEW',
        fieldsCompared: [
          {
            field: 'Duplicate Check (GSTIN + Invoice No)',
            invoiceValue: anyExt?.invoiceNumber.value ?? null,
            purchaseRegisterValue: pr.invoiceNumber,
            gstr2bValue: '1 entry already matched',
            status: 'DIFF',
            difference: 'Duplicate entry in Purchase Register',
          },
        ],
        evidence,
        explanation: `Duplicate Purchase Register entry detected for invoice ${pr.invoiceNumber} (${prGstin}). Only one corresponding record can be reconciled against GSTR-2B.`,
        suggestedNextStep: 'Verify whether this invoice was recorded twice in accounting books and remove the duplicate entry if confirmed.',
        discrepancyId: discId,
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }

    const match = findCandidate2b({
      gstin: prGstin,
      rawInvNo: pr.invoiceNumber,
      normInvNo: prNormNum,
      date: prDate,
      taxableValue: pr.taxableValue,
      totalTax: pr.totalTax,
      cgst: pr.cgst,
      sgst: pr.sgst,
      igst: pr.igst,
      cess: pr.cess,
      approvedExt,
      gstr2bEntries,
      usedGstr2bIds,
      config,
    });

    const candidate2b = match.entry;
    const matchMethod = match.matchMethod;
    const matchConfidence = match.matchConfidence;

    if (candidate2b) {
      usedGstr2bIds.add(candidate2b.id);
      const gKey = `${candidate2b.supplierGstin.trim().toUpperCase()}::${
        candidate2b.normalizedDocumentNumber || normalizeInvoiceNumber(candidate2b.documentNumber)
      }`;
      seen2bKeys.add(gKey);
    }

    const resultId = `res_${runId}_${results.length + 1}`;

    if (!candidate2b) {
      const outcome: ReconciliationOutcome = invNeedsReview
        ? 'NEEDS_MANUAL_REVIEW'
        : 'MISSING_IN_GSTR2B';
      const evidence = [
        `Purchase Register row #${pr.sourceRowNumber}: ${pr.invoiceNumber} (${prDate ?? pr.invoiceDate}), GSTIN ${prGstin}, Taxable ${formatRupee(pr.taxableValue)}, Tax ${formatRupee(pr.totalTax)}.`,
        linkedInv
          ? `Supplier Invoice ${linkedInv.invoice.fileName} (${linkedInv.invoice.status}): ${anyExt?.invoiceNumber.value ?? 'N/A'}, Taxable ${anyExt?.taxableValue.value !== null && anyExt?.taxableValue.value !== undefined ? formatRupee(anyExt.taxableValue.value) : 'null'}.`
          : 'No uploaded supplier invoice linked for this entry.',
        'GSTR-2B: No matching supplier document found in uploaded period records.',
      ];

      const discId = createOrUpdateDiscrepancy({
        workspaceId,
        clientId,
        periodId,
        resultId,
        invoiceNumber: pr.invoiceNumber,
        supplierName: pr.supplierName,
        supplierGstin: prGstin,
        category: outcome,
        amountUnderInvestigation: pr.taxableValue,
        potentiallyAffectedTax: pr.totalTax,
        evidenceSummary: `Invoice ${pr.invoiceNumber} (${pr.invoiceDate}) for taxable value ${formatRupee(pr.taxableValue)} and tax ${formatRupee(pr.totalTax)} is present in Purchase Register, but no corresponding entry was found in uploaded GSTR-2B.`,
        now,
        existingDiscByKey,
        prevCarryForwardByKey,
        discrepancies,
      });

      results.push({
        id: resultId,
        runId,
        workspaceId,
        clientId,
        periodId,
        invoiceId: linkedInv?.invoice.id ?? null,
        purchaseEntryId: pr.id,
        gstr2bEntryId: null,
        invoiceNumber: pr.invoiceNumber,
        supplierName: pr.supplierName,
        supplierGstin: prGstin,
        invoiceDate: pr.invoiceDate,
        prTaxableValue: pr.taxableValue,
        prTotalTax: pr.totalTax,
        gstr2bTaxableValue: 0,
        gstr2bTotalTax: 0,
        valueDifference: pr.taxableValue,
        taxDifference: pr.totalTax,
        outcome,
        discrepancyCategory: outcome,
        matchMethod: 'UNMATCHED',
        matchConfidence: 0,
        humanReviewStatus: 'PENDING_REVIEW',
        fieldsCompared: [
          {
            field: 'Supplier GSTIN',
            invoiceValue: anyExt?.supplierGstin.value ?? null,
            purchaseRegisterValue: prGstin,
            gstr2bValue: 'Not found',
            status: 'MISSING',
          },
          {
            field: 'Invoice Number',
            invoiceValue: anyExt?.invoiceNumber.value ?? null,
            purchaseRegisterValue: pr.invoiceNumber,
            gstr2bValue: 'Not found',
            status: 'MISSING',
          },
          {
            field: 'Taxable Value (₹)',
            invoiceValue: anyExt?.taxableValue.value ?? null,
            purchaseRegisterValue: pr.taxableValue,
            gstr2bValue: 0,
            status: 'MISSING',
            difference: formatRupee(pr.taxableValue),
          },
          {
            field: 'Total Tax (₹)',
            invoiceValue: anyExt?.totalTax.value ?? null,
            purchaseRegisterValue: pr.totalTax,
            gstr2bValue: 0,
            status: 'MISSING',
            difference: formatRupee(pr.totalTax),
          },
        ],
        evidence,
        explanation: invNeedsReview
          ? `Supplier invoice ${linkedInv?.invoice.fileName} is still ${invStatus} and no corresponding GSTR-2B record was found for ${pr.invoiceNumber}.`
          : 'A corresponding record was not found in the uploaded GSTR-2B data for the selected period. Uploaded data alone cannot confirm whether the supplier reported it in a subsequent period.',
        suggestedNextStep:
          'Verify the invoice details and reporting period, then follow up with the supplier for clarification if required.',
        discrepancyId: discId,
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }

    // 3-Way field comparisons (Approved/Linked Invoice vs Purchase Register vs GSTR-2B)
    const gGstin = candidate2b.supplierGstin.trim().toUpperCase();
    const gDate = normalizeDateString(candidate2b.documentDate);
    const invGstin = approvedExt?.supplierGstin.value?.trim().toUpperCase() ?? null;
    const invDate = approvedExt?.invoiceDate.value ? normalizeDateString(approvedExt.invoiceDate.value) : null;
    const invNumVal = approvedExt?.invoiceNumber.value?.trim() ?? null;

    const distinctGstins = new Set([prGstin, gGstin, ...(invGstin ? [invGstin] : [])]);
    const gstinDiffers = distinctGstins.size > 1;

    const maxDateDiff = pairwiseMaxDateDiff([prDate, gDate, invDate]);
    const maxTaxableDiff = pairwiseMaxNumberDiff([
      pr.taxableValue,
      candidate2b.taxableValue,
      approvedExt?.taxableValue.value,
    ]);
    const maxTotalTaxDiff = pairwiseMaxNumberDiff([
      pr.totalTax,
      candidate2b.totalTax,
      approvedExt?.totalTax.value,
    ]);

    const invEffHeads = getEffectiveInvoiceTaxComponents(approvedExt);
    const maxCgstDiff = pairwiseMaxNumberDiff([pr.cgst, candidate2b.cgst, invEffHeads.cgst]);
    const maxSgstDiff = pairwiseMaxNumberDiff([pr.sgst, candidate2b.sgst, invEffHeads.sgst]);
    const maxIgstDiff = pairwiseMaxNumberDiff([pr.igst, candidate2b.igst, invEffHeads.igst]);
    const maxCessDiff = pairwiseMaxNumberDiff([pr.cess, candidate2b.cess, invEffHeads.cess]);
    const maxHeadDiff = Math.max(maxCgstDiff, maxSgstDiff, maxIgstDiff, maxCessDiff);

    const valDiffPr2b = roundCurrency(pr.taxableValue - candidate2b.taxableValue);
    const taxDiffPr2b = roundCurrency(pr.totalTax - candidate2b.totalTax);

    const rawInvNumbers = [pr.invoiceNumber.trim().toUpperCase(), candidate2b.documentNumber.trim().toUpperCase()];
    if (invNumVal) rawInvNumbers.push(invNumVal.toUpperCase());
    const invNumsExactMatch = new Set(rawInvNumbers).size === 1;
    const normInvNumbers = [
      prNormNum,
      candidate2b.normalizedDocumentNumber || normalizeInvoiceNumber(candidate2b.documentNumber),
    ];
    if (invNumVal) normInvNumbers.push(normalizeInvoiceNumber(invNumVal));
    const invNumsNormalizedMatch = new Set(normInvNumbers).size === 1;

    const fieldsCompared: FieldComparison[] = [
      {
        field: 'Supplier GSTIN',
        invoiceValue: anyExt?.supplierGstin.value ?? null,
        purchaseRegisterValue: prGstin,
        gstr2bValue: gGstin,
        status: !gstinDiffers ? 'MATCH' : 'DIFF',
        difference: !gstinDiffers
          ? undefined
          : Array.from(distinctGstins).join(' vs '),
      },
      {
        field: 'Invoice Number',
        invoiceValue: anyExt?.invoiceNumber.value ?? null,
        purchaseRegisterValue: pr.invoiceNumber,
        gstr2bValue: candidate2b.documentNumber,
        status: invNumsExactMatch
          ? 'MATCH'
          : invNumsNormalizedMatch
            ? 'TOLERANCE_OK'
            : 'DIFF',
        difference: invNumsExactMatch
          ? undefined
          : `${pr.invoiceNumber} vs ${candidate2b.documentNumber}${invNumVal && invNumVal !== pr.invoiceNumber ? ` (Inv: ${invNumVal})` : ''}`,
      },
      {
        field: 'Invoice Date',
        invoiceValue: anyExt?.invoiceDate.value ?? null,
        purchaseRegisterValue: prDate ?? pr.invoiceDate,
        gstr2bValue: gDate ?? candidate2b.documentDate,
        status:
          maxDateDiff === 0
            ? 'MATCH'
            : maxDateDiff <= config.dateToleranceDays
              ? 'TOLERANCE_OK'
              : 'DIFF',
        difference: maxDateDiff === 0 ? undefined : `${maxDateDiff} day(s) apart`,
      },
      buildNumberFieldComparison({
        field: 'Taxable Value (₹)',
        invoiceDisplay: anyExt?.taxableValue.value ?? null,
        invoiceCompare: approvedExt?.taxableValue.value ?? null,
        prVal: pr.taxableValue,
        gstr2bVal: candidate2b.taxableValue,
        tolerance: config.amountToleranceRupees,
      }),
      buildNumberFieldComparison({
        field: 'CGST (₹)',
        invoiceDisplay: anyExt?.cgst.value ?? null,
        invoiceCompare: invEffHeads.cgst,
        prVal: pr.cgst,
        gstr2bVal: candidate2b.cgst,
        tolerance: config.amountToleranceRupees,
      }),
      buildNumberFieldComparison({
        field: 'SGST (₹)',
        invoiceDisplay: anyExt?.sgst.value ?? null,
        invoiceCompare: invEffHeads.sgst,
        prVal: pr.sgst,
        gstr2bVal: candidate2b.sgst,
        tolerance: config.amountToleranceRupees,
      }),
      buildNumberFieldComparison({
        field: 'IGST (₹)',
        invoiceDisplay: anyExt?.igst.value ?? null,
        invoiceCompare: invEffHeads.igst,
        prVal: pr.igst,
        gstr2bVal: candidate2b.igst,
        tolerance: config.amountToleranceRupees,
      }),
      buildNumberFieldComparison({
        field: 'Cess (₹)',
        invoiceDisplay: anyExt?.cess.value ?? null,
        invoiceCompare: invEffHeads.cess,
        prVal: pr.cess,
        gstr2bVal: candidate2b.cess,
        tolerance: config.amountToleranceRupees,
      }),
      buildNumberFieldComparison({
        field: 'Total Tax (₹)',
        invoiceDisplay: anyExt?.totalTax.value ?? null,
        invoiceCompare: approvedExt?.totalTax.value ?? null,
        prVal: pr.totalTax,
        gstr2bVal: candidate2b.totalTax,
        tolerance: config.amountToleranceRupees,
      }),
    ];

    const evidence: string[] = [
      `Purchase Register row #${pr.sourceRowNumber}: ${pr.invoiceNumber} (${prGstin}), Date ${prDate ?? pr.invoiceDate}, Taxable ${formatRupee(pr.taxableValue)}, Tax ${formatRupee(pr.totalTax)}.`,
      `GSTR-2B row #${candidate2b.sourceRowNumber}: ${candidate2b.documentNumber} (${gGstin}), Date ${gDate ?? candidate2b.documentDate}, Taxable ${formatRupee(candidate2b.taxableValue)}, Tax ${formatRupee(candidate2b.totalTax)}.`,
    ];
    if (linkedInv) {
      evidence.push(
        `Supplier Invoice ${linkedInv.invoice.fileName} (${linkedInv.invoice.status}): ${anyExt?.invoiceNumber.value ?? 'N/A'} (${anyExt?.supplierGstin.value ?? 'N/A'}), Taxable ${anyExt?.taxableValue.value !== null && anyExt?.taxableValue.value !== undefined ? formatRupee(anyExt.taxableValue.value) : 'null'}, Tax ${anyExt?.totalTax.value !== null && anyExt?.totalTax.value !== undefined ? formatRupee(anyExt.totalTax.value) : 'null'}.`
      );
      if (anyExt?.totalTax.evidence) {
        evidence.push(`Invoice extraction evidence (Total Tax): ${anyExt.totalTax.evidence}`);
      }
    } else {
      evidence.push('No uploaded supplier invoice linked; reconciled Purchase Register against GSTR-2B.');
    }
    if (matchMethod === 'FUZZY_CANDIDATE') {
      evidence.push(`Fuzzy invoice similarity: ${Math.round(matchConfidence * 100)}% (threshold ${Math.round(config.fuzzySimilarityThreshold * 100)}%). Auto-confirmation blocked.`);
    }

    let outcome: ReconciliationOutcome = 'MATCHED';
    let explanation = 'All key fields match deterministically across approved invoice, Purchase Register, and GSTR-2B.';
    let suggestedNextStep = 'No action required. Retain for audit trail.';
    let humanReviewStatus: ReconciliationResult['humanReviewStatus'] = 'AUTO_CONFIRMED';

    if (gstinDiffers) {
      outcome = 'GSTIN_MISMATCH';
      explanation = `Invoice number ${pr.invoiceNumber} matches GSTR-2B document ${candidate2b.documentNumber}, but the Supplier GSTIN differs across sources (${Array.from(distinctGstins).join(' vs ')}).`;
      suggestedNextStep = 'Verify the supplier tax invoice GSTIN and confirm whether a data-entry error occurred or an amendment is needed.';
      humanReviewStatus = 'PENDING_REVIEW';
    } else if (matchMethod === 'FUZZY_CANDIDATE') {
      outcome = 'INVOICE_NUMBER_MISMATCH';
      explanation = `Fuzzy candidate match (${Math.round(matchConfidence * 100)}% similarity): Purchase Register "${pr.invoiceNumber}" vs GSTR-2B "${candidate2b.documentNumber}". Uncertain fuzzy matches are never auto-confirmed.`;
      suggestedNextStep = 'Inspect the original supplier invoice and manually approve or reject this candidate match.';
      humanReviewStatus = 'PENDING_REVIEW';
    } else if (invNeedsReview) {
      outcome = 'NEEDS_MANUAL_REVIEW';
      explanation = `Purchase Register and GSTR-2B align for ${pr.invoiceNumber}, but the uploaded supplier invoice (${linkedInv?.invoice.status}) requires human approval before final confirmation.`;
      suggestedNextStep = 'Open the Invoices review screen, verify extracted fields, and approve the invoice.';
      humanReviewStatus = 'PENDING_REVIEW';
    } else if (maxTaxableDiff > config.amountToleranceRupees) {
      outcome = 'TAXABLE_VALUE_MISMATCH';
      explanation = `Taxable value differs by ${formatRupee(maxTaxableDiff)} across compared sources (Purchase Register: ${formatRupee(pr.taxableValue)}, GSTR-2B: ${formatRupee(candidate2b.taxableValue)}${approvedExt?.taxableValue.value !== null && approvedExt?.taxableValue.value !== undefined ? `, Approved Invoice: ${formatRupee(approvedExt.taxableValue.value)}` : ''}).`;
      suggestedNextStep = 'Compare line items on the source invoice against Purchase Register and GSTR-2B and check for credit/debit notes or rounding differences.';
      humanReviewStatus = 'PENDING_REVIEW';
    } else if (maxTotalTaxDiff > config.amountToleranceRupees || maxHeadDiff > config.amountToleranceRupees) {
      outcome = 'TAX_AMOUNT_MISMATCH';
      const headNote =
        maxTotalTaxDiff <= config.amountToleranceRupees && maxHeadDiff > config.amountToleranceRupees
          ? ` Tax head split differs (CGST/SGST vs IGST/Cess variance up to ${formatRupee(maxHeadDiff)}).`
          : '';
      explanation = `Tax amount differs across sources (Purchase Register: ${formatRupee(pr.totalTax)}, GSTR-2B: ${formatRupee(candidate2b.totalTax)}${approvedExt?.totalTax.value !== null && approvedExt?.totalTax.value !== undefined ? `, Approved Invoice: ${formatRupee(approvedExt.totalTax.value)}` : ''}).${headNote}`;
      suggestedNextStep = 'Inspect CGST/SGST/IGST/Cess breakdown on the original invoice and request clarification from the supplier if GSTR-2B reflects a different tax figure.';
      humanReviewStatus = 'PENDING_REVIEW';
    } else if (maxDateDiff > config.dateToleranceDays) {
      outcome = 'DATE_MISMATCH';
      explanation = `Invoice date differs by ${maxDateDiff} days across sources (${prDate ?? pr.invoiceDate} in PR vs ${gDate ?? candidate2b.documentDate} in GSTR-2B${invDate ? ` vs ${invDate} on Approved Invoice` : ''}), exceeding the configured ${config.dateToleranceDays}-day tolerance.`;
      suggestedNextStep = 'Verify the invoice issue date on the original supplier PDF/image.';
      humanReviewStatus = 'PENDING_REVIEW';
    } else if (matchMethod === 'NORMALISED_INVOICE') {
      outcome = 'MATCHED';
      explanation = `Matched via Level 2 Normalised Invoice Number ("${pr.invoiceNumber}" aligned with "${candidate2b.documentNumber}" in GSTR-2B). Amounts and GSTIN match.`;
      suggestedNextStep = 'Verified match under invoice formatting normalization.';
      humanReviewStatus = 'AUTO_CONFIRMED';
    } else if (matchMethod === 'TOLERANCE_CANDIDATE') {
      outcome = 'MATCHED';
      explanation = `Matched within configured tolerances (date tolerance <= ${config.dateToleranceDays}d, amount tolerance <= ${formatRupee(config.amountToleranceRupees)}).`;
      suggestedNextStep = 'Review tolerance alignment if required for audit documentation.';
      humanReviewStatus = 'AUTO_CONFIRMED';
    }

    const discrepancyCategory = outcome === 'MATCHED' ? null : outcome;
    const reportedTaxDiff =
      maxTotalTaxDiff > 0 ? maxTotalTaxDiff : maxHeadDiff > 0 ? maxHeadDiff : pr.totalTax;
    const reportedValueDiff =
      maxTaxableDiff > 0 ? maxTaxableDiff : pr.taxableValue;

    let discId: string | null = null;
    if (discrepancyCategory) {
      discId = createOrUpdateDiscrepancy({
        workspaceId,
        clientId,
        periodId,
        resultId,
        invoiceNumber: pr.invoiceNumber,
        supplierName: pr.supplierName,
        supplierGstin: prGstin,
        category: discrepancyCategory,
        amountUnderInvestigation: reportedValueDiff,
        potentiallyAffectedTax:
          discrepancyCategory === 'TAX_AMOUNT_MISMATCH'
            ? Math.max(maxTotalTaxDiff, maxHeadDiff)
            : discrepancyCategory === 'TAXABLE_VALUE_MISMATCH'
              ? Math.max(maxTotalTaxDiff, roundCurrency(maxTaxableDiff * 0.18))
              : pr.totalTax,
        evidenceSummary: explanation,
        now,
        existingDiscByKey,
        prevCarryForwardByKey,
        discrepancies,
      });
    }

    results.push({
      id: resultId,
      runId,
      workspaceId,
      clientId,
      periodId,
      invoiceId: linkedInv?.invoice.id ?? null,
      purchaseEntryId: pr.id,
      gstr2bEntryId: candidate2b.id,
      invoiceNumber: pr.invoiceNumber,
      supplierName: pr.supplierName,
      supplierGstin: prGstin,
      invoiceDate: pr.invoiceDate,
      prTaxableValue: pr.taxableValue,
      prTotalTax: pr.totalTax,
      gstr2bTaxableValue: candidate2b.taxableValue,
      gstr2bTotalTax: candidate2b.totalTax,
      valueDifference: valDiffPr2b,
      taxDifference: taxDiffPr2b,
      outcome,
      discrepancyCategory,
      matchMethod,
      matchConfidence,
      humanReviewStatus,
      fieldsCompared,
      evidence,
      explanation,
      suggestedNextStep,
      discrepancyId: discId,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Evaluate remaining unlinked APPROVED supplier invoices (missing in Purchase Register, or duplicate approved invoices)
  for (const invRec of activeInvoices) {
    if (invRec.invoice.status !== 'APPROVED') continue;
    if (usedInvoiceIds.has(invRec.invoice.id)) continue;

    const ext = invRec.extraction;
    if (!ext) continue;
    const invGstin = invRec.gstin || 'UNKNOWN';
    const invNo = invRec.rawInvNo || invRec.invoice.fileName;
    const invNorm = invRec.normInvNo || normalizeInvoiceNumber(invNo);
    const invDate = invRec.date ?? ext.invoiceDate.value ?? '';
    const invTaxable = invRec.taxableValue ?? 0;
    const invTotalTax = invRec.totalTax ?? 0;
    const invHeads = getEffectiveInvoiceTaxComponents(ext);
    const invKey = `${invGstin}::${invNorm}`;

    const isDuplicateApprovedInvoice = reconciledInvoiceKeys.has(invKey);
    reconciledInvoiceKeys.add(invKey);

    let matched2b: GSTR2BEntry | null = null;
    let matchMethod: MatchMethod = 'UNMATCHED';
    let matchConfidence = 0;

    if (!isDuplicateApprovedInvoice && invRec.gstin && invRec.normInvNo) {
      const m = findCandidate2b({
        gstin: invGstin,
        rawInvNo: invNo,
        normInvNo: invNorm,
        date: invRec.date,
        taxableValue: invTaxable,
        totalTax: invTotalTax,
        cgst: invHeads.cgst ?? 0,
        sgst: invHeads.sgst ?? 0,
        igst: invHeads.igst ?? 0,
        cess: invHeads.cess ?? 0,
        approvedExt: ext,
        gstr2bEntries,
        usedGstr2bIds,
        config,
      });
      matched2b = m.entry;
      matchMethod = m.matchMethod;
      matchConfidence = m.matchConfidence;
      if (matched2b) {
        usedGstr2bIds.add(matched2b.id);
        const gKey = `${matched2b.supplierGstin.trim().toUpperCase()}::${
          matched2b.normalizedDocumentNumber || normalizeInvoiceNumber(matched2b.documentNumber)
        }`;
        seen2bKeys.add(gKey);
      }
    }

    const resultId = `res_${runId}_${results.length + 1}`;
    const outcome: ReconciliationOutcome = isDuplicateApprovedInvoice
      ? 'POSSIBLE_DUPLICATE'
      : 'MISSING_IN_PURCHASE_REGISTER';

    const gTaxable = matched2b?.taxableValue ?? 0;
    const gTotalTax = matched2b?.totalTax ?? 0;
    const supplierName = ext.supplierName.value ?? matched2b?.supplierName ?? 'Unknown Supplier';

    const evidence = [
      `Approved Supplier Invoice ${invRec.invoice.fileName}: ${invNo} (${invGstin}), Date ${invDate || 'N/A'}, Taxable ${formatRupee(invTaxable)}, Tax ${formatRupee(invTotalTax)}.`,
      isDuplicateApprovedInvoice
        ? `Duplicate invoice key ${invKey} already reconciled in period ${periodId}.`
        : 'Purchase Register: No matching booking found.',
      matched2b
        ? `GSTR-2B row #${matched2b.sourceRowNumber}: ${matched2b.documentNumber}, Taxable ${formatRupee(matched2b.taxableValue)}, Tax ${formatRupee(matched2b.totalTax)} (Method: ${matchMethod}).`
        : 'GSTR-2B: No matching entry found.',
    ];

    const explanation = isDuplicateApprovedInvoice
      ? `Multiple approved supplier invoices found for ${invNo} (${invGstin}) in ${periodId}. Confirm which document is authoritative.`
      : matched2b
        ? `Approved supplier invoice ${invNo} (${supplierName}) matches GSTR-2B document ${matched2b.documentNumber}, but is missing from the Purchase Register.`
        : `Approved supplier invoice ${invNo} (${supplierName}) is not recorded in the Purchase Register and was not found in uploaded GSTR-2B.`;

    const discId = createOrUpdateDiscrepancy({
      workspaceId,
      clientId,
      periodId,
      resultId,
      invoiceNumber: invNo,
      supplierName,
      supplierGstin: invGstin,
      category: outcome,
      amountUnderInvestigation: invTaxable,
      potentiallyAffectedTax: invTotalTax,
      evidenceSummary: explanation,
      now,
      existingDiscByKey,
      prevCarryForwardByKey,
      discrepancies,
    });

    results.push({
      id: resultId,
      runId,
      workspaceId,
      clientId,
      periodId,
      invoiceId: invRec.invoice.id,
      purchaseEntryId: null,
      gstr2bEntryId: matched2b?.id ?? null,
      invoiceNumber: invNo,
      supplierName,
      supplierGstin: invGstin,
      invoiceDate: invDate,
      prTaxableValue: 0,
      prTotalTax: 0,
      gstr2bTaxableValue: gTaxable,
      gstr2bTotalTax: gTotalTax,
      valueDifference: roundCurrency(-gTaxable),
      taxDifference: roundCurrency(-gTotalTax),
      outcome,
      discrepancyCategory: outcome,
      matchMethod,
      matchConfidence,
      humanReviewStatus: 'PENDING_REVIEW',
      fieldsCompared: [
        {
          field: 'Supplier GSTIN',
          invoiceValue: ext.supplierGstin.value,
          purchaseRegisterValue: 'Not found',
          gstr2bValue: matched2b?.supplierGstin ?? 'Not found',
          status: 'MISSING',
        },
        {
          field: 'Invoice Number',
          invoiceValue: ext.invoiceNumber.value,
          purchaseRegisterValue: 'Not found',
          gstr2bValue: matched2b?.documentNumber ?? 'Not found',
          status: 'MISSING',
        },
        {
          field: 'Taxable Value (₹)',
          invoiceValue: ext.taxableValue.value,
          purchaseRegisterValue: 'Not found',
          gstr2bValue: matched2b ? matched2b.taxableValue : 'Not found',
          status: 'MISSING',
          difference: formatRupee(invTaxable),
        },
        {
          field: 'Total Tax (₹)',
          invoiceValue: ext.totalTax.value,
          purchaseRegisterValue: 'Not found',
          gstr2bValue: matched2b ? matched2b.totalTax : 'Not found',
          status: 'MISSING',
          difference: formatRupee(invTotalTax),
        },
      ],
      evidence,
      explanation,
      suggestedNextStep: isDuplicateApprovedInvoice
        ? 'Review duplicate uploaded invoice files and reject the duplicate copy.'
        : 'Book the approved supplier invoice into the Purchase Register if valid for ITC, or verify with accounts payable.',
      discrepancyId: discId,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Remaining unmatched GSTR-2B entries (Extra in GSTR-2B / Missing in Purchase Register, or Duplicate GSTR-2B)
  for (const g of gstr2bEntries) {
    if (usedGstr2bIds.has(g.id)) continue;
    const resultId = `res_${runId}_${results.length + 1}`;
    const gGstin = g.supplierGstin.trim().toUpperCase();
    const gNorm = g.normalizedDocumentNumber || normalizeInvoiceNumber(g.documentNumber);
    const gKey = `${gGstin}::${gNorm}`;
    const isDuplicate2b = seen2bKeys.has(gKey);
    seen2bKeys.add(gKey);

    const outcome: ReconciliationOutcome = isDuplicate2b
      ? 'POSSIBLE_DUPLICATE'
      : 'MISSING_IN_PURCHASE_REGISTER';

    const evidence = [
      `GSTR-2B row #${g.sourceRowNumber}: ${g.documentNumber} (${g.documentDate}), GSTIN ${gGstin}, Taxable ${formatRupee(g.taxableValue)}, Tax ${formatRupee(g.totalTax)}.`,
      isDuplicate2b
        ? `Duplicate GSTR-2B key ${gKey} appears multiple times in uploaded GSTR-2B for period ${periodId}.`
        : 'Purchase Register & Approved Invoices: No matching entry found.',
    ];

    const explanation = isDuplicate2b
      ? `Duplicate GSTR-2B record detected for document ${g.documentNumber} (${gGstin}).`
      : `Document ${g.documentNumber} from ${g.supplierName} is reported in uploaded GSTR-2B, but no corresponding entry exists in the Purchase Register.`;

    const discId = createOrUpdateDiscrepancy({
      workspaceId,
      clientId,
      periodId,
      resultId,
      invoiceNumber: g.documentNumber,
      supplierName: g.supplierName,
      supplierGstin: gGstin,
      category: outcome,
      amountUnderInvestigation: g.taxableValue,
      potentiallyAffectedTax: g.totalTax,
      evidenceSummary: explanation,
      now,
      existingDiscByKey,
      prevCarryForwardByKey,
      discrepancies,
    });

    results.push({
      id: resultId,
      runId,
      workspaceId,
      clientId,
      periodId,
      invoiceId: null,
      purchaseEntryId: null,
      gstr2bEntryId: g.id,
      invoiceNumber: g.documentNumber,
      supplierName: g.supplierName,
      supplierGstin: gGstin,
      invoiceDate: g.documentDate,
      prTaxableValue: 0,
      prTotalTax: 0,
      gstr2bTaxableValue: g.taxableValue,
      gstr2bTotalTax: g.totalTax,
      valueDifference: roundCurrency(-g.taxableValue),
      taxDifference: roundCurrency(-g.totalTax),
      outcome,
      discrepancyCategory: outcome,
      matchMethod: 'UNMATCHED',
      matchConfidence: 0,
      humanReviewStatus: 'PENDING_REVIEW',
      fieldsCompared: [
        {
          field: 'Purchase Register Entry',
          invoiceValue: null,
          purchaseRegisterValue: isDuplicate2b ? 'Already matched' : 'Not found',
          gstr2bValue: g.documentNumber,
          status: isDuplicate2b ? 'DIFF' : 'MISSING',
        },
        {
          field: 'GSTR-2B Taxable (₹)',
          invoiceValue: null,
          purchaseRegisterValue: 0,
          gstr2bValue: g.taxableValue,
          status: 'DIFF',
          difference: formatRupee(g.taxableValue),
        },
        {
          field: 'GSTR-2B Tax (₹)',
          invoiceValue: null,
          purchaseRegisterValue: 0,
          gstr2bValue: g.totalTax,
          status: 'DIFF',
          difference: `${formatRupee(g.totalTax)} ${isDuplicate2b ? 'duplicate' : 'extra'} in GSTR-2B`,
        },
      ],
      evidence,
      explanation,
      suggestedNextStep: isDuplicate2b
        ? 'Check whether supplier filed a duplicate document or amendment in GSTR-1.'
        : 'Check whether the purchase invoice was missed in accounting entry, belongs to another branch, or was misattributed by the supplier.',
      discrepancyId: discId,
      createdAt: now,
      updatedAt: now,
    });
  }

  const matchedCount = results.filter((r) => r.outcome === 'MATCHED').length;
  const unmatchedCount = results.length - matchedCount;
  const needsReviewCount = results.filter((r) => r.humanReviewStatus === 'PENDING_REVIEW').length;
  const totalPrTaxableValue = roundCurrency(
    purchaseEntries.reduce((acc, e) => acc + e.taxableValue, 0)
  );
  const totalPrTax = roundCurrency(purchaseEntries.reduce((acc, e) => acc + e.totalTax, 0));
  const totalGstr2bTax = roundCurrency(gstr2bEntries.reduce((acc, e) => acc + e.totalTax, 0));
  const potentiallyAffectedTax = roundCurrency(
    discrepancies
      .filter((d) => d.status !== 'RESOLVED' && d.status !== 'CLOSED')
      .reduce((acc, d) => acc + d.potentiallyAffectedTax, 0)
  );

  const run: ReconciliationRun = {
    id: runId,
    workspaceId,
    clientId,
    periodId,
    config,
    summary: {
      totalProcessed: results.length,
      matchedCount,
      unmatchedCount,
      discrepancyCount: discrepancies.length,
      needsReviewCount,
      totalPrTaxableValue,
      totalPrTax,
      totalGstr2bTax,
      potentiallyAffectedTax,
    },
    createdAt: now,
  };

  return { run, results, discrepancies };
}

function createOrUpdateDiscrepancy(params: {
  workspaceId: string;
  clientId: string;
  periodId: string;
  resultId: string;
  invoiceNumber: string;
  supplierName: string;
  supplierGstin: string;
  category: ReconciliationOutcome;
  amountUnderInvestigation: number;
  potentiallyAffectedTax: number;
  evidenceSummary: string;
  now: string;
  existingDiscByKey: Map<string, Discrepancy>;
  prevCarryForwardByKey: Map<string, Discrepancy>;
  discrepancies: Discrepancy[];
}): string {
  const {
    workspaceId,
    clientId,
    periodId,
    resultId,
    invoiceNumber,
    supplierName,
    supplierGstin,
    category,
    amountUnderInvestigation,
    potentiallyAffectedTax,
    evidenceSummary,
    now,
    existingDiscByKey,
    prevCarryForwardByKey,
    discrepancies,
  } = params;

  const normNum = normalizeInvoiceNumber(invoiceNumber);
  const existing = existingDiscByKey.get(`${supplierGstin}::${normNum}::${category}`);
  const carriedFrom = prevCarryForwardByKey.get(`${supplierGstin}::${normNum}`);

  const id = existing?.id ?? `disc_${periodId}_${discrepancies.length + 1}`;
  const severity = getCategorySeverity(category, potentiallyAffectedTax);

  discrepancies.push({
    id,
    workspaceId,
    clientId,
    periodId,
    firstDetectedPeriodId: carriedFrom?.firstDetectedPeriodId ?? existing?.firstDetectedPeriodId ?? periodId,
    lastReviewedPeriodId: periodId,
    carriedForwardFromPeriodId: carriedFrom ? carriedFrom.periodId : existing?.carriedForwardFromPeriodId ?? null,
    reconciliationResultId: resultId,
    invoiceNumber,
    supplierName,
    supplierGstin,
    category,
    severity,
    amountUnderInvestigation: roundCurrency(amountUnderInvestigation),
    potentiallyAffectedTax: roundCurrency(potentiallyAffectedTax),
    status: existing?.status ?? 'OPEN',
    needsCaReview: severity === 'HIGH' || category === 'GSTIN_MISMATCH' || category === 'NEEDS_MANUAL_REVIEW',
    evidenceSummary,
    aiInvestigation: existing?.aiInvestigation ?? null,
    resolutionNotes: existing?.resolutionNotes ?? null,
    resolvedBy: existing?.resolvedBy ?? null,
    resolvedAt: existing?.resolvedAt ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  return id;
}
