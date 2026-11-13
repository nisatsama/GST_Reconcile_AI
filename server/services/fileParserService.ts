import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type {
  GSTR2BEntry,
  ImportRowError,
  PurchaseRegisterEntry,
} from '../../src/shared/types.ts';
import {
  isValidGstinFormat,
  normalizeDateString,
  normalizeInvoiceNumber,
  roundCurrency,
} from '../../src/shared/validation.ts';

export interface ParsedTabularFile {
  headers: string[];
  rows: Record<string, unknown>[];
}

export function parseCsvOrXlsxBuffer(
  buffer: Buffer,
  fileName: string
): ParsedTabularFile {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) {
    const csvText = buffer.toString('utf8');
    const parsed = Papa.parse<Record<string, unknown>>(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });
    const headers = parsed.meta.fields ?? [];
    return { headers, rows: parsed.data ?? [] };
  }

  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new Error('Spreadsheet does not contain any sheets.');
    }
    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
      raw: false,
    });
    const headers = rows.length > 0 ? Object.keys(rows[0]).map((h) => h.trim()) : [];
    return { headers, rows };
  }

  throw new Error('Unsupported file format. Please upload a .csv or .xlsx file.');
}

function toNum(val: unknown): number {
  if (typeof val === 'number') return Number.isFinite(val) ? roundCurrency(val) : 0;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[₹,\s]/g, '').trim();
    if (!cleaned) return 0;
    const num = Number(cleaned);
    return Number.isFinite(num) ? roundCurrency(num) : NaN;
  }
  return 0;
}

