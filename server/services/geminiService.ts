import { GoogleGenAI, Type, type GenerateContentResponse } from '@google/genai';
import { z } from 'zod';
import type {
  AIInvestigationReport,
  BusinessClient,
  Discrepancy,
  ExtractedField,
  FieldValidationStatus,
  GSTR2BEntry,
  Invoice,
  InvoiceExtraction,
  InvoiceLineItem,
  PurchaseRegisterEntry,
  ReconciliationResult,
  ReconciliationRun,
  ReportingPeriod,
} from '../../src/shared/types.ts';
import {
  isValidGstinFormat,
  normalizeDateString,
  roundCurrency,
} from '../../src/shared/validation.ts';

const PRIMARY_MODEL = 'gemini-4-hydrogen';
const FALLBACK_MODEL = 'gemini-3.1-flash-lite';
const MODEL_NAME = PRIMARY_MODEL;

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Add your Gemini API key in Settings > Secrets to run AI extraction and investigation.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function normalizeGeminiError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('API_KEY_INVALID') || msg.includes('PERMISSION_DENIED') || msg.includes('403')) {
    return new Error('Gemini API key is invalid or unauthorized. Please check Settings > Secrets.');
  }
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
    return new Error('Gemini API rate limit or quota reached. Please retry shortly or check quota.');
  }
  if (msg.includes('503') || msg.includes('UNAVAILABLE')) {
    return new Error('Gemini AI service is temporarily busy due to high demand. Please retry shortly.');
  }
  if (msg.includes('NOT_FOUND') || msg.includes('404')) {
    return new Error(`Gemini model "${MODEL_NAME}" was not found or is unavailable.`);
  }
  return new Error(`Gemini AI service error: ${msg}`);
}

function isRetryableGeminiError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('500') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ECONNRESET') ||
    msg.includes('fetch failed')
  );
}

