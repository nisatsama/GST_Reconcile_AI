import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ExtractedField,
  GSTR2BEntry,
  Invoice,
  InvoiceExtraction,
  InvoiceStatus,
  PurchaseRegisterEntry,
  ReconciliationConfig,
} from '../../src/shared/types.ts';
import { normalizeInvoiceNumber, roundCurrency } from '../../src/shared/validation.ts';
import { runDeterministicReconciliation } from './reconciliationService.ts';

const WORKSPACE_ID = 'ws_test';
const CLIENT_ID = 'client_test';
const PERIOD_ID = '2026-10';
const NOW = '2026-11-12T10:00:00.000Z';

const defaultConfig: ReconciliationConfig = {
  dateToleranceDays: 2,
  amountToleranceRupees: 5,
  enableFuzzyMatch: true,
  fuzzySimilarityThreshold: 0.72,
};

function makeField<T>(value: T, evidence: string | null = 'Test doc'): ExtractedField<T> {
  return {
    value,
    confidence: 0.98,
    evidence: value === null ? null : evidence,
    validationStatus: 'VALID',
  };
}

function makeApprovedInvoice(opts: {
  id: string;
  supplierGstin: string;
  supplierName?: string;
  invoiceNumber: string;
  invoiceDate?: string;
  taxableValue: number;
  cgst?: number | null;
  sgst?: number | null;
  igst?: number | null;
  cess?: number | null;
  totalTax?: number | null;
  status?: InvoiceStatus;
  reviewRequired?: boolean;
}): { invoice: Invoice; extraction: InvoiceExtraction } {
  const cgst = opts.cgst === undefined ? 0 : opts.cgst;
  const sgst = opts.sgst === undefined ? 0 : opts.sgst;
  const igst = opts.igst === undefined ? 0 : opts.igst;
  const cess = opts.cess === undefined ? 0 : opts.cess;
  const computedTax = roundCurrency((cgst ?? 0) + (sgst ?? 0) + (igst ?? 0) + (cess ?? 0));
  const totalTax = opts.totalTax === undefined ? computedTax : opts.totalTax;
  const grandTotal = roundCurrency(opts.taxableValue + (totalTax ?? 0));
  const status = opts.status ?? 'APPROVED';
  const extId = `ext_${opts.id}`;

  const invoice: Invoice = {
    id: opts.id,
    workspaceId: WORKSPACE_ID,
    clientId: CLIENT_ID,
    periodId: PERIOD_ID,
    fileName: `${opts.id}.pdf`,
    mimeType: 'application/pdf',
    fileSize: 2048,
    uploadSource: 'USER_UPLOAD',
    status,
    extractionId: extId,
    createdAt: NOW,
    updatedAt: NOW,
  };

  const extraction: InvoiceExtraction = {
    id: extId,
    invoiceId: opts.id,
    modelUsed: 'gemini-4-hydrogen',
    supplierName: makeField(opts.supplierName ?? 'Test Supplier Pvt Ltd'),
    supplierGstin: makeField(opts.supplierGstin),
    recipientName: makeField('Buyer Corp'),
    recipientGstin: makeField('19AABCU9603R1ZM'),
    invoiceNumber: makeField(opts.invoiceNumber),
    invoiceDate: makeField(opts.invoiceDate ?? '2026-10-10'),
    placeOfSupply: makeField('19-West Bengal'),
    hsnSacCodes: makeField(['8471']),
    taxableValue: makeField(opts.taxableValue),
    cgst: makeField(cgst),
    sgst: makeField(sgst),
    igst: makeField(igst),
    cess: makeField(cess),
    totalTax: makeField(totalTax, 'Tax Total Box'),
    grandTotal: makeField(grandTotal),
    currency: makeField('INR'),
    lineItems: [],
    overallConfidence: 0.98,
    reviewRequired: opts.reviewRequired ?? status !== 'APPROVED',
    validationWarnings: [],
    createdAt: NOW,
    updatedAt: NOW,
  };

  return { invoice, extraction };
}

