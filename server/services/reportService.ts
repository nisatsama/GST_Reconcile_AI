import Papa from 'papaparse';
import type {
  AuditLog,
  BusinessClient,
  Discrepancy,
  ReconciliationResult,
  ReconciliationRun,
  ReportingPeriod,
} from '../../src/shared/types.ts';

export type ReportType =
  | 'MONTHLY_SUMMARY'
  | 'MATCHED_INVOICES'
  | 'UNMATCHED_INVOICES'
  | 'DISCREPANCY_REPORT'
  | 'SUPPLIER_PENDING'
  | 'POTENTIAL_TAX_IMPACT'
  | 'AUDIT_TRAIL';

export interface GeneratedReport {
  reportType: ReportType;
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
}

export function buildReport(params: {
  reportType: ReportType;
  client: BusinessClient;
  period: ReportingPeriod;
  latestRun: ReconciliationRun | null;
  results: ReconciliationResult[];
  discrepancies: Discrepancy[];
  auditLogs: AuditLog[];
}): GeneratedReport {
  const { reportType, client, period, latestRun, results, discrepancies, auditLogs } = params;
  const generatedAt = new Date().toISOString();
  const disclaimer =
    'Generated strictly from user-uploaded and workspace records. Not an official GSTN filing or legal ITC eligibility determination.';

  const matched = results.filter((r) => r.outcome === 'MATCHED');
  const unmatched = results.filter((r) => r.outcome !== 'MATCHED');
  const openDiscs = discrepancies.filter((d) => d.status !== 'RESOLVED' && d.status !== 'CLOSED');
  const openPotentiallyAffectedTax = openDiscs.reduce(
    (sum, d) => sum + d.potentiallyAffectedTax,
    0
  );

  const summaryMetrics = [
    { label: 'Total Records Evaluated', value: String(results.length) },
    { label: 'Matched Records', value: String(matched.length) },
    { label: 'Unmatched / Mismatched', value: String(unmatched.length) },
    {
      label: 'Potentially Affected Tax (Open)',
      value: `INR ${(discrepancies.length > 0 || latestRun ? openPotentiallyAffectedTax : 0).toLocaleString('en-IN')}`,
    },
  ];

  let title = 'Monthly Reconciliation Summary';
  let columns: string[] = [];
  let rows: Array<Record<string, string | number>> = [];

  if (reportType === 'MONTHLY_SUMMARY') {
    title = 'Monthly Reconciliation Summary Report';
    columns = ['Invoice No', 'Supplier Name', 'Supplier GSTIN', 'Date', 'PR Taxable (INR)', 'PR Tax (INR)', 'GSTR-2B Tax (INR)', 'Tax Diff (INR)', 'Outcome', 'Match Method'];
    rows = results.map((r) => ({
      'Invoice No': r.invoiceNumber,
      'Supplier Name': r.supplierName,
      'Supplier GSTIN': r.supplierGstin,
      Date: r.invoiceDate,
      'PR Taxable (INR)': r.prTaxableValue,
      'PR Tax (INR)': r.prTotalTax,
      'GSTR-2B Tax (INR)': r.gstr2bTotalTax,
      'Tax Diff (INR)': r.taxDifference,
      Outcome: r.outcome,
      'Match Method': r.matchMethod,
    }));
  } else if (reportType === 'MATCHED_INVOICES') {
    title = 'Matched Invoices Report';
    columns = ['Invoice No', 'Supplier Name', 'Supplier GSTIN', 'Date', 'Taxable Value (INR)', 'Total Tax (INR)', 'Match Method', 'Review Status'];
    rows = matched.map((r) => ({
      'Invoice No': r.invoiceNumber,
      'Supplier Name': r.supplierName,
      'Supplier GSTIN': r.supplierGstin,
      Date: r.invoiceDate,
      'Taxable Value (INR)': r.prTaxableValue,
      'Total Tax (INR)': r.prTotalTax,
      'Match Method': r.matchMethod,
      'Review Status': r.humanReviewStatus,
    }));
  } else if (reportType === 'UNMATCHED_INVOICES') {
    title = 'Unmatched & Mismatched Invoices Report';
    columns = ['Invoice No', 'Supplier Name', 'Supplier GSTIN', 'Outcome', 'PR Tax (INR)', 'GSTR-2B Tax (INR)', 'Tax Diff (INR)', 'Reason'];
    rows = unmatched.map((r) => ({
      'Invoice No': r.invoiceNumber,
      'Supplier Name': r.supplierName,
      'Supplier GSTIN': r.supplierGstin,
      Outcome: r.outcome,
      'PR Tax (INR)': r.prTotalTax,
      'GSTR-2B Tax (INR)': r.gstr2bTotalTax,
      'Tax Diff (INR)': r.taxDifference,
      Reason: r.explanation,
    }));
  } else if (reportType === 'DISCREPANCY_REPORT') {
    title = 'Detailed Discrepancy Investigation Report';
    columns = ['Discrepancy ID', 'Invoice No', 'Supplier', 'GSTIN', 'Category', 'Severity', 'Status', 'Tax Under Investigation (INR)', 'Evidence Summary'];
    rows = discrepancies.map((d) => ({
      'Discrepancy ID': d.id,
      'Invoice No': d.invoiceNumber,
      Supplier: d.supplierName,
      GSTIN: d.supplierGstin,
      Category: d.category,
      Severity: d.severity,
      Status: d.status,
      'Tax Under Investigation (INR)': d.potentiallyAffectedTax,
      'Evidence Summary': d.evidenceSummary,
    }));
  } else if (reportType === 'SUPPLIER_PENDING') {
    title = 'Supplier-Wise Pending Issues Report';
    const bySupplier = new Map<string, { name: string; gstin: string; openCount: number; tax: number; invoices: string[] }>();
    for (const d of openDiscs) {
      const existing = bySupplier.get(d.supplierGstin) ?? {
        name: d.supplierName,
        gstin: d.supplierGstin,
        openCount: 0,
        tax: 0,
        invoices: [],
      };
      existing.openCount += 1;
      existing.tax += d.potentiallyAffectedTax;
      existing.invoices.push(d.invoiceNumber);
      bySupplier.set(d.supplierGstin, existing);
    }
    columns = ['Supplier Name', 'Supplier GSTIN', 'Open Issues', 'Potentially Affected Tax (INR)', 'Affected Invoices'];
    rows = Array.from(bySupplier.values()).map((s) => ({
      'Supplier Name': s.name,
      'Supplier GSTIN': s.gstin,
      'Open Issues': s.openCount,
      'Potentially Affected Tax (INR)': s.tax,
      'Affected Invoices': s.invoices.join(', '),
    }));
  } else if (reportType === 'POTENTIAL_TAX_IMPACT') {
    title = 'Potentially Affected Tax Amount Report (Needs CA Review)';
    columns = ['Invoice No', 'Supplier', 'Category', 'Amount Under Investigation (INR)', 'Potentially Affected Tax (INR)', 'Needs CA Review', 'Status'];
    rows = discrepancies.map((d) => ({
      'Invoice No': d.invoiceNumber,
      Supplier: d.supplierName,
      Category: d.category,
      'Amount Under Investigation (INR)': d.amountUnderInvestigation,
      'Potentially Affected Tax (INR)': d.potentiallyAffectedTax,
      'Needs CA Review': d.needsCaReview ? 'Yes' : 'Verify',
      Status: d.status,
    }));
  } else {
    title = 'Compliance Audit Trail Report';
    columns = ['Timestamp', 'Actor', 'Action', 'Entity Type', 'Entity ID', 'Summary'];
    rows = auditLogs.map((l) => ({
      Timestamp: l.createdAt,
      Actor: l.actor,
      Action: l.action,
      'Entity Type': l.entityType,
      'Entity ID': l.entityId,
      Summary: l.summary,
    }));
  }

  const headerLines = [
    `Report: ${title}`,
    `Business: ${client.tradeName} | GSTIN: ${client.gstin} | Period: ${period.label}`,
    `Generated: ${generatedAt}`,
    `Notice: ${disclaimer}`,
    '',
  ].join('\n');

  const csvBody = rows.length > 0 ? Papa.unparse(rows, { columns }) : columns.join(',');
  const csvContent = `${headerLines}${csvBody}`;

  return {
    reportType,
    title,
    businessName: client.tradeName,
    gstin: client.gstin,
    periodLabel: period.label,
    generatedAt,
    disclaimer,
    summaryMetrics,
    columns,
    rows,
    csvContent,
  };
}
