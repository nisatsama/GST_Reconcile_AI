import {
  type AuditLog,
  type BusinessClient,
  type Discrepancy,
  type GSTRegistration,
  type GSTR2BEntry,
  type GSTR2BImport,
  type Invoice,
  type InvoiceExtraction,
  type PurchaseRegisterEntry,
  type PurchaseRegisterImport,
  type ReconciliationConfig,
  type ReconciliationResult,
  type ReconciliationRun,
  type ReportingPeriod,
  type Supplier,
  type SupplierFollowUp,
  type Workspace,
} from '../../src/shared/types.ts';
import { normalizeInvoiceNumber, roundCurrency } from '../../src/shared/validation.ts';
import { runDeterministicReconciliation } from '../services/reconciliationService.ts';

export interface StoreData {
  workspace: Workspace;
  clients: BusinessClient[];
  gstRegistrations: GSTRegistration[];
  periods: ReportingPeriod[];
  suppliers: Supplier[];
  invoices: Invoice[];
  extractions: InvoiceExtraction[];
  purchaseImports: PurchaseRegisterImport[];
  purchaseEntries: PurchaseRegisterEntry[];
  gstr2bImports: GSTR2BImport[];
  gstr2bEntries: GSTR2BEntry[];
  reconciliationConfig: ReconciliationConfig;
  reconciliationRuns: ReconciliationRun[];
  reconciliationResults: ReconciliationResult[];
  discrepancies: Discrepancy[];
  followUps: SupplierFollowUp[];
  auditLogs: AuditLog[];
}

