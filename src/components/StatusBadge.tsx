import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileWarning,
  Info,
  XCircle,
} from 'lucide-react';

export type BadgeTone = 'green' | 'amber' | 'red' | 'blue' | 'neutral';

const TONE_CLASSES: Record<BadgeTone, string> = {
  green: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  red: 'bg-red-50 text-red-800 border-red-200',
  blue: 'bg-blue-50 text-[#1D4ED8] border-blue-200',
  neutral: 'bg-slate-100 text-slate-700 border-slate-200',
};

export function StatusBadge({
  tone,
  label,
}: {
  tone: BadgeTone;
  label: string;
}) {
  const Icon =
    tone === 'green'
      ? CheckCircle2
      : tone === 'amber'
        ? AlertTriangle
        : tone === 'red'
          ? XCircle
          : tone === 'blue'
            ? Info
            : Clock;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${TONE_CLASSES[tone]}`}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span>{label}</span>
    </span>
  );
}

export function outcomeBadgeMeta(outcome: string): { tone: BadgeTone; label: string } {
  switch (outcome) {
    case 'MATCHED':
      return { tone: 'green', label: 'Matched' };
    case 'MISSING_IN_GSTR2B':
      return { tone: 'red', label: 'Missing in GSTR-2B' };
    case 'MISSING_IN_PURCHASE_REGISTER':
      return { tone: 'amber', label: 'Extra in GSTR-2B' };
    case 'TAX_AMOUNT_MISMATCH':
      return { tone: 'red', label: 'Tax Mismatch' };
    case 'TAXABLE_VALUE_MISMATCH':
      return { tone: 'red', label: 'Value Mismatch' };
    case 'GSTIN_MISMATCH':
      return { tone: 'red', label: 'GSTIN Mismatch' };
    case 'POSSIBLE_DUPLICATE':
      return { tone: 'amber', label: 'Possible Duplicate' };
    case 'INVOICE_NUMBER_MISMATCH':
      return { tone: 'amber', label: 'Invoice No. Mismatch' };
    case 'DATE_MISMATCH':
      return { tone: 'amber', label: 'Date Mismatch' };
    case 'NEEDS_MANUAL_REVIEW':
      return { tone: 'amber', label: 'Needs Review' };
    default:
      return { tone: 'neutral', label: outcome };
  }
}

export function invoiceStatusBadge(status: string): { tone: BadgeTone; label: string } {
  switch (status) {
    case 'APPROVED':
      return { tone: 'green', label: 'Approved' };
    case 'EXTRACTED':
      return { tone: 'blue', label: 'Extracted' };
    case 'NEEDS_REVIEW':
      return { tone: 'amber', label: 'Needs Review' };
    case 'REJECTED':
      return { tone: 'red', label: 'Rejected' };
    default:
      return { tone: 'neutral', label: 'Uploaded' };
  }
}

export function discrepancyStatusBadge(status: string): { tone: BadgeTone; label: string } {
  switch (status) {
    case 'RESOLVED':
    case 'CLOSED':
      return { tone: 'green', label: status === 'CLOSED' ? 'Closed' : 'Resolved' };
    case 'AWAITING_SUPPLIER':
      return { tone: 'amber', label: 'Awaiting Supplier' };
    case 'UNDER_REVIEW':
      return { tone: 'blue', label: 'Under Review' };
    default:
      return { tone: 'red', label: 'Open' };
  }
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white px-6 py-12 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-400">
        <FileWarning className="h-5 w-5" />
      </div>
      <h3 className="font-display text-sm font-semibold text-[#0F172A]">{title}</h3>
      <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-500">{description}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 rounded-md bg-[#0F2744] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#1D4ED8]"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