async function withGeminiRetry<T>(
  fn: (model: string) => Promise<T>
): Promise<{ result: T; modelUsed: string }> {
  const models = [PRIMARY_MODEL, FALLBACK_MODEL, PRIMARY_MODEL];
  let lastErr: unknown;
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    try {
      const result = await fn(model);
      return { result, modelUsed: model };
    } catch (err) {
      lastErr = err;
      if (i === models.length - 1 || !isRetryableGeminiError(err)) {
        throw normalizeGeminiError(err);
      }
      const delayMs = 1000 * (i + 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw normalizeGeminiError(lastErr);
}

function normalizeMimeForGemini(mimeType: string): string {
  const lower = mimeType.toLowerCase().trim();
  if (lower === 'image/jpg') return 'image/jpeg';
  return lower;
}

const RawStringFieldSchema = z.object({
  value: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  evidence: z.string().nullable(),
});

const RawNumberFieldSchema = z.object({
  value: z.number().nullable(),
  confidence: z.number().min(0).max(1),
  evidence: z.string().nullable(),
});

const RawGeminiExtractionSchema = z.object({
  supplierName: RawStringFieldSchema,
  supplierGstin: RawStringFieldSchema,
  recipientName: RawStringFieldSchema.optional(),
  recipientGstin: RawStringFieldSchema,
  invoiceNumber: RawStringFieldSchema,
  invoiceDate: RawStringFieldSchema,
  placeOfSupply: RawStringFieldSchema.optional(),
  hsnSacCodes: z.array(z.string()).default([]),
  taxableValue: RawNumberFieldSchema,
  cgst: RawNumberFieldSchema,
  sgst: RawNumberFieldSchema,
  igst: RawNumberFieldSchema,
  cess: RawNumberFieldSchema,
  totalTax: RawNumberFieldSchema,
  grandTotal: RawNumberFieldSchema,
  currency: z.string().nullable().optional(),
  lineItems: z
    .array(
      z.object({
        description: z.string(),
        hsnSac: z.string().nullable().optional(),
        quantity: z.number().nullable().optional(),
        unitPrice: z.number().nullable().optional(),
        taxableValue: z.number().nullable().optional(),
        taxRatePercent: z.number().nullable().optional(),
      })
    )
    .default([]),
});

type RawGeminiExtraction = z.infer<typeof RawGeminiExtractionSchema>;

const fieldStringSchema = {
  type: Type.OBJECT,
  properties: {
    value: { type: Type.STRING, nullable: true },
    confidence: { type: Type.NUMBER },
    evidence: { type: Type.STRING, nullable: true },
  },
  required: ['value', 'confidence', 'evidence'],
};

const fieldNumberSchema = {
  type: Type.OBJECT,
  properties: {
    value: { type: Type.NUMBER, nullable: true },
    confidence: { type: Type.NUMBER },
    evidence: { type: Type.STRING, nullable: true },
  },
  required: ['value', 'confidence', 'evidence'],
};

export async function extractInvoiceWithGemini(params: {
  invoiceId: string;
  fileBuffer: Buffer;
  mimeType: string;
  fileName: string;
}): Promise<InvoiceExtraction> {
  const { invoiceId, fileBuffer, mimeType, fileName } = params;
  const ai = getAiClient();
  const normalizedMime = normalizeMimeForGemini(mimeType);

  const prompt = `You are a precision Indian GST invoice extraction parser.
Extract structured fields from this uploaded invoice (${fileName}).
STRICT RULES:
1. NEVER invent, infer, or guess missing fields. Return value: null and evidence: null if a value is not visibly present in the document.
2. Do NOT substitute 0 for CGST, SGST, IGST, or Cess unless 0 or 0.00 is explicitly printed; return value: null when not printed.
3. Preserve original invoice numbers verbatim (including slashes, hyphens, prefixes).
4. Do not alter GSTINs or amounts.
5. Provide a realistic confidence score from 0.0 to 1.0 for each field based on visual legibility.
6. Provide a concise source evidence note quoting where the value was read (e.g., "Header GSTIN block: 19ABCDE1234F1Z5", "Tax summary table row 2") or null if missing.
7. Format invoiceDate as YYYY-MM-DD if clearly parseable, otherwise preserve the raw date string.`;

  const { result: response, modelUsed } = await withGeminiRetry<GenerateContentResponse>((model) =>
    ai.models.generateContent({
      model,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: normalizedMime,
              data: fileBuffer.toString('base64'),
            },
          },
          { text: prompt },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            supplierName: fieldStringSchema,
            supplierGstin: fieldStringSchema,
            recipientName: fieldStringSchema,
            recipientGstin: fieldStringSchema,
            invoiceNumber: fieldStringSchema,
            invoiceDate: fieldStringSchema,
            placeOfSupply: fieldStringSchema,
            hsnSacCodes: { type: Type.ARRAY, items: { type: Type.STRING } },
            taxableValue: fieldNumberSchema,
            cgst: fieldNumberSchema,
            sgst: fieldNumberSchema,
            igst: fieldNumberSchema,
            cess: fieldNumberSchema,
            totalTax: fieldNumberSchema,
            grandTotal: fieldNumberSchema,
            currency: { type: Type.STRING, nullable: true },
            lineItems: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  description: { type: Type.STRING },
                  hsnSac: { type: Type.STRING, nullable: true },
                  quantity: { type: Type.NUMBER, nullable: true },
                  unitPrice: { type: Type.NUMBER, nullable: true },
                  taxableValue: { type: Type.NUMBER, nullable: true },
                  taxRatePercent: { type: Type.NUMBER, nullable: true },
                },
                required: ['description'],
              },
            },
          },
          required: [
            'supplierName',
            'supplierGstin',
            'recipientGstin',
            'invoiceNumber',
            'invoiceDate',
            'taxableValue',
            'cgst',
            'sgst',
            'igst',
            'cess',
            'totalTax',
            'grandTotal',
          ],
        },
      },
    })
  );

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('Gemini returned an empty extraction payload.');
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(rawText);
  } catch {
    throw new Error('Gemini extraction response was not valid JSON.');
  }

  const validated = RawGeminiExtractionSchema.safeParse(parsedUnknown);
  if (!validated.success) {
    throw new Error(
      `Gemini extraction JSON failed schema validation: ${validated.error.issues[0]?.message ?? 'unexpected shape'}`
    );
  }

  return buildValidatedExtraction(invoiceId, validated.data, modelUsed);
}