export function buildInvoiceSvgDataUrl(params: {
  supplierName: string;
  supplierGstin: string;
  recipientName: string;
  recipientGstin: string;
  invoiceNumber: string;
  invoiceDate: string;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  grandTotal: number;
  description: string;
  hsn: string;
  blurred?: boolean;
}): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = (n: number) =>
    n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="680" height="860" viewBox="0 0 680 860">
    <rect width="680" height="860" fill="#ffffff"/>
    <rect x="24" y="24" width="632" height="812" fill="none" stroke="#CBD5E1" stroke-width="1.5"/>
    <rect x="24" y="24" width="632" height="72" fill="#123B5D"/>
    <text x="44" y="56" font-family="Arial, sans-serif" font-size="18" font-weight="bold" fill="#ffffff">${esc(params.supplierName)}</text>
    <text x="44" y="78" font-family="monospace" font-size="12" fill="#CBD5E1">GSTIN: ${esc(params.supplierGstin)} | DEMO TAX INVOICE</text>
    <text x="636" y="64" text-anchor="end" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#ffffff">TAX INVOICE</text>

    <text x="44" y="130" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#64748B">BILLED TO (RECIPIENT)</text>
    <text x="44" y="150" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#172B3A">${esc(params.recipientName)}</text>
    <text x="44" y="170" font-family="monospace" font-size="12" fill="#334155">GSTIN: ${esc(params.recipientGstin)}</text>

    <text x="420" y="130" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#64748B">INVOICE DETAILS</text>
    <text x="420" y="150" font-family="monospace" font-size="13" font-weight="bold" fill="#172B3A">No: ${esc(params.invoiceNumber)}</text>
    <text x="420" y="170" font-family="monospace" font-size="12" fill="#334155">Date: ${esc(params.invoiceDate)}</text>

    <line x1="44" y1="198" x2="636" y2="198" stroke="#E2E8F0" stroke-width="1"/>
    <rect x="44" y="214" width="592" height="32" fill="#F1F5F9"/>
    <text x="56" y="234" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#334155">DESCRIPTION OF GOODS / SERVICES</text>
    <text x="340" y="234" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#334155">HSN/SAC</text>
    <text x="624" y="234" text-anchor="end" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#334155">TAXABLE (INR)</text>

    <text x="56" y="276" font-family="Arial, sans-serif" font-size="13" fill="#172B3A">${esc(params.description)}</text>
    <text x="340" y="276" font-family="monospace" font-size="12" fill="#475569">${esc(params.hsn)}</text>
    <text x="624" y="276" text-anchor="end" font-family="monospace" font-size="13" fill="#172B3A">${fmt(params.taxableValue)}</text>
    <line x1="44" y1="305" x2="636" y2="305" stroke="#E2E8F0" stroke-width="1"/>

    <text x="410" y="355" font-family="Arial, sans-serif" font-size="12" fill="#475569">Taxable Value:</text>
    <text x="624" y="355" text-anchor="end" font-family="monospace" font-size="12" fill="#172B3A">₹ ${fmt(params.taxableValue)}</text>

    <text x="410" y="382" font-family="Arial, sans-serif" font-size="12" fill="#475569">CGST:</text>
    <text x="624" y="382" text-anchor="end" font-family="monospace" font-size="12" fill="#172B3A">₹ ${fmt(params.cgst)}</text>

    <text x="410" y="409" font-family="Arial, sans-serif" font-size="12" fill="#475569">SGST:</text>
    <text x="624" y="409" text-anchor="end" font-family="monospace" font-size="12" fill="#172B3A">₹ ${fmt(params.sgst)}</text>

    <text x="410" y="436" font-family="Arial, sans-serif" font-size="12" fill="#475569">IGST:</text>
    <text x="624" y="436" text-anchor="end" font-family="monospace" font-size="12" fill="#172B3A">₹ ${fmt(params.igst)}</text>

    <text x="410" y="463" font-family="Arial, sans-serif" font-size="12" font-weight="bold" fill="#334155">Total Tax:</text>
    <text x="624" y="463" text-anchor="end" font-family="monospace" font-size="12" font-weight="bold" fill="#334155">₹ ${fmt(params.totalTax)}</text>

    <rect x="396" y="482" width="240" height="40" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1"/>
    <text x="410" y="507" font-family="Arial, sans-serif" font-size="13" font-weight="bold" fill="#123B5D">GRAND TOTAL</text>
    <text x="624" y="507" text-anchor="end" font-family="monospace" font-size="14" font-weight="bold" fill="#123B5D">₹ ${fmt(params.grandTotal)}</text>

    ${params.blurred ? '<rect x="380" y="135" width="230" height="44" fill="#CBD5E1" fill-opacity="0.45"/><text x="44" y="580" font-family="Arial, sans-serif" font-size="12" fill="#D97706">Note: Simulated low-contrast scan region requiring human review</text>' : ''}

    <text x="44" y="790" font-family="Arial, sans-serif" font-size="10" fill="#64748B">SYNTHETIC DEMO INVOICE RECORD — FOR RECONCILIATION PROTOTYPE DEMONSTRATION ONLY</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function createDemoSeedData(): StoreData {
  const now = '2026-11-10T10:30:00.000Z';
  const workspaceId = 'ws_demo_india';

  const workspace: Workspace = {
    id: workspaceId,
    name: 'Mehta & Associates CA Practice (Demo Workspace)',
    userRoleView: 'CA_FIRM',
    persistenceMode: 'SERVER_FILE_DEMO',
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: now,
  };

  const clients: BusinessClient[] = [
    {
      id: 'client_eastern',
      workspaceId,
      legalName: 'Eastern Retail Solutions Pvt Ltd',
      tradeName: 'Eastern Retail Solutions',
      gstin: '19AABCU9603R1ZM',
      stateCode: '19',
      stateName: 'West Bengal',
      sector: 'FMCG & Retail Distribution',
      contactEmail: 'accounts@easternretail.demo',
      isDemo: true,
      createdAt: '2026-08-01T09:00:00.000Z',
      updatedAt: now,
    },
    {
      id: 'client_apex',
      workspaceId,
      legalName: 'Apex Precision Components Pvt Ltd',
      tradeName: 'Apex Precision Components',
      gstin: '27AADCA4821M1Z2',
      stateCode: '27',
      stateName: 'Maharashtra',
      sector: 'Industrial Manufacturing',
      contactEmail: 'finance@apexprecision.demo',
      isDemo: true,
      createdAt: '2026-08-05T09:00:00.000Z',
      updatedAt: now,
    },
  ];

  const gstRegistrations: GSTRegistration[] = [
    {
      id: 'gstreg_eastern_wb',
      workspaceId,
      clientId: 'client_eastern',
      gstin: '19AABCU9603R1ZM',
      stateName: 'West Bengal',
      registrationType: 'REGULAR',
      filingFrequency: 'MONTHLY',
    },
    {
      id: 'gstreg_apex_mh',
      workspaceId,
      clientId: 'client_apex',
      gstin: '27AADCA4821M1Z2',
      stateName: 'Maharashtra',
      registrationType: 'REGULAR',
      filingFrequency: 'MONTHLY',
    },
  ];

  const periods: ReportingPeriod[] = [
    { id: '2026-08', label: 'August 2026', shortLabel: 'Aug 2026', startDate: '2026-08-01', endDate: '2026-08-31' },
    { id: '2026-09', label: 'September 2026', shortLabel: 'Sep 2026', startDate: '2026-09-01', endDate: '2026-09-30' },
    { id: '2026-10', label: 'October 2026', shortLabel: 'Oct 2026', startDate: '2026-10-01', endDate: '2026-10-31' },
    { id: '2026-11', label: 'November 2026', shortLabel: 'Nov 2026', startDate: '2026-11-01', endDate: '2026-11-30' },
  ];

  const suppliers: Supplier[] = [
    { id: 'sup_1', workspaceId, gstin: '19ABCDE1234F1Z5', legalName: 'ABC Distributors (Demo)', email: 'billing@abcdist.demo', phone: '+91-98300-11201', stateName: 'West Bengal', category: 'Wholesale FMCG' },
    { id: 'sup_2', workspaceId, gstin: '19AADCB4521K1Z8', legalName: 'Bengal Packaging Pvt Ltd (Demo)', email: 'ar@bengalpack.demo', phone: '+91-98300-22402', stateName: 'West Bengal', category: 'Packaging' },
    { id: 'sup_3', workspaceId, gstin: '19AAACK8812L1Z4', legalName: 'Kalyani Logistics LLP (Demo)', email: 'accounts@kalyanilogistics.demo', phone: '+91-98300-33403', stateName: 'West Bengal', category: 'Freight & Logistics' },
    { id: 'sup_4', workspaceId, gstin: '27AAACS7719D1Z9', legalName: 'Surya Tech Systems (Demo)', email: 'gst@suryatech.demo', phone: '+91-98200-44504', stateName: 'Maharashtra', category: 'IT & POS Hardware' },
    { id: 'sup_5', workspaceId, gstin: '19AABCH9023E1Z1', legalName: 'Hooghly Retail Supplies (Demo)', email: 'tax@hooghlysupplies.demo', phone: '+91-98300-55605', stateName: 'West Bengal', category: 'Store Fixtures' },
    { id: 'sup_6', workspaceId, gstin: '19AAACM5123P1Z7', legalName: 'Metro Cold Chain Co (Demo)', email: 'finance@metrocold.demo', phone: '+91-98300-66706', stateName: 'West Bengal', category: 'Cold Storage' },
    { id: 'sup_7', workspaceId, gstin: '27AABCS4412N1Z3', legalName: 'Sahyadri Fasteners Ltd (Demo)', email: 'billing@sahyadrifast.demo', phone: '+91-98200-77807', stateName: 'Maharashtra', category: 'Industrial Components' },
  ];

  const config: ReconciliationConfig = {
    dateToleranceDays: 2,
    amountToleranceRupees: 5,
    enableFuzzyMatch: true,
    fuzzySimilarityThreshold: 0.72,
  };

  const invoices: Invoice[] = [];
  const extractions: InvoiceExtraction[] = [];
  const purchaseImports: PurchaseRegisterImport[] = [];
  const purchaseEntries: PurchaseRegisterEntry[] = [];
  const gstr2bImports: GSTR2BImport[] = [];
  const gstr2bEntries: GSTR2BEntry[] = [];
  const reconciliationRuns: ReconciliationRun[] = [];
  const reconciliationResults: ReconciliationResult[] = [];
  const discrepancies: Discrepancy[] = [];
  const followUps: SupplierFollowUp[] = [];
  const auditLogs: AuditLog[] = [];

  // =========================================================================
  // EASTERN RETAIL SOLUTIONS — OCTOBER 2026 (20 Invoices, 20 PR, 18 GSTR-2B)
  // =========================================================================
  interface SeedRowSpec {
    invNo: string;
    gstr2bInvNo?: string;
    supplierName: string;
    supplierGstin: string;
    gstr2bSupplierGstin?: string;
    date: string;
    taxable: number;
    cgst: number;
    sgst: number;
    igst: number;
    gstr2bTaxable?: number;
    gstr2bCgst?: number;
    gstr2bSgst?: number;
    gstr2bIgst?: number;
    hsn: string;
    desc: string;
    inGstr2b: boolean;
    lowConfidence?: boolean;
    isDuplicate?: boolean;
  }

  const octSpecs: SeedRowSpec[] = [
    // 1–12: Exact matches
    { invNo: 'BPL/26-27/401', supplierName: 'Bengal Packaging Pvt Ltd (Demo)', supplierGstin: '19AADCB4521K1Z8', date: '2026-10-02', taxable: 42000, cgst: 3780, sgst: 3780, igst: 0, hsn: '4819', desc: 'Corrugated Retail Cartons (Batch A)', inGstr2b: true },
    { invNo: 'KLL/26/851', supplierName: 'Kalyani Logistics LLP (Demo)', supplierGstin: '19AAACK8812L1Z4', date: '2026-10-04', taxable: 28000, cgst: 2520, sgst: 2520, igst: 0, hsn: '9965', desc: 'Intra-state Warehouse Freight', inGstr2b: true },
    { invNo: 'STS/26/1102', supplierName: 'Surya Tech Systems (Demo)', supplierGstin: '27AAACS7719D1Z9', date: '2026-10-05', taxable: 65000, cgst: 0, sgst: 0, igst: 11700, hsn: '8471', desc: 'POS Thermal Scanners & Terminals', inGstr2b: true },
    { invNo: 'HRS/26-27/088', supplierName: 'Hooghly Retail Supplies (Demo)', supplierGstin: '19AABCH9023E1Z1', date: '2026-10-06', taxable: 31500, cgst: 2835, sgst: 2835, igst: 0, hsn: '9403', desc: 'Modular Display Shelving Units', inGstr2b: true },
    { invNo: 'MCC/26/319', supplierName: 'Metro Cold Chain Co (Demo)', supplierGstin: '19AAACM5123P1Z7', date: '2026-10-08', taxable: 54000, cgst: 4860, sgst: 4860, igst: 0, hsn: '9967', desc: 'Chiller Storage Services Oct W1', inGstr2b: true },
    { invNo: 'ABC/082', supplierName: 'ABC Distributors (Demo)', supplierGstin: '19ABCDE1234F1Z5', date: '2026-10-09', taxable: 48000, cgst: 4320, sgst: 4320, igst: 0, hsn: '2106', desc: 'Packaged Beverage Stock Lot 1', inGstr2b: true },
    { invNo: 'BPL/26-27/405', supplierName: 'Bengal Packaging Pvt Ltd (Demo)', supplierGstin: '19AADCB4521K1Z8', date: '2026-10-10', taxable: 19500, cgst: 1755, sgst: 1755, igst: 0, hsn: '3923', desc: 'BOPP Sealing Tapes & Shrink Film', inGstr2b: true },
    { invNo: 'STS/26/1114', supplierName: 'Surya Tech Systems (Demo)', supplierGstin: '27AAACS7719D1Z9', date: '2026-10-11', taxable: 24000, cgst: 0, sgst: 0, igst: 4320, hsn: '9983', desc: 'Annual Billing Software Renewal', inGstr2b: true },
    { invNo: 'MCC/26/332', supplierName: 'Metro Cold Chain Co (Demo)', supplierGstin: '19AAACM5123P1Z7', date: '2026-10-14', taxable: 36000, cgst: 3240, sgst: 3240, igst: 0, hsn: '9967', desc: 'Chiller Storage Services Oct W2', inGstr2b: true },
    { invNo: 'HRS/26-27/102', supplierName: 'Hooghly Retail Supplies (Demo)', supplierGstin: '19AABCH9023E1Z1', date: '2026-10-15', taxable: 18000, cgst: 1620, sgst: 1620, igst: 0, hsn: '8302', desc: 'Rack Signage Brackets & Clips', inGstr2b: true },
    { invNo: 'HRD/26/214', supplierName: 'Hooghly Retail Supplies (Demo)', supplierGstin: '19AABCH9023E1Z1', date: '2026-10-16', taxable: 25000, cgst: 2250, sgst: 2250, igst: 0, hsn: '9403', desc: 'Checkout Counter Assembly', inGstr2b: true },
    { invNo: 'ABC/087', supplierName: 'ABC Distributors (Demo)', supplierGstin: '19ABCDE1234F1Z5', date: '2026-10-17', taxable: 72000, cgst: 6480, sgst: 6480, igst: 0, hsn: '1905', desc: 'Confectionery & Biscuit Assortment', inGstr2b: true },

    // 13: Invoice number formatting variation (matched via Level 2 Normalised)
    { invNo: 'INV-2026/041', gstr2bInvNo: 'INV2026041', supplierName: 'Surya Tech Systems (Demo)', supplierGstin: '27AAACS7719D1Z9', date: '2026-10-18', taxable: 30000, cgst: 0, sgst: 0, igst: 5400, hsn: '8443', desc: 'Barcode Label Printers (3 Units)', inGstr2b: true },

    // 14–15: Two tax amount mismatches
    { invNo: 'BPL/26-27/412', supplierName: 'Bengal Packaging Pvt Ltd (Demo)', supplierGstin: '19AADCB4521K1Z8', date: '2026-10-19', taxable: 100000, cgst: 9000, sgst: 9000, igst: 0, gstr2bTaxable: 100000, gstr2bCgst: 6000, gstr2bSgst: 6000, gstr2bIgst: 0, hsn: '4819', desc: 'Printed Export Master Cartons', inGstr2b: true },
    { invNo: 'MCC/26/349', supplierName: 'Metro Cold Chain Co (Demo)', supplierGstin: '19AAACM5123P1Z7', date: '2026-10-21', taxable: 50000, cgst: 4500, sgst: 4500, igst: 0, gstr2bTaxable: 50000, gstr2bCgst: 3000, gstr2bSgst: 3000, gstr2bIgst: 0, hsn: '9967', desc: 'Deep Freeze Pallet Storage', inGstr2b: true },

    // 16: One GSTIN mismatch
    { invNo: 'BPL/26-27/418', supplierName: 'Bengal Packaging Pvt Ltd (Demo)', supplierGstin: '19AADCB4521K1Z8', gstr2bSupplierGstin: '19AADCB4521K2Z6', date: '2026-10-22', taxable: 40000, cgst: 3600, sgst: 3600, igst: 0, hsn: '3923', desc: 'Custom Branded Carry Pouches', inGstr2b: true },

    // 17–18: Two invoices missing from uploaded GSTR-2B
    { invNo: 'ABC/091', supplierName: 'ABC Distributors (Demo)', supplierGstin: '19ABCDE1234F1Z5', date: '2026-10-12', taxable: 55000, cgst: 4950, sgst: 4950, igst: 0, hsn: '2106', desc: 'Festive Beverage Hamper Stock', inGstr2b: false },
    { invNo: 'KLL/26/884', supplierName: 'Kalyani Logistics LLP (Demo)', supplierGstin: '19AAACK8812L1Z4', date: '2026-10-24', taxable: 32000, cgst: 2880, sgst: 2880, igst: 0, hsn: '9965', desc: 'Regional Hub Linehaul Dispatch', inGstr2b: false },

    // 19: One possible duplicate invoice (duplicate of HRD/26/214)
    { invNo: 'HRD/26/214', supplierName: 'Hooghly Retail Supplies (Demo)', supplierGstin: '19AABCH9023E1Z1', date: '2026-10-16', taxable: 25000, cgst: 2250, sgst: 2250, igst: 0, hsn: '9403', desc: 'Checkout Counter Assembly (Duplicate Booking)', inGstr2b: false, isDuplicate: true },

    // 20: One low-confidence extraction requiring review (exists in PR and GSTR-2B)
    { invNo: 'KLL/26/892', supplierName: 'Kalyani Logistics LLP (Demo)', supplierGstin: '19AAACK8812L1Z4', date: '2026-10-27', taxable: 22000, cgst: 1980, sgst: 1980, igst: 0, hsn: '9965', desc: 'Last-Mile Store Delivery Batch 4', inGstr2b: true, lowConfidence: true },
  ];

  const prImportIdOct = 'primp_eastern_2026_10';
  const gstrImportIdOct = 'gstr2b_eastern_2026_10';

  purchaseImports.push({
    id: prImportIdOct,
    workspaceId,
    clientId: 'client_eastern',
    periodId: '2026-10',
    fileName: 'Eastern_Retail_Purchase_Register_Oct2026.xlsx',
    rowCount: 20,
    validCount: 20,
    invalidCount: 0,
    duplicateCount: 1,
    columnMapping: {
      supplierGstin: 'Supplier GSTIN',
      supplierName: 'Supplier Name',
      invoiceNumber: 'Invoice Number',
      invoiceDate: 'Invoice Date',
      taxableValue: 'Taxable Value',
      cgst: 'CGST',
      sgst: 'SGST',
      igst: 'IGST',
      cess: 'Cess',
      totalInvoiceValue: 'Total Invoice Value',
    },
    errors: [],
    source: 'DEMO_SEED',
    createdAt: '2026-10-31T14:20:00.000Z',
  });

  gstr2bImports.push({
    id: gstrImportIdOct,
    workspaceId,
    clientId: 'client_eastern',
    periodId: '2026-10',
    fileName: 'GSTR2B_19AABCU9603R1ZM_102026_ManualExport.xlsx',
    rowCount: 18,
    validCount: 18,
    invalidCount: 0,
    duplicateCount: 0,
    errors: [],
    source: 'DEMO_SEED',
    createdAt: '2026-11-02T09:15:00.000Z',
  });

  octSpecs.forEach((spec, idx) => {
    const seq = idx + 1;
    const totalTax = roundCurrency(spec.cgst + spec.sgst + spec.igst);
    const grandTotal = roundCurrency(spec.taxable + totalTax);
    const invId = `inv_est_10_${seq}`;
    const extId = `ext_est_10_${seq}`;
    const conf = spec.lowConfidence ? 0.68 : 0.97;

    invoices.push({
      id: invId,
      workspaceId,
      clientId: 'client_eastern',
      periodId: '2026-10',
      fileName: `${spec.invNo.replace(/[\/]/g, '_')}.svg`,
      mimeType: 'image/svg+xml',
      fileSize: 4820,
      fileDataUrl: buildInvoiceSvgDataUrl({
        supplierName: spec.supplierName,
        supplierGstin: spec.supplierGstin,
        recipientName: 'Eastern Retail Solutions Pvt Ltd',
        recipientGstin: '19AABCU9603R1ZM',
        invoiceNumber: spec.invNo,
        invoiceDate: spec.date,
        taxableValue: spec.taxable,
        cgst: spec.cgst,
        sgst: spec.sgst,
        igst: spec.igst,
        totalTax,
        grandTotal,
        description: spec.desc,
        hsn: spec.hsn,
        blurred: spec.lowConfidence,
      }),
      uploadSource: 'DEMO_SEED',
      status: spec.lowConfidence ? 'NEEDS_REVIEW' : 'APPROVED',
      extractionId: extId,
      approvedBy: spec.lowConfidence ? undefined : 'R. Mehta (CA)',
      approvedAt: spec.lowConfidence ? undefined : '2026-10-30T11:00:00.000Z',
      createdAt: '2026-10-29T10:00:00.000Z',
      updatedAt: '2026-10-30T11:00:00.000Z',
    });

    extractions.push({
      id: extId,
      invoiceId: invId,
      modelUsed: 'gemini-4-hydrogen',
      supplierName: { value: spec.supplierName, confidence: conf, evidence: 'Header block', validationStatus: 'VALID' },
      supplierGstin: { value: spec.supplierGstin, confidence: spec.lowConfidence ? 0.72 : 0.99, evidence: 'Header GSTIN line', validationStatus: 'VALID' },
      recipientName: { value: 'Eastern Retail Solutions Pvt Ltd', confidence: 0.98, evidence: 'Billed To section', validationStatus: 'VALID' },
      recipientGstin: { value: '19AABCU9603R1ZM', confidence: 0.99, evidence: 'Recipient GSTIN', validationStatus: 'VALID' },
      invoiceNumber: {
        value: spec.invNo,
        confidence: spec.lowConfidence ? 0.64 : 0.98,
        evidence: 'Top-right invoice metadata',
        validationStatus: spec.lowConfidence ? 'WARNING' : 'VALID',
        validationMessage: spec.lowConfidence ? 'Low OCR contrast around invoice serial number; verify before approval.' : undefined,
      },
      invoiceDate: { value: spec.date, confidence: spec.lowConfidence ? 0.69 : 0.97, evidence: 'Invoice date field', validationStatus: 'VALID' },
      placeOfSupply: { value: spec.igst > 0 ? '27-Maharashtra' : '19-West Bengal', confidence: 0.95, evidence: 'Tax table', validationStatus: 'VALID' },
      hsnSacCodes: { value: [spec.hsn], confidence: 0.94, evidence: 'Line item table', validationStatus: 'VALID' },
      taxableValue: { value: spec.taxable, confidence: conf, evidence: 'Totals summary', validationStatus: 'VALID' },
      cgst: { value: spec.cgst, confidence: conf, evidence: 'Tax summary', validationStatus: 'VALID' },
      sgst: { value: spec.sgst, confidence: conf, evidence: 'Tax summary', validationStatus: 'VALID' },
      igst: { value: spec.igst, confidence: conf, evidence: 'Tax summary', validationStatus: 'VALID' },
      cess: { value: 0, confidence: 0.99, evidence: 'Tax summary', validationStatus: 'VALID' },
      totalTax: { value: totalTax, confidence: conf, evidence: 'Total tax row', validationStatus: 'VALID' },
      grandTotal: { value: grandTotal, confidence: conf, evidence: 'Grand total box', validationStatus: 'VALID' },
      currency: { value: 'INR', confidence: 0.99, evidence: '₹ symbol', validationStatus: 'VALID' },
      lineItems: [
        {
          description: spec.desc,
          hsnSac: spec.hsn,
          quantity: 1,
          unitPrice: spec.taxable,
          taxableValue: spec.taxable,
          taxRatePercent: Math.round((totalTax / spec.taxable) * 100),
        },
      ],
      overallConfidence: conf,
      reviewRequired: Boolean(spec.lowConfidence),
      validationWarnings: spec.lowConfidence
        ? ['Low extraction confidence (68%) on scanned invoice header — manual verification required.']
        : [],
      createdAt: '2026-10-29T10:00:00.000Z',
      updatedAt: '2026-10-29T10:00:00.000Z',
    });

    purchaseEntries.push({
      id: `pr_est_10_${seq}`,
      workspaceId,
      clientId: 'client_eastern',
      periodId: '2026-10',
      importId: prImportIdOct,
      supplierGstin: spec.supplierGstin,
      supplierName: spec.supplierName,
      invoiceNumber: spec.invNo,
      normalizedInvoiceNumber: normalizeInvoiceNumber(spec.invNo),
      invoiceDate: spec.date,
      taxableValue: spec.taxable,
      cgst: spec.cgst,
      sgst: spec.sgst,
      igst: spec.igst,
      cess: 0,
      totalTax,
      totalInvoiceValue: grandTotal,
      sourceRowNumber: seq,
      isValid: true,
      validationErrors: [],
      createdAt: '2026-10-31T14:20:00.000Z',
      updatedAt: '2026-10-31T14:20:00.000Z',
    });

    if (spec.inGstr2b) {
      const gTaxable = spec.gstr2bTaxable ?? spec.taxable;
      const gCgst = spec.gstr2bCgst ?? spec.cgst;
      const gSgst = spec.gstr2bSgst ?? spec.sgst;
      const gIgst = spec.gstr2bIgst ?? spec.igst;
      const gTotalTax = roundCurrency(gCgst + gSgst + gIgst);
      const docNum = spec.gstr2bInvNo ?? spec.invNo;

      gstr2bEntries.push({
        id: `g2b_est_10_${gstr2bEntries.length + 1}`,
        workspaceId,
        clientId: 'client_eastern',
        periodId: '2026-10',
        importId: gstrImportIdOct,
        supplierGstin: spec.gstr2bSupplierGstin ?? spec.supplierGstin,
        supplierName: spec.supplierName,
        documentNumber: docNum,
        normalizedDocumentNumber: normalizeInvoiceNumber(docNum),
        documentDate: spec.date,
        documentType: 'INVOICE',
        placeOfSupply: spec.igst > 0 ? '27-Maharashtra' : '19-West Bengal',
        itcAvailabilityNote: 'Available per supplier-filed statement (verify against books)',
        taxableValue: gTaxable,
        igst: gIgst,
        cgst: gCgst,
        sgst: gSgst,
        cess: 0,
        totalTax: gTotalTax,
        sourceRowNumber: gstr2bEntries.length + 1,
        isValid: true,
        validationErrors: [],
        createdAt: '2026-11-02T09:15:00.000Z',
      });
    }
  });

  // Add the 18th GSTR-2B entry: Extra entry reported in GSTR-2B not in Purchase Register
  gstr2bEntries.push({
    id: 'g2b_est_10_18',
    workspaceId,
    clientId: 'client_eastern',
    periodId: '2026-10',
    importId: gstrImportIdOct,
    supplierGstin: '19AABCH9023E1Z1',
    supplierName: 'Hooghly Retail Supplies (Demo)',
    documentNumber: 'HRS/26-27/119',
    normalizedDocumentNumber: normalizeInvoiceNumber('HRS/26-27/119'),
    documentDate: '2026-10-28',
    documentType: 'INVOICE',
    placeOfSupply: '19-West Bengal',
    itcAvailabilityNote: 'Reported by supplier in GSTR-1/2B; not yet booked in PR',
    taxableValue: 15000,
    igst: 0,
    cgst: 1350,
    sgst: 1350,
    cess: 0,
    totalTax: 2700,
    sourceRowNumber: 18,
    isValid: true,
    validationErrors: [],
    createdAt: '2026-11-02T09:15:00.000Z',
  });

  // =========================================================================
  // HISTORICAL PERIODS FOR EASTERN RETAIL SOLUTIONS (Aug 2026 & Sep 2026)
  // Enables realistic monthly trends + cross-period carried-forward tracking
  // =========================================================================
  const augPrId = 'primp_eastern_2026_08';
  const aug2bId = 'gstr2b_eastern_2026_08';
  const augSpecs = [
    { invNo: 'BPL/26-27/290', name: 'Bengal Packaging Pvt Ltd (Demo)', gstin: '19AADCB4521K1Z8', date: '2026-08-07', tax: 5400, val: 30000, in2b: true },
    { invNo: 'ABC/044', name: 'ABC Distributors (Demo)', gstin: '19ABCDE1234F1Z5', date: '2026-08-12', tax: 8100, val: 45000, in2b: true },
    { invNo: 'MCC/26/210', name: 'Metro Cold Chain Co (Demo)', gstin: '19AAACM5123P1Z7', date: '2026-08-19', tax: 7200, val: 40000, in2b: true },
    { invNo: 'STS/26/0912', name: 'Surya Tech Systems (Demo)', gstin: '27AAACS7719D1Z9', date: '2026-08-23', tax: 9000, val: 50000, in2b: true },
  ];
  augSpecs.forEach((s, i) => {
    const isIgst = s.gstin.startsWith('27');
    purchaseEntries.push({
      id: `pr_est_08_${i + 1}`,
      workspaceId,
      clientId: 'client_eastern',
      periodId: '2026-08',
      importId: augPrId,
      supplierGstin: s.gstin,
      supplierName: s.name,
      invoiceNumber: s.invNo,
      normalizedInvoiceNumber: normalizeInvoiceNumber(s.invNo),
      invoiceDate: s.date,
      taxableValue: s.val,
      cgst: isIgst ? 0 : s.tax / 2,
      sgst: isIgst ? 0 : s.tax / 2,
      igst: isIgst ? s.tax : 0,
      cess: 0,
      totalTax: s.tax,
      totalInvoiceValue: s.val + s.tax,
      sourceRowNumber: i + 1,
      isValid: true,
      validationErrors: [],
      createdAt: '2026-08-31T12:00:00.000Z',
      updatedAt: '2026-08-31T12:00:00.000Z',
    });
    if (s.in2b) {
      gstr2bEntries.push({
        id: `g2b_est_08_${i + 1}`,
        workspaceId,
        clientId: 'client_eastern',
        periodId: '2026-08',
        importId: aug2bId,
        supplierGstin: s.gstin,
        supplierName: s.name,
        documentNumber: s.invNo,
        normalizedDocumentNumber: normalizeInvoiceNumber(s.invNo),
        documentDate: s.date,
        documentType: 'INVOICE',
        placeOfSupply: isIgst ? '27-Maharashtra' : '19-West Bengal',
        itcAvailabilityNote: 'Available',
        taxableValue: s.val,
        igst: isIgst ? s.tax : 0,
        cgst: isIgst ? 0 : s.tax / 2,
        sgst: isIgst ? 0 : s.tax / 2,
        cess: 0,
        totalTax: s.tax,
        sourceRowNumber: i + 1,
        isValid: true,
        validationErrors: [],
        createdAt: '2026-09-02T12:00:00.000Z',
      });
    }
  });

  // September 2026: includes 1 carried-forward mismatch with Kalyani Logistics LLP + 5 matched
  const sepPrId = 'primp_eastern_2026_09';
  const sep2bId = 'gstr2b_eastern_2026_09';
  const sepSpecs = [
    { invNo: 'BPL/26-27/350', name: 'Bengal Packaging Pvt Ltd (Demo)', gstin: '19AADCB4521K1Z8', date: '2026-09-05', tax: 6300, val: 35000, in2b: true },
    { invNo: 'ABC/065', name: 'ABC Distributors (Demo)', gstin: '19ABCDE1234F1Z5', date: '2026-09-10', tax: 9000, val: 50000, in2b: true },
    { invNo: 'MCC/26/275', name: 'Metro Cold Chain Co (Demo)', gstin: '19AAACM5123P1Z7', date: '2026-09-14', tax: 6480, val: 36000, in2b: true },
    { invNo: 'HRS/26-27/061', name: 'Hooghly Retail Supplies (Demo)', gstin: '19AABCH9023E1Z1', date: '2026-09-19', tax: 3960, val: 22000, in2b: true },
    { invNo: 'KLL/26/810', name: 'Kalyani Logistics LLP (Demo)', gstin: '19AAACK8812L1Z4', date: '2026-09-25', tax: 4320, val: 24000, in2b: false }, // carried forward!
  ];
  sepSpecs.forEach((s, i) => {
    purchaseEntries.push({
      id: `pr_est_09_${i + 1}`,
      workspaceId,
      clientId: 'client_eastern',
      periodId: '2026-09',
      importId: sepPrId,
      supplierGstin: s.gstin,
      supplierName: s.name,
      invoiceNumber: s.invNo,
      normalizedInvoiceNumber: normalizeInvoiceNumber(s.invNo),
      invoiceDate: s.date,
      taxableValue: s.val,
      cgst: s.tax / 2,
      sgst: s.tax / 2,
      igst: 0,
      cess: 0,
      totalTax: s.tax,
      totalInvoiceValue: s.val + s.tax,
      sourceRowNumber: i + 1,
      isValid: true,
      validationErrors: [],
      createdAt: '2026-09-30T12:00:00.000Z',
      updatedAt: '2026-09-30T12:00:00.000Z',
    });
    if (s.in2b) {
      gstr2bEntries.push({
        id: `g2b_est_09_${i + 1}`,
        workspaceId,
        clientId: 'client_eastern',
        periodId: '2026-09',
        importId: sep2bId,
        supplierGstin: s.gstin,
        supplierName: s.name,
        documentNumber: s.invNo,
        normalizedDocumentNumber: normalizeInvoiceNumber(s.invNo),
        documentDate: s.date,
        documentType: 'INVOICE',
        placeOfSupply: '19-West Bengal',
        itcAvailabilityNote: 'Available',
        taxableValue: s.val,
        igst: 0,
        cgst: s.tax / 2,
        sgst: s.tax / 2,
        cess: 0,
        totalTax: s.tax,
        sourceRowNumber: i + 1,
        isValid: true,
        validationErrors: [],
        createdAt: '2026-10-02T12:00:00.000Z',
      });
    }
  });

  // Also link KLL/26/884 in Oct to Kalyani Logistics recurring tracking and seed Nov 2026 with 3 early entries
  purchaseEntries.push(
    {
      id: 'pr_est_11_1',
      workspaceId,
      clientId: 'client_eastern',
      periodId: '2026-11',
      importId: 'primp_eastern_2026_11',
      supplierGstin: '19ABCDE1234F1Z5',
      supplierName: 'ABC Distributors (Demo)',
      invoiceNumber: 'ABC/104',
      normalizedInvoiceNumber: normalizeInvoiceNumber('ABC/104'),
      invoiceDate: '2026-11-04',
      taxableValue: 38000,
      cgst: 3420,
      sgst: 3420,
      igst: 0,
      cess: 0,
      totalTax: 6840,
      totalInvoiceValue: 44840,
      sourceRowNumber: 1,
      isValid: true,
      validationErrors: [],
      createdAt: '2026-11-05T10:00:00.000Z',
      updatedAt: '2026-11-05T10:00:00.000Z',
    },
    {
      id: 'pr_est_11_2',
      workspaceId,
      clientId: 'client_eastern',
      periodId: '2026-11',
      importId: 'primp_eastern_2026_11',
      supplierGstin: '19AAACK8812L1Z4',
      supplierName: 'Kalyani Logistics LLP (Demo)',
      invoiceNumber: 'KLL/26/915',
      normalizedInvoiceNumber: normalizeInvoiceNumber('KLL/26/915'),
      invoiceDate: '2026-11-06',
      taxableValue: 26000,
      cgst: 2340,
      sgst: 2340,
      igst: 0,
      cess: 0,
      totalTax: 4680,
      totalInvoiceValue: 30680,
      sourceRowNumber: 2,
      isValid: true,
      validationErrors: [],
      createdAt: '2026-11-06T16:00:00.000Z',
      updatedAt: '2026-11-06T16:00:00.000Z',
    }
  );
  gstr2bEntries.push({
    id: 'g2b_est_11_1',
    workspaceId,
    clientId: 'client_eastern',
    periodId: '2026-11',
    importId: 'gstr2b_eastern_2026_11',
    supplierGstin: '19ABCDE1234F1Z5',
    supplierName: 'ABC Distributors (Demo)',
    documentNumber: 'ABC/104',
    normalizedDocumentNumber: normalizeInvoiceNumber('ABC/104'),
    documentDate: '2026-11-04',
    documentType: 'INVOICE',
    placeOfSupply: '19-West Bengal',
    itcAvailabilityNote: 'Provisional Nov statement',
    taxableValue: 38000,
    igst: 0,
    cgst: 3420,
    sgst: 3420,
    cess: 0,
    totalTax: 6840,
    sourceRowNumber: 1,
    isValid: true,
    validationErrors: [],
    createdAt: '2026-11-10T10:00:00.000Z',
  });

  // =========================================================================
  // CLIENT 2: APEX PRECISION COMPONENTS (27AADCA4821M1Z2) — OCT 2026
  // =========================================================================
  const apexSpecs = [
    { invNo: 'SF/26/401', name: 'Sahyadri Fasteners Ltd (Demo)', gstin: '27AABCS4412N1Z3', date: '2026-10-03', taxable: 85000, cgst: 7650, sgst: 7650, igst: 0, in2b: true },
    { invNo: 'STS/26/1090', name: 'Surya Tech Systems (Demo)', gstin: '27AAACS7719D1Z9', date: '2026-10-09', taxable: 45000, cgst: 4050, sgst: 4050, igst: 0, in2b: true },
    { invNo: 'SF/26/419', name: 'Sahyadri Fasteners Ltd (Demo)', gstin: '27AABCS4412N1Z3', date: '2026-10-18', taxable: 62000, cgst: 5580, sgst: 5580, igst: 0, in2b: false },
  ];

  apexSpecs.forEach((s, idx) => {
    const seq = idx + 1;
    const totalTax = roundCurrency(s.cgst + s.sgst + s.igst);
    const invId = `inv_apex_10_${seq}`;
    const extId = `ext_apex_10_${seq}`;
    invoices.push({
      id: invId,
      workspaceId,
      clientId: 'client_apex',
      periodId: '2026-10',
      fileName: `${s.invNo.replace(/[\/]/g, '_')}.svg`,
      mimeType: 'image/svg+xml',
      fileSize: 4510,
      fileDataUrl: buildInvoiceSvgDataUrl({
        supplierName: s.name,
        supplierGstin: s.gstin,
        recipientName: 'Apex Precision Components Pvt Ltd',
        recipientGstin: '27AADCA4821M1Z2',
        invoiceNumber: s.invNo,
        invoiceDate: s.date,
        taxableValue: s.taxable,
        cgst: s.cgst,
        sgst: s.sgst,
        igst: s.igst,
        totalTax,
        grandTotal: s.taxable + totalTax,
        description: 'Precision CNC Alloy Assemblies',
        hsn: '7318',
      }),
      uploadSource: 'DEMO_SEED',
      status: 'APPROVED',
      extractionId: extId,
      approvedBy: 'A. Kulkarni (Finance)',
      approvedAt: '2026-10-25T10:00:00.000Z',
      createdAt: '2026-10-24T10:00:00.000Z',
      updatedAt: '2026-10-25T10:00:00.000Z',
    });

    extractions.push({
      id: extId,
      invoiceId: invId,
      modelUsed: 'gemini-4-hydrogen',
      supplierName: { value: s.name, confidence: 0.98, evidence: 'Header', validationStatus: 'VALID' },
      supplierGstin: { value: s.gstin, confidence: 0.99, evidence: 'GSTIN line', validationStatus: 'VALID' },
      recipientName: { value: 'Apex Precision Components Pvt Ltd', confidence: 0.98, evidence: 'Recipient', validationStatus: 'VALID' },
      recipientGstin: { value: '27AADCA4821M1Z2', confidence: 0.99, evidence: 'Recipient GSTIN', validationStatus: 'VALID' },
      invoiceNumber: { value: s.invNo, confidence: 0.98, evidence: 'Invoice #', validationStatus: 'VALID' },
      invoiceDate: { value: s.date, confidence: 0.98, evidence: 'Date', validationStatus: 'VALID' },
      placeOfSupply: { value: '27-Maharashtra', confidence: 0.97, evidence: 'Tax summary', validationStatus: 'VALID' },
      hsnSacCodes: { value: ['7318'], confidence: 0.95, evidence: 'Line items', validationStatus: 'VALID' },
      taxableValue: { value: s.taxable, confidence: 0.98, evidence: 'Taxable', validationStatus: 'VALID' },
      cgst: { value: s.cgst, confidence: 0.98, evidence: 'CGST', validationStatus: 'VALID' },
      sgst: { value: s.sgst, confidence: 0.98, evidence: 'SGST', validationStatus: 'VALID' },
      igst: { value: 0, confidence: 0.99, evidence: 'IGST', validationStatus: 'VALID' },
      cess: { value: 0, confidence: 0.99, evidence: 'Cess', validationStatus: 'VALID' },
      totalTax: { value: totalTax, confidence: 0.98, evidence: 'Total tax', validationStatus: 'VALID' },
      grandTotal: { value: s.taxable + totalTax, confidence: 0.98, evidence: 'Grand total', validationStatus: 'VALID' },
      currency: { value: 'INR', confidence: 0.99, evidence: '₹', validationStatus: 'VALID' },
      lineItems: [{ description: 'Precision CNC Alloy Assemblies', hsnSac: '7318', quantity: 1, unitPrice: s.taxable, taxableValue: s.taxable, taxRatePercent: 18 }],
      overallConfidence: 0.98,
      reviewRequired: false,
      validationWarnings: [],
      createdAt: '2026-10-24T10:00:00.000Z',
      updatedAt: '2026-10-24T10:00:00.000Z',
    });

    purchaseEntries.push({
      id: `pr_apex_10_${seq}`,
      workspaceId,
      clientId: 'client_apex',
      periodId: '2026-10',
      importId: 'primp_apex_2026_10',
      supplierGstin: s.gstin,
      supplierName: s.name,
      invoiceNumber: s.invNo,
      normalizedInvoiceNumber: normalizeInvoiceNumber(s.invNo),
      invoiceDate: s.date,
      taxableValue: s.taxable,
      cgst: s.cgst,
      sgst: s.sgst,
      igst: 0,
      cess: 0,
      totalTax,
      totalInvoiceValue: s.taxable + totalTax,
      sourceRowNumber: seq,
      isValid: true,
      validationErrors: [],
      createdAt: '2026-10-30T10:00:00.000Z',
      updatedAt: '2026-10-30T10:00:00.000Z',
    });

    if (s.in2b) {
      gstr2bEntries.push({
        id: `g2b_apex_10_${seq}`,
        workspaceId,
        clientId: 'client_apex',
        periodId: '2026-10',
        importId: 'gstr2b_apex_2026_10',
        supplierGstin: s.gstin,
        supplierName: s.name,
        documentNumber: s.invNo,
        normalizedDocumentNumber: normalizeInvoiceNumber(s.invNo),
        documentDate: s.date,
        documentType: 'INVOICE',
        placeOfSupply: '27-Maharashtra',
        itcAvailabilityNote: 'Available',
        taxableValue: s.taxable,
        igst: 0,
        cgst: s.cgst,
        sgst: s.sgst,
        cess: 0,
        totalTax,
        sourceRowNumber: seq,
        isValid: true,
        validationErrors: [],
        createdAt: '2026-11-02T10:00:00.000Z',
      });
    }
  });

  // Run deterministic reconciliation across seeded periods so dashboard & tables are 100% consistent
  const runPlans: Array<{ clientId: string; periodId: string }> = [
    { clientId: 'client_eastern', periodId: '2026-08' },
    { clientId: 'client_eastern', periodId: '2026-09' },
    { clientId: 'client_eastern', periodId: '2026-10' },
    { clientId: 'client_eastern', periodId: '2026-11' },
    { clientId: 'client_apex', periodId: '2026-10' },
  ];

  for (const plan of runPlans) {
    const prevDiscrepancies = discrepancies.filter(
      (d) => d.clientId === plan.clientId && d.periodId < plan.periodId
    );
    const out = runDeterministicReconciliation({
      workspaceId,
      clientId: plan.clientId,
      periodId: plan.periodId,
      config,
      invoices: invoices.filter((i) => i.clientId === plan.clientId && i.periodId === plan.periodId),
      extractions,
      purchaseEntries: purchaseEntries.filter((p) => p.clientId === plan.clientId && p.periodId === plan.periodId),
      gstr2bEntries: gstr2bEntries.filter((g) => g.clientId === plan.clientId && g.periodId === plan.periodId),
      existingDiscrepancies: [],
      previousPeriodDiscrepancies: prevDiscrepancies,
    });
    reconciliationRuns.push(out.run);
    reconciliationResults.push(...out.results);
    discrepancies.push(...out.discrepancies);
  }

  // Seed one drafted supplier follow-up for ABC/091 so Follow-ups queue has an example ready
  const abc091Disc = discrepancies.find(
    (d) => d.clientId === 'client_eastern' && d.periodId === '2026-10' && d.invoiceNumber === 'ABC/091'
  );
  if (abc091Disc) {
    abc091Disc.status = 'UNDER_REVIEW';
    followUps.push({
      id: 'fu_demo_abc091',
      workspaceId,
      clientId: 'client_eastern',
      periodId: '2026-10',
      discrepancyId: abc091Disc.id,
      invoiceNumber: 'ABC/091',
      supplierName: 'ABC Distributors (Demo)',
      supplierGstin: '19ABCDE1234F1Z5',
      supplierEmail: 'billing@abcdist.demo',
      channel: 'EMAIL',
      subject: 'Clarification required for GST invoice ABC/091 — October 2026 Reconciliation',
      emailBody: `Dear ABC Distributors Team,\n\nWe are reconciling our purchase records for October 2026 and could not locate a corresponding invoice entry in the GSTR-2B data currently available to us.\n\nCould you please verify the invoice details below and confirm whether any correction or reporting update is required?\n\nInvoice Number: ABC/091\nInvoice Date: 12 October 2026\nTaxable Value: ₹55,000\nTotal Tax (CGST + SGST): ₹9,900\n\nRegards,\nAccounts Team — Eastern Retail Solutions`,
      whatsappBody: `Hello ABC Distributors team, we are reconciling Oct 2026 GST records for Eastern Retail Solutions. Invoice ABC/091 (dt 12 Oct 2026, Taxable ₹55,000, Tax ₹9,900) was not found in our uploaded GSTR-2B. Could you please confirm its reporting status?`,
      status: 'DRAFT',
      approvedBy: null,
      approvedAt: null,
      sentAt: null,
      responseNotes: null,
      createdAt: '2026-11-03T11:20:00.000Z',
      updatedAt: '2026-11-03T11:20:00.000Z',
    });
  }

  // Seed realistic audit trail events for Eastern Retail Solutions October 2026
  auditLogs.push(
    {
      id: 'aud_1',
      workspaceId,
      clientId: 'client_eastern',
      periodId: '2026-10',
      actor: 'R. Mehta (CA)',
      action: 'INVOICE_BATCH_UPLOADED',
      entityType: 'INVOICE',
      entityId: 'inv_est_10_20',
      summary: '20 demo supplier invoices loaded; 19 approved and 1 flagged (KLL/26/892) for low-confidence manual review.',
      createdAt: '2026-10-30T11:05:00.000Z',
    },
    {
      id: 'aud_2',
      workspaceId,
      clientId: 'client_eastern',
      periodId: '2026-10',
      actor: 'Accounts Desk',
      action: 'PURCHASE_REGISTER_IMPORTED',
      entityType: 'PURCHASE_REGISTER',
      entityId: prImportIdOct,
      summary: 'Imported Eastern_Retail_Purchase_Register_Oct2026.xlsx (20 rows, 1 duplicate warning detected).',
      createdAt: '2026-10-31T14:20:00.000Z',
    },
    {
      id: 'aud_3',
      workspaceId,
      clientId: 'client_eastern',
      periodId: '2026-10',
      actor: 'Accounts Desk',
      action: 'GSTR2B_IMPORTED',
      entityType: 'GSTR2B',
      entityId: gstrImportIdOct,
      summary: 'Imported GSTR2B_19AABCU9603R1ZM_102026_ManualExport.xlsx (18 valid document rows).',
      createdAt: '2026-11-02T09:15:00.000Z',
    },
    {
      id: 'aud_4',
      workspaceId,
      clientId: 'client_eastern',
      periodId: '2026-10',
      actor: 'Deterministic Engine',
      action: 'RECONCILIATION_COMPLETED',
      entityType: 'RECONCILIATION',
      entityId: reconciliationRuns.find((r) => r.clientId === 'client_eastern' && r.periodId === '2026-10')?.id ?? 'run_oct',
      summary: 'Completed 3-way reconciliation for October 2026: 13 matched (incl. 1 normalised invoice format), 8 discrepancies flagged.',
      createdAt: '2026-11-02T09:20:00.000Z',
    },
    {
      id: 'aud_5',
      workspaceId,
      clientId: 'client_eastern',
      periodId: '2026-10',
      actor: 'R. Mehta (CA)',
      action: 'FOLLOW_UP_DRAFTED',
      entityType: 'FOLLOW_UP',
      entityId: 'fu_demo_abc091',
      summary: 'Drafted supplier clarification message for ABC/091 (ABC Distributors) awaiting human approval.',
      createdAt: '2026-11-03T11:20:00.000Z',
    }
  );

  return {
    workspace,
    clients,
    gstRegistrations,
    periods,
    suppliers,
    invoices,
    extractions,
    purchaseImports,
    purchaseEntries,
    gstr2bImports,
    gstr2bEntries,
    reconciliationConfig: config,
    reconciliationRuns,
    reconciliationResults,
    discrepancies,
    followUps,
    auditLogs,
  };
}