function toStr(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

export const PURCHASE_REGISTER_EXPECTED_FIELDS = [
  'supplierGstin',
  'supplierName',
  'invoiceNumber',
  'invoiceDate',
  'taxableValue',
  'cgst',
  'sgst',
  'igst',
  'cess',
  'totalInvoiceValue',
] as const;

export const GSTR2B_EXPECTED_FIELDS = [
  'supplierGstin',
  'supplierName',
  'documentNumber',
  'documentDate',
  'taxableValue',
  'igst',
  'cgst',
  'sgst',
  'cess',
  'totalTax',
] as const;

const HEADER_ALIASES: Record<string, string[]> = {
  supplierGstin: ['supplier gstin', 'gstin', 'vendor gstin', 'gstin of supplier', 'supplier_gstin'],
  supplierName: ['supplier name', 'trade/legal name', 'vendor name', 'party name', 'supplier_name', 'supplier'],
  invoiceNumber: ['invoice number', 'invoice no', 'inv no', 'bill no', 'invoice_number', 'document number'],
  documentNumber: ['document number', 'invoice number', 'doc no', 'document no', 'document_number', 'invoice no'],
  invoiceDate: ['invoice date', 'date', 'inv date', 'bill date', 'invoice_date', 'document date'],
  documentDate: ['document date', 'invoice date', 'doc date', 'date', 'document_date'],
  taxableValue: ['taxable value', 'taxable amount', 'assessable value', 'taxable_value', 'base amount'],
  cgst: ['cgst', 'central tax', 'cgst amount'],
  sgst: ['sgst', 'state/ut tax', 'state tax', 'sgst amount', 'utgst'],
  igst: ['igst', 'integrated tax', 'igst amount'],
  cess: ['cess', 'cess amount'],
  totalTax: ['total tax', 'tax amount', 'total_tax'],
  totalInvoiceValue: ['total invoice value', 'invoice value', 'grand total', 'total amount', 'total_invoice_value'],
  placeOfSupply: ['place of supply', 'pos', 'place_of_supply'],
  documentType: ['document type', 'doc type', 'type'],
};

export function autoDetectColumnMapping(
  headers: string[],
  expectedFields: readonly string[]
): Record<string, string> {
  const mapping: Record<string, string> = {};
  const normalizedHeaders = headers.map((h) => ({
    original: h,
    norm: h.toLowerCase().replace(/[_\-]+/g, ' ').trim(),
  }));

  for (const field of expectedFields) {
    const aliases = HEADER_ALIASES[field] ?? [field.toLowerCase()];
    const match = normalizedHeaders.find(
      (h) => h.norm === field.toLowerCase() || aliases.includes(h.norm)
    );
    if (match) {
      mapping[field] = match.original;
    }
  }
  return mapping;
}

export function validateAndBuildPurchaseEntries(params: {
  rows: Record<string, unknown>[];
  columnMapping: Record<string, string>;
  workspaceId: string;
  clientId: string;
  periodId: string;
  importId: string;
  existingEntries: PurchaseRegisterEntry[];
}): {
  entries: PurchaseRegisterEntry[];
  errors: ImportRowError[];
  duplicateCount: number;
} {
  const { rows, columnMapping, workspaceId, clientId, periodId, importId, existingEntries } = params;
  const now = new Date().toISOString();
  const entries: PurchaseRegisterEntry[] = [];
  const errors: ImportRowError[] = [];
  let duplicateCount = 0;

  const existingKeys = new Set(
    existingEntries.map((e) => `${e.supplierGstin}::${e.normalizedInvoiceNumber}`)
  );
  const seenInFile = new Set<string>();

  rows.forEach((row, index) => {
    const rowNumber = index + 2; // 1-indexed + header
    const rowErrors: string[] = [];

    const supplierGstin = toStr(row[columnMapping.supplierGstin ?? '']).toUpperCase();
    const supplierName = toStr(row[columnMapping.supplierName ?? '']);
    const invoiceNumber = toStr(row[columnMapping.invoiceNumber ?? '']);
    const rawDate = toStr(row[columnMapping.invoiceDate ?? '']);
    const normalizedDate = normalizeDateString(rawDate);

    const taxableValue = toNum(row[columnMapping.taxableValue ?? '']);
    const cgst = toNum(row[columnMapping.cgst ?? '']);
    const sgst = toNum(row[columnMapping.sgst ?? '']);
    const igst = toNum(row[columnMapping.igst ?? '']);
    const cess = toNum(row[columnMapping.cess ?? '']);
    const rawTotal = toNum(row[columnMapping.totalInvoiceValue ?? '']);

    if (!supplierGstin) {
      rowErrors.push('Supplier GSTIN is required');
      errors.push({ rowNumber, field: 'supplierGstin', message: 'Supplier GSTIN is required' });
    } else if (!isValidGstinFormat(supplierGstin)) {
      rowErrors.push(`Invalid GSTIN format: ${supplierGstin}`);
      errors.push({ rowNumber, field: 'supplierGstin', message: 'Invalid 15-character GSTIN format', rawValue: supplierGstin });
    }

    if (!supplierName) {
      rowErrors.push('Supplier name is required');
      errors.push({ rowNumber, field: 'supplierName', message: 'Supplier name is required' });
    }

    if (!invoiceNumber) {
      rowErrors.push('Invoice number is required');
      errors.push({ rowNumber, field: 'invoiceNumber', message: 'Invoice number is required' });
    }

    if (!normalizedDate) {
      rowErrors.push(`Invalid or missing invoice date: ${rawDate}`);
      errors.push({ rowNumber, field: 'invoiceDate', message: 'Invalid invoice date (expected YYYY-MM-DD or DD-MM-YYYY)', rawValue: rawDate });
    }

    if (Number.isNaN(taxableValue) || taxableValue < 0) {
      rowErrors.push('Invalid taxable value');
      errors.push({ rowNumber, field: 'taxableValue', message: 'Taxable value must be a non-negative number' });
    }

    const safeCgst = Number.isNaN(cgst) ? 0 : cgst;
    const safeSgst = Number.isNaN(sgst) ? 0 : sgst;
    const safeIgst = Number.isNaN(igst) ? 0 : igst;
    const safeCess = Number.isNaN(cess) ? 0 : cess;
    const safeTaxable = Number.isNaN(taxableValue) ? 0 : taxableValue;
    const totalTax = roundCurrency(safeCgst + safeSgst + safeIgst + safeCess);
    const computedTotal = roundCurrency(safeTaxable + totalTax);
    const totalInvoiceValue = Number.isNaN(rawTotal) || rawTotal === 0 ? computedTotal : rawTotal;

    const normNum = normalizeInvoiceNumber(invoiceNumber);
    const dedupKey = `${supplierGstin}::${normNum}`;

    if (existingKeys.has(dedupKey)) {
      duplicateCount++;
      errors.push({
        rowNumber,
        field: 'invoiceNumber',
        message: `Skipped duplicate against already imported Purchase Register (${invoiceNumber})`,
        rawValue: invoiceNumber,
      });
      return;
    }
    if (seenInFile.has(dedupKey)) {
      duplicateCount++;
      rowErrors.push('Duplicate invoice number within uploaded file');
    }
    seenInFile.add(dedupKey);

    entries.push({
      id: `pr_${importId}_${index + 1}`,
      workspaceId,
      clientId,
      periodId,
      importId,
      supplierGstin,
      supplierName: supplierName || 'Unnamed Supplier',
      invoiceNumber,
      normalizedInvoiceNumber: normNum,
      invoiceDate: normalizedDate ?? rawDate,
      taxableValue: safeTaxable,
      cgst: safeCgst,
      sgst: safeSgst,
      igst: safeIgst,
      cess: safeCess,
      totalTax,
      totalInvoiceValue,
      sourceRowNumber: rowNumber,
      isValid: rowErrors.length === 0,
      validationErrors: rowErrors,
      createdAt: now,
      updatedAt: now,
    });
  });

  return { entries, errors, duplicateCount };
}

export function validateAndBuildGstr2bEntries(params: {
  rows: Record<string, unknown>[];
  columnMapping: Record<string, string>;
  workspaceId: string;
  clientId: string;
  periodId: string;
  importId: string;
  existingEntries: GSTR2BEntry[];
}): {
  entries: GSTR2BEntry[];
  errors: ImportRowError[];
  duplicateCount: number;
} {
  const { rows, columnMapping, workspaceId, clientId, periodId, importId, existingEntries } = params;
  const now = new Date().toISOString();
  const entries: GSTR2BEntry[] = [];
  const errors: ImportRowError[] = [];
  let duplicateCount = 0;

  const existingKeys = new Set(
    existingEntries.map((e) => `${e.supplierGstin}::${e.normalizedDocumentNumber}`)
  );

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const rowErrors: string[] = [];

    const supplierGstin = toStr(row[columnMapping.supplierGstin ?? '']).toUpperCase();
    const supplierName = toStr(row[columnMapping.supplierName ?? '']);
    const documentNumber = toStr(row[columnMapping.documentNumber ?? '']);
    const rawDate = toStr(row[columnMapping.documentDate ?? '']);
    const normalizedDate = normalizeDateString(rawDate);

    const taxableValue = toNum(row[columnMapping.taxableValue ?? '']);
    const igst = toNum(row[columnMapping.igst ?? '']);
    const cgst = toNum(row[columnMapping.cgst ?? '']);
    const sgst = toNum(row[columnMapping.sgst ?? '']);
    const cess = toNum(row[columnMapping.cess ?? '']);
    const rawTotalTax = toNum(row[columnMapping.totalTax ?? '']);

    if (!supplierGstin || !isValidGstinFormat(supplierGstin)) {
      rowErrors.push(`Invalid or missing Supplier GSTIN: ${supplierGstin}`);
      errors.push({ rowNumber, field: 'supplierGstin', message: 'Invalid or missing GSTIN', rawValue: supplierGstin });
    }
    if (!documentNumber) {
      rowErrors.push('Document number is required');
      errors.push({ rowNumber, field: 'documentNumber', message: 'Document number is required' });
    }
    if (!normalizedDate) {
      rowErrors.push('Invalid document date');
      errors.push({ rowNumber, field: 'documentDate', message: 'Invalid document date', rawValue: rawDate });
    }

    const safeTaxable = Number.isNaN(taxableValue) ? 0 : taxableValue;
    const safeIgst = Number.isNaN(igst) ? 0 : igst;
    const safeCgst = Number.isNaN(cgst) ? 0 : cgst;
    const safeSgst = Number.isNaN(sgst) ? 0 : sgst;
    const safeCess = Number.isNaN(cess) ? 0 : cess;
    const computedTax = roundCurrency(safeIgst + safeCgst + safeSgst + safeCess);
    const totalTax = Number.isNaN(rawTotalTax) || rawTotalTax === 0 ? computedTax : rawTotalTax;

    const normDoc = normalizeInvoiceNumber(documentNumber);
    const dedupKey = `${supplierGstin}::${normDoc}`;

    if (existingKeys.has(dedupKey)) {
      duplicateCount++;
      errors.push({
        rowNumber,
        field: 'documentNumber',
        message: `Skipped duplicate GSTR-2B document (${documentNumber})`,
        rawValue: documentNumber,
      });
      return;
    }
    existingKeys.add(dedupKey);

    entries.push({
      id: `g2b_${importId}_${index + 1}`,
      workspaceId,
      clientId,
      periodId,
      importId,
      supplierGstin,
      supplierName: supplierName || 'Unnamed Supplier',
      documentNumber,
      normalizedDocumentNumber: normDoc,
      documentDate: normalizedDate ?? rawDate,
      documentType: 'INVOICE',
      placeOfSupply: toStr(row[columnMapping.placeOfSupply ?? '']) || 'Auto-detected',
      itcAvailabilityNote: 'Manual GSTR-2B import',
      taxableValue: safeTaxable,
      igst: safeIgst,
      cgst: safeCgst,
      sgst: safeSgst,
      cess: safeCess,
      totalTax,
      sourceRowNumber: rowNumber,
      isValid: rowErrors.length === 0,
      validationErrors: rowErrors,
      createdAt: now,
    });
  });

  return { entries, errors, duplicateCount };
}

