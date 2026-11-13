export type UserRoleView = 'MSME' | 'ACCOUNTANT' | 'CA_FIRM';

export interface Workspace {
  id: string;
  name: string;
  userRoleView: UserRoleView;
  persistenceMode: 'SERVER_FILE_DEMO' | 'FIRESTORE';
  createdAt: string;
  updatedAt: string;
}

export interface BusinessClient {
  id: string;
  workspaceId: string;
  legalName: string;
  tradeName: string;
  gstin: string;
  stateCode: string;
  stateName: string;
  sector: string;
  contactEmail: string;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GSTRegistration {
  id: string;
  workspaceId: string;
  clientId: string;
  gstin: string;
  stateName: string;
  registrationType: 'REGULAR' | 'COMPOSITION';
  filingFrequency: 'MONTHLY' | 'QUARTERLY';
}

export interface ReportingPeriod {
  id: string; // e.g., '2026-10'
  label: string; // e.g., 'October 2026'
  shortLabel: string; // e.g., 'Oct 2026'
  startDate: string;
  endDate: string;
}

export interface Supplier {
  id: string;
  workspaceId: string;
  gstin: string;
  legalName: string;
  email: string;
  phone: string;
  stateName: string;
  category: string;
}

export type FieldValidationStatus = 'VALID' | 'WARNING' | 'ERROR' | 'MISSING';

export interface ExtractedField<T = string | number | null> {
  value: T;
  confidence: number; // 0..1
  evidence: string | null;
  validationStatus: FieldValidationStatus;
  validationMessage?: string;
  editedByUser?: boolean;
}

export interface InvoiceLineItem {
  description: string;
  hsnSac: string | null;
  quantity: number | null;
  unitPrice: number | null;
  taxableValue: number | null;
  taxRatePercent: number | null;
}

export type InvoiceStatus = 'UPLOADED' | 'EXTRACTED' | 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED';

export interface InvoiceExtraction {
  id: string;
  invoiceId: string;
  modelUsed: string;
  supplierName: ExtractedField<string | null>;
  supplierGstin: ExtractedField<string | null>;
  recipientName: ExtractedField<string | null>;
  recipientGstin: ExtractedField<string | null>;
  invoiceNumber: ExtractedField<string | null>;
  invoiceDate: ExtractedField<string | null>;
  placeOfSupply: ExtractedField<string | null>;
  hsnSacCodes: ExtractedField<string[]>;
  taxableValue: ExtractedField<number | null>;
  cgst: ExtractedField<number | null>;
  sgst: ExtractedField<number | null>;
  igst: ExtractedField<number | null>;
  cess: ExtractedField<number | null>;
  totalTax: ExtractedField<number | null>;
  grandTotal: ExtractedField<number | null>;
  currency: ExtractedField<string | null>;
  lineItems: InvoiceLineItem[];
  overallConfidence: number;
  reviewRequired: boolean;
  validationWarnings: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  workspaceId: string;
  clientId: string;
  periodId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileDataUrl?: string; // preview asset (data URL or generated SVG data URL for demo)
  uploadSource: 'USER_UPLOAD' | 'DEMO_SEED';
  status: InvoiceStatus;
  extractionId: string | null;
  extractionError?: string | null;
  extractedAt?: string | null;
  reviewNotes?: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImportRowError {
  rowNumber: number;
  field: string;
  message: string;
  rawValue?: string;
}

export interface PurchaseRegisterImport {
  id: string;
  workspaceId: string;
  clientId: string;
  periodId: string;
  fileName: string;
  rowCount: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  columnMapping: Record<string, string>;
  errors: ImportRowError[];
  source: 'USER_UPLOAD' | 'DEMO_SEED';
  createdAt: string;
}

export interface PurchaseRegisterEntry {
  id: string;
  workspaceId: string;
  clientId: string;
  periodId: string;
  importId: string;
  supplierGstin: string;
  supplierName: string;
  invoiceNumber: string;
  normalizedInvoiceNumber: string;
  invoiceDate: string;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  totalTax: number;
  totalInvoiceValue: number;
  sourceRowNumber: number;
  isValid: boolean;
  validationErrors: string[];
  createdAt: string;
  updatedAt: string;
}

export interface GSTR2BImport {
  id: string;
  workspaceId: string;
  clientId: string;
  periodId: string;
  fileName: string;
  rowCount: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  errors: ImportRowError[];
  source: 'USER_UPLOAD' | 'DEMO_SEED';
  createdAt: string;
}

export interface GSTR2BEntry {
  id: string;
  workspaceId: string;
  clientId: string;
  periodId: string;
  importId: string;
  supplierGstin: string;
  supplierName: string;
  documentNumber: string;
  normalizedDocumentNumber: string;
  documentDate: string;
  documentType: 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
  placeOfSupply: string;
  itcAvailabilityNote: string;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  totalTax: number;
  sourceRowNumber: number;
  isValid: boolean;
  validationErrors: string[];
  createdAt: string;
}

export type ReconciliationOutcome =
  | 'MATCHED'
  | 'MISSING_IN_GSTR2B'
  | 'MISSING_IN_PURCHASE_REGISTER'
  | 'TAXABLE_VALUE_MISMATCH'
  | 'TAX_AMOUNT_MISMATCH'
  | 'GSTIN_MISMATCH'
  | 'INVOICE_NUMBER_MISMATCH'
  | 'DATE_MISMATCH'
  | 'POSSIBLE_DUPLICATE'
  | 'EXTRA_GSTR2B_ENTRY'
  | 'NEEDS_MANUAL_REVIEW';

export type MatchMethod =
  | 'EXACT'
  | 'NORMALISED_INVOICE'
  | 'TOLERANCE_CANDIDATE'
  | 'FUZZY_CANDIDATE'
  | 'UNMATCHED'
  | 'HUMAN_CONFIRMED';

export type HumanReviewStatus =
  | 'AUTO_CONFIRMED'
  | 'PENDING_REVIEW'
  | 'HUMAN_APPROVED'
  | 'HUMAN_REJECTED';

export interface ReconciliationConfig {
  dateToleranceDays: number;
  amountToleranceRupees: number;
  enableFuzzyMatch: boolean;
  fuzzySimilarityThreshold: number; // e.g. 0.72
}

export interface FieldComparison {
  field: string;
  invoiceValue: string | number | null;
  purchaseRegisterValue: string | number | null;
  gstr2bValue: string | number | null;
  status: 'MATCH' | 'DIFF' | 'MISSING' | 'TOLERANCE_OK';
  difference?: string;
}

export interface ReconciliationResult {
  id: string;
  runId: string;
  workspaceId: string;
  clientId: string;
  periodId: string;
  invoiceId: string | null;
  purchaseEntryId: string | null;
  gstr2bEntryId: string | null;
  invoiceNumber: string;
  supplierName: string;
  supplierGstin: string;
  invoiceDate: string;
  prTaxableValue: number;
  prTotalTax: number;
  gstr2bTaxableValue: number;
  gstr2bTotalTax: number;
  valueDifference: number;
  taxDifference: number;
  outcome: ReconciliationOutcome;
  discrepancyCategory: ReconciliationOutcome | null;
  matchMethod: MatchMethod;
  matchConfidence: number;
  humanReviewStatus: HumanReviewStatus;
  fieldsCompared: FieldComparison[];
  evidence: string[];
  explanation: string;
  suggestedNextStep: string;
  discrepancyId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReconciliationRunSummary {
  totalProcessed: number;
  matchedCount: number;
  unmatchedCount: number;
  discrepancyCount: number;
  needsReviewCount: number;
  totalPrTaxableValue: number;
  totalPrTax: number;
  totalGstr2bTax: number;
  potentiallyAffectedTax: number;
}

export interface ReconciliationRun {
  id: string;
  workspaceId: string;
  clientId: string;
  periodId: string;
  config: ReconciliationConfig;
  summary: ReconciliationRunSummary;
  createdAt: string;
}

export type DiscrepancySeverity = 'HIGH' | 'MEDIUM' | 'LOW';
export type DiscrepancyStatus = 'OPEN' | 'UNDER_REVIEW' | 'AWAITING_SUPPLIER' | 'RESOLVED' | 'CLOSED';

export interface AIInvestigationReport {
  whatHappened: string;
  evidencePoints: string[];
  confirmedFacts: string[];
  possibleCauses: string[];
  recommendedNextAction: string[];
  professionalReviewNote: string;
  modelUsed: string;
  generatedAt: string;
}

export interface Discrepancy {
  id: string;
  workspaceId: string;
  clientId: string;
  periodId: string;
  firstDetectedPeriodId: string;
  lastReviewedPeriodId: string;
  carriedForwardFromPeriodId: string | null;
  reconciliationResultId: string;
  invoiceNumber: string;
  supplierName: string;
  supplierGstin: string;
  category: ReconciliationOutcome;
  severity: DiscrepancySeverity;
  amountUnderInvestigation: number;
  potentiallyAffectedTax: number;
  status: DiscrepancyStatus;
  needsCaReview: boolean;
  evidenceSummary: string;
  aiInvestigation: AIInvestigationReport | null;
  resolutionNotes: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FollowUpStatus =
  | 'DRAFT'
  | 'APPROVED'
  | 'SENT_MANUALLY'
  | 'AWAITING_RESPONSE'
  | 'RESOLVED'
  | 'CLOSED';

export interface SupplierFollowUp {
  id: string;
  workspaceId: string;
  clientId: string;
  periodId: string;
  discrepancyId: string;
  invoiceNumber: string;
  supplierName: string;
  supplierGstin: string;
  supplierEmail: string;
  channel: 'EMAIL' | 'WHATSAPP';
  subject: string;
  emailBody: string;
  whatsappBody: string;
  status: FollowUpStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  responseNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  workspaceId: string;
  clientId: string;
  periodId: string;
  actor: string;
  action: string;
  entityType: 'INVOICE' | 'PURCHASE_REGISTER' | 'GSTR2B' | 'RECONCILIATION' | 'DISCREPANCY' | 'FOLLOW_UP' | 'WORKSPACE' | 'REPORT';
  entityId: string;
  summary: string;
  affectedRecord?: string;
  previousState?: string;
  updatedState?: string;
  approvalStatus?: 'APPROVED' | 'PENDING_REVIEW' | 'REJECTED' | 'AUTO_LOGGED';
  createdAt: string;
}

export interface PendingReviewQueueItem {
  id: string;
  kind: 'INVOICE_EXTRACTION' | 'FUZZY_MATCH' | 'DISCREPANCY';
  title: string;
  subtitle: string;
  amount: number | null;
  statusLabel: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  route: string;
}

export interface LatestDocumentImportItem {
  id: string;
  kind: 'INVOICE' | 'PURCHASE_REGISTER' | 'GSTR2B';
  fileName: string;
  recordCountLabel: string;
  statusLabel: string;
  tone: 'green' | 'amber' | 'red' | 'blue' | 'neutral';
  createdAt: string;
  route: string;
}

export interface TaxComponentSummary {
  taxablePr: number;
  taxable2b: number;
  cgstPr: number;
  cgst2b: number;
  sgstPr: number;
  sgst2b: number;
  igstPr: number;
  igst2b: number;
  cessPr: number;
  cess2b: number;
  totalTaxPr: number;
  totalTax2b: number;
}

export interface GlobalSearchResult {
  id: string;
  kind: 'INVOICE' | 'RECONCILIATION' | 'DISCREPANCY' | 'SUPPLIER';
  title: string;
  subtitle: string;
  meta: string;
  route: string;
}

export interface DashboardPayload {
  workspace: Workspace;
  client: BusinessClient;
  clients: BusinessClient[];
  period: ReportingPeriod;
  periods: ReportingPeriod[];
  kpis: {
    totalInvoicesProcessed: number;
    approvedInvoices: number;
    invoicesNeedingReview: number;
    totalPurchaseRegisterEntries: number;
    totalGstr2bEntries: number;
    matchedInvoices: number;
    unmatchedInvoices: number;
    discrepanciesRequiringReview: number;
    openDiscrepancies: number;
    resolvedDiscrepancies: number;
    potentialItcUnderInvestigation: number;
    reconciliationCompletionPercent: number;
  };
  monthlyTrend: Array<{
    periodId: string;
    periodLabel: string;
    matched: number;
    unmatched: number;
    completionPercent: number;
    openDiscrepancies: number;
    potentiallyAffectedTax: number;
  }>;
  categoryBreakdown: Array<{
    category: string;
    label: string;
    count: number;
    taxAmount: number;
  }>;
  supplierOutstanding: Array<{
    supplierGstin: string;
    supplierName: string;
    openCount: number;
    recurringPeriods: number;
    taxUnderInvestigation: number;
  }>;
  pendingReviewQueue: PendingReviewQueueItem[];
  latestDocumentImports: LatestDocumentImportItem[];
  taxComponentSummary: TaxComponentSummary;
  recentActivity: AuditLog[];
  latestRun: ReconciliationRun | null;
}
