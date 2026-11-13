import { z } from 'zod';

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export function isValidGstinFormat(value: string | null | undefined): boolean {
  if (!value) return false;
  return GSTIN_REGEX.test(value.trim().toUpperCase());
}

export function normalizeInvoiceNumber(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s\-_\/\\.]+/g, '')
    .replace(/^0+(?=\d)/, '');
}

export function normalizeDateString(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  // DD-MM-YYYY or DD/MM/YYYY
  const dmy = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    const day = dmy[1].padStart(2, '0');
    const month = dmy[2].padStart(2, '0');
    const year = dmy[3];
    return `${year}-${month}-${day}`;
  }
  // DD-MM-YY or DD/MM/YY (common in Indian spreadsheets; treat YY >= 50 as 19YY else 20YY)
  const dmyShort = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (dmyShort) {
    const p1 = Number(dmyShort[1]);
    const p2 = Number(dmyShort[2]);
    const yy = Number(dmyShort[3]);
    const year = String(yy >= 50 ? 1900 + yy : 2000 + yy);
    // If p2 > 12, it must be MM/DD/YY (e.g. SheetJS US short date); otherwise DD/MM/YY
    const day = (p2 > 12 ? p2 : p1).toString().padStart(2, '0');
    const month = (p2 > 12 ? p1 : p2).toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return null;
}

export function roundCurrency(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function formatINR(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

export const ReconciliationConfigSchema = z.object({
  dateToleranceDays: z.number().int().min(0).max(30),
  amountToleranceRupees: z.number().min(0).max(1000),
  enableFuzzyMatch: z.boolean(),
  fuzzySimilarityThreshold: z.number().min(0.5).max(0.99),
});

export const InvoiceExtractionUpdateSchema = z.object({
  supplierName: z.string().trim().nullable(),
  supplierGstin: z.string().trim().nullable(),
  recipientName: z.string().trim().nullable(),
  recipientGstin: z.string().trim().nullable(),
  invoiceNumber: z.string().trim().nullable(),
  invoiceDate: z.string().trim().nullable(),
  placeOfSupply: z.string().trim().nullable(),
  hsnSacCodes: z.array(z.string().trim().min(1)).optional(),
  taxableValue: z.number().nonnegative().nullable(),
  cgst: z.number().nonnegative().nullable(),
  sgst: z.number().nonnegative().nullable(),
  igst: z.number().nonnegative().nullable(),
  cess: z.number().nonnegative().nullable(),
  totalTax: z.number().nonnegative().nullable(),
  grandTotal: z.number().nonnegative().nullable(),
  reviewNotes: z.string().max(1000).optional(),
});

export const FollowUpUpdateSchema = z.object({
  channel: z.enum(['EMAIL', 'WHATSAPP']).optional(),
  subject: z.string().trim().min(1).max(300).optional(),
  emailBody: z.string().trim().min(1).max(5000).optional(),
  whatsappBody: z.string().trim().min(1).max(2000).optional(),
  responseNotes: z.string().max(2000).optional(),
  status: z
    .enum(['DRAFT', 'APPROVED', 'SENT_MANUALLY', 'AWAITING_RESPONSE', 'RESOLVED', 'CLOSED'])
    .optional(),
});

export const AssistantQuerySchema = z.object({
  clientId: z.string().min(1),
  periodId: z.string().min(1),
  question: z.string().trim().min(2).max(1000),
});