function makePrEntry(opts: {
  id: string;
  supplierGstin: string;
  supplierName?: string;
  invoiceNumber: string;
  invoiceDate?: string;
  taxableValue: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  cess?: number;
  row?: number;
}): PurchaseRegisterEntry {
  const cgst = opts.cgst ?? 0;
  const sgst = opts.sgst ?? 0;
  const igst = opts.igst ?? 0;
  const cess = opts.cess ?? 0;
  const totalTax = roundCurrency(cgst + sgst + igst + cess);

  return {
    id: opts.id,
    workspaceId: WORKSPACE_ID,
    clientId: CLIENT_ID,
    periodId: PERIOD_ID,
    importId: 'primp_test',
    supplierGstin: opts.supplierGstin,
    supplierName: opts.supplierName ?? 'Test Supplier Pvt Ltd',
    invoiceNumber: opts.invoiceNumber,
    normalizedInvoiceNumber: normalizeInvoiceNumber(opts.invoiceNumber),
    invoiceDate: opts.invoiceDate ?? '2026-10-10',
    taxableValue: opts.taxableValue,
    cgst,
    sgst,
    igst,
    cess,
    totalTax,
    totalInvoiceValue: roundCurrency(opts.taxableValue + totalTax),
    sourceRowNumber: opts.row ?? 1,
    isValid: true,
    validationErrors: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function make2bEntry(opts: {
  id: string;
  supplierGstin: string;
  supplierName?: string;
  documentNumber: string;
  documentDate?: string;
  taxableValue: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  cess?: number;
  row?: number;
}): GSTR2BEntry {
  const cgst = opts.cgst ?? 0;
  const sgst = opts.sgst ?? 0;
  const igst = opts.igst ?? 0;
  const cess = opts.cess ?? 0;
  const totalTax = roundCurrency(cgst + sgst + igst + cess);

  return {
    id: opts.id,
    workspaceId: WORKSPACE_ID,
    clientId: CLIENT_ID,
    periodId: PERIOD_ID,
    importId: 'g2b_test',
    supplierGstin: opts.supplierGstin,
    supplierName: opts.supplierName ?? 'Test Supplier Pvt Ltd',
    documentNumber: opts.documentNumber,
    normalizedDocumentNumber: normalizeInvoiceNumber(opts.documentNumber),
    documentDate: opts.documentDate ?? '2026-10-10',
    documentType: 'INVOICE',
    placeOfSupply: '19-West Bengal',
    itcAvailabilityNote: 'Available',
    taxableValue: opts.taxableValue,
    cgst,
    sgst,
    igst,
    cess,
    totalTax,
    sourceRowNumber: opts.row ?? 1,
    isValid: true,
    validationErrors: [],
    createdAt: NOW,
  };
}

function runEngine(params: {
  invoices?: Invoice[];
  extractions?: InvoiceExtraction[];
  purchaseEntries?: PurchaseRegisterEntry[];
  gstr2bEntries?: GSTR2BEntry[];
  config?: ReconciliationConfig;
}) {
  return runDeterministicReconciliation({
    workspaceId: WORKSPACE_ID,
    clientId: CLIENT_ID,
    periodId: PERIOD_ID,
    config: params.config ?? defaultConfig,
    invoices: params.invoices ?? [],
    extractions: params.extractions ?? [],
    purchaseEntries: params.purchaseEntries ?? [],
    gstr2bEntries: params.gstr2bEntries ?? [],
    existingDiscrepancies: [],
    previousPeriodDiscrepancies: [],
    runTimestamp: NOW,
  });
}

test('Exact 3-way match returns EXACT, AUTO_CONFIRMED, null discrepancyCategory, compared fields and evidence', () => {
  const { invoice, extraction } = makeApprovedInvoice({
    id: 'inv_1',
    supplierGstin: '19AADCB4521K1Z8',
    invoiceNumber: 'BPL/26-27/401',
    invoiceDate: '2026-10-10',
    taxableValue: 50000,
    cgst: 4500,
    sgst: 4500,
    igst: null,
    cess: null,
    totalTax: 9000,
  });
  const pr = makePrEntry({
    id: 'pr_1',
    supplierGstin: '19AADCB4521K1Z8',
    invoiceNumber: 'BPL/26-27/401',
    invoiceDate: '2026-10-10',
    taxableValue: 50000,
    cgst: 4500,
    sgst: 4500,
  });
  const g2b = make2bEntry({
    id: 'g2b_1',
    supplierGstin: '19AADCB4521K1Z8',
    documentNumber: 'BPL/26-27/401',
    documentDate: '2026-10-10',
    taxableValue: 50000,
    cgst: 4500,
    sgst: 4500,
  });

  const out = runEngine({
    invoices: [invoice],
    extractions: [extraction],
    purchaseEntries: [pr],
    gstr2bEntries: [g2b],
  });

  assert.equal(out.results.length, 1);
  assert.equal(out.discrepancies.length, 0);
  const res = out.results[0];
  assert.equal(res.outcome, 'MATCHED');
  assert.equal(res.discrepancyCategory, null);
  assert.equal(res.matchMethod, 'EXACT');
  assert.equal(res.humanReviewStatus, 'AUTO_CONFIRMED');
  assert.equal(res.invoiceId, 'inv_1');
  assert.equal(res.purchaseEntryId, 'pr_1');
  assert.equal(res.gstr2bEntryId, 'g2b_1');
  assert.ok(res.evidence.length >= 3);
  const fieldNames = res.fieldsCompared.map((f) => f.field);
  assert.ok(fieldNames.includes('Supplier GSTIN'));
  assert.ok(fieldNames.includes('Invoice Number'));
  assert.ok(fieldNames.includes('CGST (₹)'));
  assert.ok(fieldNames.includes('SGST (₹)'));
  assert.ok(fieldNames.includes('IGST (₹)'));
  assert.ok(fieldNames.includes('Cess (₹)'));
  assert.ok(fieldNames.includes('Total Tax (₹)'));
  const igstRow = res.fieldsCompared.find((f) => f.field === 'IGST (₹)');
  assert.equal(igstRow?.invoiceValue, null);
  assert.equal(igstRow?.status, 'MATCH');
});

test('Invoice-number formatting differences match via NORMALISED_INVOICE', () => {
  const cases = [
    { prNo: 'INV-2026/041', g2bNo: 'INV2026041' },
    { prNo: '0042', g2bNo: '42' },
    { prNo: 'ABC / 26.09', g2bNo: 'ABC2609' },
  ];

  cases.forEach(({ prNo, g2bNo }, idx) => {
    const { invoice, extraction } = makeApprovedInvoice({
      id: `inv_${idx}`,
      supplierGstin: '27AAACS7719D1Z9',
      invoiceNumber: prNo,
      taxableValue: 30000,
      igst: 5400,
    });
    const pr = makePrEntry({
      id: `pr_${idx}`,
      supplierGstin: '27AAACS7719D1Z9',
      invoiceNumber: prNo,
      taxableValue: 30000,
      igst: 5400,
    });
    const g2b = make2bEntry({
      id: `g2b_${idx}`,
      supplierGstin: '27AAACS7719D1Z9',
      documentNumber: g2bNo,
      taxableValue: 30000,
      igst: 5400,
    });

    const out = runEngine({
      invoices: [invoice],
      extractions: [extraction],
      purchaseEntries: [pr],
      gstr2bEntries: [g2b],
    });

    assert.equal(out.results[0].outcome, 'MATCHED');
    assert.equal(out.results[0].matchMethod, 'NORMALISED_INVOICE');
    assert.equal(out.results[0].humanReviewStatus, 'AUTO_CONFIRMED');
    assert.equal(out.results[0].discrepancyCategory, null);
  });
});

test('Configurable tolerance matching matches within threshold and flags outside threshold', () => {
  const { invoice, extraction } = makeApprovedInvoice({
    id: 'inv_tol',
    supplierGstin: '19AADCB4521K1Z8',
    invoiceNumber: 'BPL/100',
    invoiceDate: '2026-10-10',
    taxableValue: 10000,
    cgst: 900,
    sgst: 900,
  });
  const pr = makePrEntry({
    id: 'pr_tol',
    supplierGstin: '19AADCB4521K1Z8',
    invoiceNumber: 'BPL/100',
    invoiceDate: '2026-10-12', // 2 days diff
    taxableValue: 10002, // ₹2 diff
    cgst: 900,
    sgst: 900,
  });
  const g2b = make2bEntry({
    id: 'g2b_tol',
    supplierGstin: '19AADCB4521K1Z8',
    documentNumber: 'BPL/100',
    documentDate: '2026-10-10',
    taxableValue: 10000,
    cgst: 900,
    sgst: 900,
  });

  const withinTol = runEngine({
    invoices: [invoice],
    extractions: [extraction],
    purchaseEntries: [pr],
    gstr2bEntries: [g2b],
    config: { ...defaultConfig, dateToleranceDays: 2, amountToleranceRupees: 5 },
  });
  assert.equal(withinTol.results[0].outcome, 'MATCHED');
  assert.equal(withinTol.results[0].matchMethod, 'TOLERANCE_CANDIDATE');
  assert.equal(withinTol.results[0].humanReviewStatus, 'AUTO_CONFIRMED');

  const strictTol = runEngine({
    invoices: [invoice],
    extractions: [extraction],
    purchaseEntries: [pr],
    gstr2bEntries: [g2b],
    config: { ...defaultConfig, dateToleranceDays: 0, amountToleranceRupees: 0 },
  });
  assert.equal(strictTol.results[0].outcome, 'TAXABLE_VALUE_MISMATCH');
  assert.equal(strictTol.results[0].discrepancyCategory, 'TAXABLE_VALUE_MISMATCH');
  assert.equal(strictTol.results[0].humanReviewStatus, 'PENDING_REVIEW');
});

test('Fuzzy candidate matches are NEVER auto-confirmed and respect enableFuzzyMatch flag', () => {
  const pr = makePrEntry({
    id: 'pr_fuzz',
    supplierGstin: '19AADCB4521K1Z8',
    invoiceNumber: 'BPL2627410',
    taxableValue: 20000,
    cgst: 1800,
    sgst: 1800,
  });
  const g2b = make2bEntry({
    id: 'g2b_fuzz',
    supplierGstin: '19AADCB4521K1Z8',
    documentNumber: 'BPL2627419',
    taxableValue: 20000,
    cgst: 1800,
    sgst: 1800,
  });

  const withFuzzy = runEngine({
    purchaseEntries: [pr],
    gstr2bEntries: [g2b],
    config: { ...defaultConfig, enableFuzzyMatch: true, fuzzySimilarityThreshold: 0.72 },
  });
  assert.equal(withFuzzy.results.length, 1);
  assert.equal(withFuzzy.results[0].matchMethod, 'FUZZY_CANDIDATE');
  assert.equal(withFuzzy.results[0].outcome, 'INVOICE_NUMBER_MISMATCH');
  assert.equal(withFuzzy.results[0].discrepancyCategory, 'INVOICE_NUMBER_MISMATCH');
  assert.equal(withFuzzy.results[0].humanReviewStatus, 'PENDING_REVIEW');
  assert.equal(withFuzzy.discrepancies.length, 1);

  const withoutFuzzy = runEngine({
    purchaseEntries: [pr],
    gstr2bEntries: [g2b],
    config: { ...defaultConfig, enableFuzzyMatch: false },
  });
  assert.equal(withoutFuzzy.results.length, 2);
  assert.equal(withoutFuzzy.results[0].outcome, 'MISSING_IN_GSTR2B');
  assert.equal(withoutFuzzy.results[1].outcome, 'MISSING_IN_PURCHASE_REGISTER');
});

test('Missing records: MISSING_IN_GSTR2B, extra GSTR-2B, and Approved Invoice missing in Purchase Register', () => {
  const { invoice: approvedUnbooked, extraction: extUnbooked } = makeApprovedInvoice({
    id: 'inv_unbooked',
    supplierGstin: '19ABCDE1234F1Z5',
    invoiceNumber: 'ABC/999',
    taxableValue: 15000,
    cgst: 1350,
    sgst: 1350,
  });

  const prMissing2b = makePrEntry({
    id: 'pr_missing_2b',
    supplierGstin: '19AAACK8812L1Z4',
    invoiceNumber: 'KLL/884',
    taxableValue: 32000,
    cgst: 2880,
    sgst: 2880,
  });

  const g2bMatchingApproved = make2bEntry({
    id: 'g2b_for_approved',
    supplierGstin: '19ABCDE1234F1Z5',
    documentNumber: 'ABC/999',
    taxableValue: 15000,
    cgst: 1350,
    sgst: 1350,
  });

  const g2bExtra = make2bEntry({
    id: 'g2b_extra',
    supplierGstin: '19AABCH9023E1Z1',
    documentNumber: 'HRS/119',
    taxableValue: 12000,
    cgst: 1080,
    sgst: 1080,
  });

  const out = runEngine({
    invoices: [approvedUnbooked],
    extractions: [extUnbooked],
    purchaseEntries: [prMissing2b],
    gstr2bEntries: [g2bMatchingApproved, g2bExtra],
  });

  assert.equal(out.results.length, 3);
  const rMissing2b = out.results.find((r) => r.purchaseEntryId === 'pr_missing_2b')!;
  assert.equal(rMissing2b.outcome, 'MISSING_IN_GSTR2B');
  assert.equal(rMissing2b.matchMethod, 'UNMATCHED');
  assert.equal(rMissing2b.humanReviewStatus, 'PENDING_REVIEW');

  const rInvUnbooked = out.results.find((r) => r.invoiceId === 'inv_unbooked')!;
  assert.equal(rInvUnbooked.outcome, 'MISSING_IN_PURCHASE_REGISTER');
  assert.equal(rInvUnbooked.gstr2bEntryId, 'g2b_for_approved');
  assert.equal(rInvUnbooked.purchaseEntryId, null);
  assert.equal(rInvUnbooked.humanReviewStatus, 'PENDING_REVIEW');

  const rExtra2b = out.results.find((r) => r.gstr2bEntryId === 'g2b_extra')!;
  assert.equal(rExtra2b.outcome, 'MISSING_IN_PURCHASE_REGISTER');
  assert.equal(rExtra2b.invoiceId, null);
  assert.equal(rExtra2b.humanReviewStatus, 'PENDING_REVIEW');
});

test('Tax mismatches: PR vs 2B total tax, Approved Invoice vs PR/2B 3-way tax, and tax head split mismatch', () => {
  // Case 1: Approved invoice agrees with GSTR-2B (12000), PR overstated (18000)
  const { invoice: inv1, extraction: ext1 } = makeApprovedInvoice({
    id: 'inv_tm1',
    supplierGstin: '19AADCB4521K1Z8',
    invoiceNumber: 'BPL/412',
    taxableValue: 100000,
    cgst: 6000,
    sgst: 6000,
  });
  const pr1 = makePrEntry({
    id: 'pr_tm1',
    supplierGstin: '19AADCB4521K1Z8',
    invoiceNumber: 'BPL/412',
    taxableValue: 100000,
    cgst: 9000,
    sgst: 9000,
  });
  const g2b1 = make2bEntry({
    id: 'g2b_tm1',
    supplierGstin: '19AADCB4521K1Z8',
    documentNumber: 'BPL/412',
    taxableValue: 100000,
    cgst: 6000,
    sgst: 6000,
  });

  // Case 2: PR and GSTR-2B both say 7200 tax, but Approved Invoice says 9000 tax (3-way check!)
  const { invoice: inv2, extraction: ext2 } = makeApprovedInvoice({
    id: 'inv_tm2',
    supplierGstin: '19AAACM5123P1Z7',
    invoiceNumber: 'MCC/349',
    taxableValue: 50000,
    cgst: 4500,
    sgst: 4500,
  });
  const pr2 = makePrEntry({
    id: 'pr_tm2',
    supplierGstin: '19AAACM5123P1Z7',
    invoiceNumber: 'MCC/349',
    taxableValue: 50000,
    cgst: 3600,
    sgst: 3600,
  });
  const g2b2 = make2bEntry({
    id: 'g2b_tm2',
    supplierGstin: '19AAACM5123P1Z7',
    documentNumber: 'MCC/349',
    taxableValue: 50000,
    cgst: 3600,
    sgst: 3600,
  });

  // Case 3: Tax head split mismatch (total tax 1800 on both, but PR booked IGST vs GSTR-2B CGST+SGST)
  const pr3 = makePrEntry({
    id: 'pr_head',
    supplierGstin: '27AAACS7719D1Z9',
    invoiceNumber: 'STS/701',
    taxableValue: 10000,
    igst: 1800,
  });
  const g2b3 = make2bEntry({
    id: 'g2b_head',
    supplierGstin: '27AAACS7719D1Z9',
    documentNumber: 'STS/701',
    taxableValue: 10000,
    cgst: 900,
    sgst: 900,
  });

  const out = runEngine({
    invoices: [inv1, inv2],
    extractions: [ext1, ext2],
    purchaseEntries: [pr1, pr2, pr3],
    gstr2bEntries: [g2b1, g2b2, g2b3],
  });

  for (const r of out.results) {
    assert.equal(r.outcome, 'TAX_AMOUNT_MISMATCH');
    assert.equal(r.discrepancyCategory, 'TAX_AMOUNT_MISMATCH');
    assert.equal(r.humanReviewStatus, 'PENDING_REVIEW');
  }
});

test('Duplicates detected across Purchase Register, GSTR-2B, and Approved Invoices', () => {
  const { invoice: invA, extraction: extA } = makeApprovedInvoice({
    id: 'inv_dup_a',
    supplierGstin: '19AABCH9023E1Z1',
    invoiceNumber: 'HRD/214',
    taxableValue: 25000,
    cgst: 2250,
    sgst: 2250,
  });
  const { invoice: invB, extraction: extB } = makeApprovedInvoice({
    id: 'inv_dup_b',
    supplierGstin: '19AABCH9023E1Z1',
    invoiceNumber: 'HRD/214',
    taxableValue: 25000,
    cgst: 2250,
    sgst: 2250,
  });
  const prA = makePrEntry({
    id: 'pr_dup_a',
    supplierGstin: '19AABCH9023E1Z1',
    invoiceNumber: 'HRD/214',
    taxableValue: 25000,
    cgst: 2250,
    sgst: 2250,
  });
  const prB = makePrEntry({
    id: 'pr_dup_b',
    supplierGstin: '19AABCH9023E1Z1',
    invoiceNumber: 'HRD/214',
    taxableValue: 25000,
    cgst: 2250,
    sgst: 2250,
  });
  const g2bA = make2bEntry({
    id: 'g2b_dup_a',
    supplierGstin: '19AABCH9023E1Z1',
    documentNumber: 'HRD/214',
    taxableValue: 25000,
    cgst: 2250,
    sgst: 2250,
  });
  const g2bB = make2bEntry({
    id: 'g2b_dup_b',
    supplierGstin: '19AABCH9023E1Z1',
    documentNumber: 'HRD/214',
    taxableValue: 25000,
    cgst: 2250,
    sgst: 2250,
  });

  const out = runEngine({
    invoices: [invA, invB],
    extractions: [extA, extB],
    purchaseEntries: [prA, prB],
    gstr2bEntries: [g2bA, g2bB],
  });

  assert.equal(out.results[0].outcome, 'MATCHED');
  assert.equal(out.results[1].outcome, 'POSSIBLE_DUPLICATE');
  assert.equal(out.results[1].humanReviewStatus, 'PENDING_REVIEW');
  assert.equal(out.results[2].outcome, 'POSSIBLE_DUPLICATE');
  assert.equal(out.results[2].humanReviewStatus, 'PENDING_REVIEW');

  // Also verify duplicate Approved Invoice when only 1 PR + 1 GSTR-2B exist
  const outExtraInv = runEngine({
    invoices: [invA, invB],
    extractions: [extA, extB],
    purchaseEntries: [prA],
    gstr2bEntries: [g2bA],
  });
  assert.equal(outExtraInv.results.length, 2);
  assert.equal(outExtraInv.results[0].outcome, 'MATCHED');
  assert.equal(outExtraInv.results[1].outcome, 'POSSIBLE_DUPLICATE');
  assert.equal(outExtraInv.results[1].invoiceId, 'inv_dup_b');
});

test('GSTIN mismatches across 3 sources are flagged and unrelated suppliers with same invoice no do not collide', () => {
  // Case 1: PR GSTIN differs from GSTR-2B & Approved Invoice GSTIN
  const { invoice: inv1, extraction: ext1 } = makeApprovedInvoice({
    id: 'inv_g1',
    supplierGstin: '19AADCB4521K2Z6',
    invoiceNumber: 'BPL/418',
    taxableValue: 40000,
    cgst: 3600,
    sgst: 3600,
  });
  const pr1 = makePrEntry({
    id: 'pr_g1',
    supplierGstin: '19AADCB4521K1Z8',
    invoiceNumber: 'BPL/418',
    taxableValue: 40000,
    cgst: 3600,
    sgst: 3600,
  });
  const g2b1 = make2bEntry({
    id: 'g2b_g1',
    supplierGstin: '19AADCB4521K2Z6',
    documentNumber: 'BPL/418',
    taxableValue: 40000,
    cgst: 3600,
    sgst: 3600,
  });

  const out1 = runEngine({
    invoices: [inv1],
    extractions: [ext1],
    purchaseEntries: [pr1],
    gstr2bEntries: [g2b1],
  });
  assert.equal(out1.results[0].outcome, 'GSTIN_MISMATCH');
  assert.equal(out1.results[0].discrepancyCategory, 'GSTIN_MISMATCH');
  assert.equal(out1.results[0].humanReviewStatus, 'PENDING_REVIEW');

  // Case 2: Unrelated suppliers both happen to issue "INV-001" with completely different amounts & dates
  const prSupA = makePrEntry({
    id: 'pr_supA',
    supplierGstin: '19ABCDE1234F1Z5',
    invoiceNumber: 'INV-001',
    invoiceDate: '2026-10-02',
    taxableValue: 10000,
    cgst: 900,
    sgst: 900,
  });
  const g2bSupB = make2bEntry({
    id: 'g2b_supB',
    supplierGstin: '27AABCS4412N1Z3',
    documentNumber: 'INV-001',
    documentDate: '2026-10-25',
    taxableValue: 85000,
    igst: 15300,
  });

  const out2 = runEngine({
    purchaseEntries: [prSupA],
    gstr2bEntries: [g2bSupB],
  });
  assert.equal(out2.results.length, 2);
  assert.equal(out2.results[0].outcome, 'MISSING_IN_GSTR2B');
  assert.equal(out2.results[1].outcome, 'MISSING_IN_PURCHASE_REGISTER');
});

test('Unapproved invoice blocks auto-confirmation and REJECTED invoice is excluded', () => {
  const { invoice: unapprovedInv, extraction: unapprovedExt } = makeApprovedInvoice({
    id: 'inv_unapproved',
    supplierGstin: '19AAACK8812L1Z4',
    invoiceNumber: 'KLL/892',
    taxableValue: 22000,
    cgst: 1980,
    sgst: 1980,
    status: 'NEEDS_REVIEW',
    reviewRequired: true,
  });
  const { invoice: rejectedInv, extraction: rejectedExt } = makeApprovedInvoice({
    id: 'inv_rejected',
    supplierGstin: '19AAACK8812L1Z4',
    invoiceNumber: 'KLL/892',
    taxableValue: 22000,
    cgst: 1980,
    sgst: 1980,
    status: 'REJECTED',
  });
  const pr = makePrEntry({
    id: 'pr_unapp',
    supplierGstin: '19AAACK8812L1Z4',
    invoiceNumber: 'KLL/892',
    taxableValue: 22000,
    cgst: 1980,
    sgst: 1980,
  });
  const g2b = make2bEntry({
    id: 'g2b_unapp',
    supplierGstin: '19AAACK8812L1Z4',
    documentNumber: 'KLL/892',
    taxableValue: 22000,
    cgst: 1980,
    sgst: 1980,
  });

  const out = runEngine({
    invoices: [rejectedInv, unapprovedInv],
    extractions: [rejectedExt, unapprovedExt],
    purchaseEntries: [pr],
    gstr2bEntries: [g2b],
  });

  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].invoiceId, 'inv_unapproved');
  assert.equal(out.results[0].outcome, 'NEEDS_MANUAL_REVIEW');
  assert.equal(out.results[0].humanReviewStatus, 'PENDING_REVIEW');
});