function buildValidatedExtraction(
  invoiceId: string,
  raw: RawGeminiExtraction,
  modelUsed = MODEL_NAME
): InvoiceExtraction {
  const now = new Date().toISOString();

  const wrapStr = (
    item: { value: string | null; confidence: number; evidence: string | null } | undefined,
    required = true
  ): ExtractedField<string | null> => {
    const value = item?.value ? item.value.trim() : null;
    const conf = typeof item?.confidence === 'number' ? Math.max(0, Math.min(1, item.confidence)) : 0.5;
    let status: FieldValidationStatus = value ? 'VALID' : required ? 'MISSING' : 'VALID';
    let message: string | undefined;
    if (value && conf < 0.85) {
      status = 'WARNING';
      message = `Low extraction confidence (${Math.round(conf * 100)}%)`;
    }
    return {
      value,
      confidence: conf,
      evidence: value ? item?.evidence ?? null : null,
      validationStatus: status,
      validationMessage: message,
    };
  };

  const wrapNum = (
    item: { value: number | null; confidence: number; evidence: string | null } | undefined,
    required = false
  ): ExtractedField<number | null> => {
    const rawVal = item?.value;
    const value = typeof rawVal === 'number' && Number.isFinite(rawVal) ? roundCurrency(rawVal) : null;
    const conf = typeof item?.confidence === 'number' ? Math.max(0, Math.min(1, item.confidence)) : 0.5;
    let status: FieldValidationStatus = value !== null ? 'VALID' : required ? 'MISSING' : 'VALID';
    let message: string | undefined;
    if (value !== null && conf < 0.85) {
      status = 'WARNING';
      message = `Low extraction confidence (${Math.round(conf * 100)}%)`;
    }
    return {
      value,
      confidence: conf,
      evidence: value !== null ? item?.evidence ?? null : null,
      validationStatus: status,
      validationMessage: message,
    };
  };

  const supplierName = wrapStr(raw.supplierName, true);
  const supplierGstin = wrapStr(raw.supplierGstin, true);
  if (supplierGstin.value) supplierGstin.value = supplierGstin.value.toUpperCase();
  const recipientName = wrapStr(raw.recipientName, false);
  const recipientGstin = wrapStr(raw.recipientGstin, false);
  if (recipientGstin.value) recipientGstin.value = recipientGstin.value.toUpperCase();
  const invoiceNumber = wrapStr(raw.invoiceNumber, true);
  const parsedDate = normalizeDateString(raw.invoiceDate?.value);
  const invoiceDate = wrapStr(
    raw.invoiceDate
      ? { ...raw.invoiceDate, value: parsedDate ?? raw.invoiceDate.value }
      : undefined,
    true
  );
  const placeOfSupply = wrapStr(raw.placeOfSupply, false);

  const taxableValue = wrapNum(raw.taxableValue, true);
  const cgst = wrapNum(raw.cgst, false);
  const sgst = wrapNum(raw.sgst, false);
  const igst = wrapNum(raw.igst, false);
  const cess = wrapNum(raw.cess, false);
  const totalTax = wrapNum(raw.totalTax, false);
  const grandTotal = wrapNum(raw.grandTotal, true);

  const confidences = [
    supplierName.confidence,
    supplierGstin.confidence,
    invoiceNumber.confidence,
    invoiceDate.confidence,
    taxableValue.confidence,
    totalTax.confidence,
    grandTotal.confidence,
  ];
  const overallConfidence = roundCurrency(
    confidences.reduce((a, b) => a + b, 0) / confidences.length
  );

  const lineItems: InvoiceLineItem[] = (raw.lineItems ?? []).map((li) => ({
    description: li.description,
    hsnSac: li.hsnSac ?? null,
    quantity: li.quantity ?? null,
    unitPrice: li.unitPrice ?? null,
    taxableValue: li.taxableValue ?? null,
    taxRatePercent: li.taxRatePercent ?? null,
  }));

  const extraction: InvoiceExtraction = {
    id: `ext_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    invoiceId,
    modelUsed: MODEL_NAME,
    supplierName,
    supplierGstin,
    recipientName,
    recipientGstin,
    invoiceNumber,
    invoiceDate,
    placeOfSupply,
    hsnSacCodes: {
      value: Array.isArray(raw.hsnSacCodes) ? raw.hsnSacCodes.filter(Boolean) : [],
      confidence: 0.9,
      evidence: raw.hsnSacCodes.length > 0 ? 'Line items / HSN summary' : null,
      validationStatus: 'VALID',
    },
    taxableValue,
    cgst,
    sgst,
    igst,
    cess,
    totalTax,
    grandTotal,
    currency: {
      value: raw.currency ?? null,
      confidence: raw.currency ? 0.95 : 0.5,
      evidence: raw.currency ? 'Currency indicator' : null,
      validationStatus: 'VALID',
    },
    lineItems,
    overallConfidence,
    reviewRequired: false,
    validationWarnings: [],
    createdAt: now,
    updatedAt: now,
  };

  return revalidateExtractionRecord(extraction);
}

export function revalidateExtractionRecord(ext: InvoiceExtraction): InvoiceExtraction {
  const warnings: string[] = [];

  const checkRequiredText = (field: ExtractedField<string | null>, label: string) => {
    if (!field.value || !field.value.trim()) {
      field.validationStatus = 'MISSING';
      field.validationMessage = `${label} is missing`;
      warnings.push(`${label} could not be extracted or is empty.`);
    } else if (!field.editedByUser && field.confidence < 0.85) {
      field.validationStatus = 'WARNING';
      field.validationMessage = `Low extraction confidence (${Math.round(field.confidence * 100)}%)`;
    } else {
      field.validationStatus = 'VALID';
      field.validationMessage = undefined;
    }
  };

  checkRequiredText(ext.supplierName, 'Supplier Name');
  checkRequiredText(ext.invoiceNumber, 'Invoice Number');

  // Supplier GSTIN validation (required)
  if (!ext.supplierGstin.value) {
    ext.supplierGstin.validationStatus = 'MISSING';
    ext.supplierGstin.validationMessage = 'Supplier GSTIN is missing';
    warnings.push('Supplier GSTIN is missing.');
  } else if (!isValidGstinFormat(ext.supplierGstin.value)) {
    ext.supplierGstin.validationStatus = 'ERROR';
    ext.supplierGstin.validationMessage = 'Invalid 15-character GSTIN format';
    warnings.push(`Supplier GSTIN "${ext.supplierGstin.value}" failed 15-character format validation.`);
  } else if (!ext.supplierGstin.editedByUser && ext.supplierGstin.confidence < 0.85) {
    ext.supplierGstin.validationStatus = 'WARNING';
    ext.supplierGstin.validationMessage = `Low extraction confidence (${Math.round(ext.supplierGstin.confidence * 100)}%)`;
  } else {
    ext.supplierGstin.validationStatus = 'VALID';
    ext.supplierGstin.validationMessage = undefined;
  }

  // Recipient GSTIN validation (optional on retail, required/recommended on B2B; flag format errors cleanly)
  if (!ext.recipientGstin.value) {
    ext.recipientGstin.validationStatus = 'WARNING';
    ext.recipientGstin.validationMessage = 'Recipient GSTIN not present on document';
    warnings.push('Recipient GSTIN is missing (verify B2B ITC eligibility).');
  } else if (!isValidGstinFormat(ext.recipientGstin.value)) {
    ext.recipientGstin.validationStatus = 'ERROR';
    ext.recipientGstin.validationMessage = 'Invalid 15-character recipient GSTIN format';
    warnings.push(`Recipient GSTIN "${ext.recipientGstin.value}" failed 15-character format validation.`);
  } else if (!ext.recipientGstin.editedByUser && ext.recipientGstin.confidence < 0.85) {
    ext.recipientGstin.validationStatus = 'WARNING';
    ext.recipientGstin.validationMessage = `Low extraction confidence (${Math.round(ext.recipientGstin.confidence * 100)}%)`;
  } else {
    ext.recipientGstin.validationStatus = 'VALID';
    ext.recipientGstin.validationMessage = undefined;
  }

  // Invoice Date validation
  if (!ext.invoiceDate.value) {
    ext.invoiceDate.validationStatus = 'MISSING';
    ext.invoiceDate.validationMessage = 'Invoice date is missing';
    warnings.push('Invoice date could not be extracted.');
  } else {
    const normDate = normalizeDateString(ext.invoiceDate.value);
    if (!normDate) {
      ext.invoiceDate.validationStatus = 'ERROR';
      ext.invoiceDate.validationMessage = 'Unrecognized date format (expected YYYY-MM-DD)';
      warnings.push(`Invoice date "${ext.invoiceDate.value}" is not a recognized date format.`);
    } else {
      ext.invoiceDate.value = normDate;
      if (!ext.invoiceDate.editedByUser && ext.invoiceDate.confidence < 0.85) {
        ext.invoiceDate.validationStatus = 'WARNING';
        ext.invoiceDate.validationMessage = `Low extraction confidence (${Math.round(ext.invoiceDate.confidence * 100)}%)`;
      } else {
        ext.invoiceDate.validationStatus = 'VALID';
        ext.invoiceDate.validationMessage = undefined;
      }
    }
  }

  // Numeric fields validation
  const validateNumField = (field: ExtractedField<number | null>, label: string, required: boolean) => {
    if (field.value === null) {
      field.validationStatus = required ? 'MISSING' : 'VALID';
      field.validationMessage = required ? `${label} is missing` : undefined;
      if (required) warnings.push(`${label} is missing.`);
    } else if (field.value < 0) {
      field.validationStatus = 'ERROR';
      field.validationMessage = `${label} cannot be negative`;
      warnings.push(`${label} cannot be negative.`);
    } else if (!field.editedByUser && field.confidence < 0.85) {
      field.validationStatus = 'WARNING';
      field.validationMessage = `Low extraction confidence (${Math.round(field.confidence * 100)}%)`;
    } else {
      field.validationStatus = 'VALID';
      field.validationMessage = undefined;
    }
  };

  validateNumField(ext.taxableValue, 'Taxable Value', true);
  validateNumField(ext.cgst, 'CGST', false);
  validateNumField(ext.sgst, 'SGST', false);
  validateNumField(ext.igst, 'IGST', false);
  validateNumField(ext.cess, 'Cess', false);
  validateNumField(ext.totalTax, 'Total Tax', false);
  validateNumField(ext.grandTotal, 'Grand Total', true);

  // Deterministic arithmetic validation (never invent values; only validate present values)
  const hasAnyTaxComponent = [ext.cgst.value, ext.sgst.value, ext.igst.value, ext.cess.value].some(
    (v) => v !== null
  );
  const sumTaxes = roundCurrency(
    (ext.cgst.value ?? 0) + (ext.sgst.value ?? 0) + (ext.igst.value ?? 0) + (ext.cess.value ?? 0)
  );

  if (hasAnyTaxComponent && ext.totalTax.value !== null && Math.abs(sumTaxes - ext.totalTax.value) > 2) {
    warnings.push(
      `Tax component sum (₹${sumTaxes.toLocaleString('en-IN')}) differs from Total Tax (₹${ext.totalTax.value.toLocaleString('en-IN')}).`
    );
    ext.totalTax.validationStatus = 'WARNING';
    ext.totalTax.validationMessage = 'Component tax sum mismatch';
  }

  const effectiveTaxForCheck = ext.totalTax.value ?? (hasAnyTaxComponent ? sumTaxes : null);
  if (
    ext.taxableValue.value !== null &&
    effectiveTaxForCheck !== null &&
    ext.grandTotal.value !== null &&
    Math.abs(ext.taxableValue.value + effectiveTaxForCheck - ext.grandTotal.value) > 2
  ) {
    warnings.push(
      `Taxable (₹${ext.taxableValue.value.toLocaleString('en-IN')}) + Tax (₹${effectiveTaxForCheck.toLocaleString('en-IN')}) differs from Grand Total (₹${ext.grandTotal.value.toLocaleString('en-IN')}).`
    );
    ext.grandTotal.validationStatus = 'WARNING';
    ext.grandTotal.validationMessage = 'Arithmetic total mismatch';
  }

  const keyFields = [
    ext.supplierName,
    ext.supplierGstin,
    ext.recipientGstin,
    ext.invoiceNumber,
    ext.invoiceDate,
    ext.taxableValue,
    ext.totalTax,
    ext.grandTotal,
  ];
  const editedAllKey = keyFields.every((f) => f.editedByUser || f.validationStatus === 'VALID');

  ext.validationWarnings = warnings;
  ext.reviewRequired =
    warnings.length > 0 ||
    (!editedAllKey && ext.overallConfidence < 0.85) ||
    [
      ext.supplierName,
      ext.supplierGstin,
      ext.invoiceNumber,
      ext.invoiceDate,
      ext.taxableValue,
      ext.grandTotal,
    ].some((f) => f.validationStatus !== 'VALID');

  return ext;
}

export async function investigateDiscrepancyWithGemini(params: {
  discrepancy: Discrepancy;
  result: ReconciliationResult | null;
  invoice: Invoice | null;
  extraction: InvoiceExtraction | null;
  purchaseEntry: PurchaseRegisterEntry | null;
  gstr2bEntry: GSTR2BEntry | null;
  client: BusinessClient;
  period: ReportingPeriod;
}): Promise<AIInvestigationReport> {
  const ai = getAiClient();

  const evidencePayload = {
    business: { name: params.client.tradeName, gstin: params.client.gstin },
    period: params.period.label,
    discrepancy: {
      invoiceNumber: params.discrepancy.invoiceNumber,
      supplierName: params.discrepancy.supplierName,
      supplierGstin: params.discrepancy.supplierGstin,
      category: params.discrepancy.category,
      amountUnderInvestigation: params.discrepancy.amountUnderInvestigation,
      potentiallyAffectedTax: params.discrepancy.potentiallyAffectedTax,
      carriedForwardFromPeriod: params.discrepancy.carriedForwardFromPeriodId,
    },
    reconciliationResult: params.result
      ? {
          outcome: params.result.outcome,
          matchMethod: params.result.matchMethod,
          fieldsCompared: params.result.fieldsCompared,
          explanation: params.result.explanation,
        }
      : null,
    sourceInvoiceExtraction: params.extraction
      ? {
          fileName: params.invoice?.fileName,
          status: params.invoice?.status,
          supplierGstin: params.extraction.supplierGstin.value,
          invoiceNumber: params.extraction.invoiceNumber.value,
          invoiceDate: params.extraction.invoiceDate.value,
          taxableValue: params.extraction.taxableValue.value,
          cgst: params.extraction.cgst.value,
          sgst: params.extraction.sgst.value,
          igst: params.extraction.igst.value,
          totalTax: params.extraction.totalTax.value,
          overallConfidence: params.extraction.overallConfidence,
        }
      : null,
    purchaseRegisterEntry: params.purchaseEntry,
    gstr2bEntry: params.gstr2bEntry,
  };

  const prompt = `You are a senior Indian GST reconciliation analyst assisting a Chartered Accountant.
Analyze ONLY the provided verified backend records below.
MANDATORY SAFETY RULES:
- Never invent records, dates, GSTINs, or rupee figures not present in the evidence JSON.
- Never claim a supplier definitely failed to file a return based solely on uploaded files.
- Never declare an ITC claim legally eligible or ineligible; frame financial impact as "potentially affected tax amount" subject to CA/accountant verification.
- Distinguish clearly between confirmed facts from the records and possible causes.

EVIDENCE JSON:
${JSON.stringify(evidencePayload, null, 2)}`;

  const { result: response, modelUsed } = await withGeminiRetry<GenerateContentResponse>((model) =>
    ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            whatHappened: { type: Type.STRING },
            evidencePoints: { type: Type.ARRAY, items: { type: Type.STRING } },
            confirmedFacts: { type: Type.ARRAY, items: { type: Type.STRING } },
            possibleCauses: { type: Type.ARRAY, items: { type: Type.STRING } },
            recommendedNextAction: { type: Type.ARRAY, items: { type: Type.STRING } },
            professionalReviewNote: { type: Type.STRING },
          },
          required: [
            'whatHappened',
            'evidencePoints',
            'confirmedFacts',
            'possibleCauses',
            'recommendedNextAction',
            'professionalReviewNote',
          ],
        },
      },
    })
  );

  let parsed: Omit<AIInvestigationReport, 'modelUsed' | 'generatedAt'>;
  try {
    parsed = JSON.parse((response.text ?? '{}').trim()) as Omit<
      AIInvestigationReport,
      'modelUsed' | 'generatedAt'
    >;
  } catch {
    throw new Error('Gemini investigation response was not valid JSON.');
  }

  return {
    ...parsed,
    modelUsed,
    generatedAt: new Date().toISOString(),
  };
}

export async function generateFollowUpWithGemini(params: {
  discrepancy: Discrepancy;
  client: BusinessClient;
  period: ReportingPeriod;
  purchaseEntry: PurchaseRegisterEntry | null;
  gstr2bEntry: GSTR2BEntry | null;
}): Promise<{ subject: string; emailBody: string; whatsappBody: string }> {
  const ai = getAiClient();

  const prompt = `Draft a professional, polite supplier clarification message for an Indian B2B GST reconciliation discrepancy.
Use ONLY the exact figures below. Never accuse the supplier of tax evasion or non-filing; request verification/clarification calmly.
Provide both an Email draft (subject + body) and a concise WhatsApp draft.

Context:
- Recipient Business: ${params.client.tradeName} (GSTIN: ${params.client.gstin})
- Reporting Period: ${params.period.label}
- Supplier: ${params.discrepancy.supplierName} (GSTIN: ${params.discrepancy.supplierGstin})
- Invoice Number: ${params.discrepancy.invoiceNumber}
- Discrepancy Category: ${params.discrepancy.category}
- Evidence Summary: ${params.discrepancy.evidenceSummary}
- Purchase Register Record: ${params.purchaseEntry ? `Date ${params.purchaseEntry.invoiceDate}, Taxable ₹${params.purchaseEntry.taxableValue}, Total Tax ₹${params.purchaseEntry.totalTax}` : 'Not recorded'}
- GSTR-2B Record: ${params.gstr2bEntry ? `Doc ${params.gstr2bEntry.documentNumber}, Taxable ₹${params.gstr2bEntry.taxableValue}, Total Tax ₹${params.gstr2bEntry.totalTax}` : 'No matching entry found in uploaded GSTR-2B'}`;

  const { result: response } = await withGeminiRetry<GenerateContentResponse>((model) =>
    ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            subject: { type: Type.STRING },
            emailBody: { type: Type.STRING },
            whatsappBody: { type: Type.STRING },
          },
          required: ['subject', 'emailBody', 'whatsappBody'],
        },
      },
    })
  );

  try {
    return JSON.parse((response.text ?? '{}').trim()) as {
      subject: string;
      emailBody: string;
      whatsappBody: string;
    };
  } catch {
    throw new Error('Gemini follow-up response was not valid JSON.');
  }
}

export async function answerAssistantQueryWithGemini(params: {
  question: string;
  client: BusinessClient;
  period: ReportingPeriod;
  latestRun: ReconciliationRun | null;
  results: ReconciliationResult[];
  discrepancies: Discrepancy[];
  followUpsCount: number;
}): Promise<{ answer: string; citedInvoices: string[]; disclaimer: string }> {
  const ai = getAiClient();

  const contextData = {
    selectedBusiness: {
      name: params.client.tradeName,
      gstin: params.client.gstin,
      state: params.client.stateName,
      isDemo: params.client.isDemo,
    },
    selectedPeriod: params.period.label,
    reconciliationSummary: params.latestRun?.summary ?? null,
    openAndTrackedDiscrepancies: params.discrepancies.map((d) => ({
      invoiceNumber: d.invoiceNumber,
      supplierName: d.supplierName,
      supplierGstin: d.supplierGstin,
      category: d.category,
      severity: d.severity,
      status: d.status,
      amountUnderInvestigation: d.amountUnderInvestigation,
      potentiallyAffectedTax: d.potentiallyAffectedTax,
      carriedForwardFromPeriod: d.carriedForwardFromPeriodId,
      evidenceSummary: d.evidenceSummary,
    })),
    matchedSampleCount: params.results.filter((r) => r.outcome === 'MATCHED').length,
    totalResultsCount: params.results.length,
    supplierFollowUpsCount: params.followUpsCount,
  };

  const prompt = `You are the GST Reconcile AI workspace assistant for ${params.client.tradeName} (${params.period.label}).
Answer the user's question accurately using ONLY the authenticated workspace context JSON provided below.
STRICT COMPLIANCE RULES:
- Never invent invoices, suppliers, rupee totals, or GST legal rules.
- Never claim to have filed returns or sent emails/WhatsApp messages automatically.
- Never state whether an ITC claim is legally eligible or ineligible; refer to "potentially affected tax amount under investigation" and recommend CA review where appropriate.
- If the question asks for something outside the current workspace context or unsupported, clearly explain the limitation.

WORKSPACE CONTEXT JSON:
${JSON.stringify(contextData, null, 2)}

USER QUESTION:
${params.question}`;

  const { result: response } = await withGeminiRetry<GenerateContentResponse>((model) =>
    ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            answer: { type: Type.STRING },
            citedInvoices: { type: Type.ARRAY, items: { type: Type.STRING } },
            disclaimer: { type: Type.STRING },
          },
          required: ['answer', 'citedInvoices', 'disclaimer'],
        },
      },
    })
  );

  try {
    return JSON.parse((response.text ?? '{}').trim()) as {
      answer: string;
      citedInvoices: string[];
      disclaimer: string;
    };
  } catch {
    throw new Error('Gemini assistant response was not valid JSON.');
  }
}