export function generateSampleTemplateBuffer(
  kind: 'purchase-register' | 'gstr-2b',
  format: 'csv' | 'xlsx'
): { buffer: Buffer; mimeType: string; fileName: string } {
  const rows: Record<string, string | number>[] =
    kind === 'purchase-register'
      ? [
          {
            'Supplier GSTIN': '19ABCDE1234F1Z5',
            'Supplier Name': 'ABC Distributors (Demo)',
            'Invoice Number': 'ABC/109',
            'Invoice Date': '2026-11-10',
            'Taxable Value': 45000,
            CGST: 4050,
            SGST: 4050,
            IGST: 0,
            Cess: 0,
            'Total Invoice Value': 53100,
          },
          {
            'Supplier GSTIN': '27AAACS7719D1Z9',
            'Supplier Name': 'Surya Tech Systems (Demo)',
            'Invoice Number': 'STS/26/1205',
            'Invoice Date': '2026-11-11',
            'Taxable Value': 30000,
            CGST: 0,
            SGST: 0,
            IGST: 5400,
            Cess: 0,
            'Total Invoice Value': 35400,
          },
        ]
      : [
          {
            'Supplier GSTIN': '19ABCDE1234F1Z5',
            'Supplier Name': 'ABC Distributors (Demo)',
            'Document Number': 'ABC/109',
            'Document Date': '2026-11-10',
            'Taxable Value': 45000,
            IGST: 0,
            CGST: 4050,
            SGST: 4050,
            Cess: 0,
            'Total Tax': 8100,
          },
          {
            'Supplier GSTIN': '27AAACS7719D1Z9',
            'Supplier Name': 'Surya Tech Systems (Demo)',
            'Document Number': 'STS261205',
            'Document Date': '2026-11-11',
            'Taxable Value': 30000,
            IGST: 5400,
            CGST: 0,
            SGST: 0,
            Cess: 0,
            'Total Tax': 5400,
          },
        ];

  if (format === 'csv') {
    const csv = Papa.unparse(rows);
    return {
      buffer: Buffer.from(csv, 'utf8'),
      mimeType: 'text/csv; charset=utf-8',
      fileName: `${kind}-sample-template.csv`,
    };
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, kind === 'purchase-register' ? 'PurchaseRegister' : 'GSTR2B');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return {
    buffer: buf,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileName: `${kind}-sample-template.xlsx`,
  };
}
