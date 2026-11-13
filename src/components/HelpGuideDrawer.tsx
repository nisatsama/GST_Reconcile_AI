import { useNavigate } from 'react-router-dom';
import { ArrowRight, BookOpen, CheckCircle2, ShieldAlert, Sparkles } from 'lucide-react';
import { SlideDrawer } from './SlideDrawer';

const WORKFLOW_STEPS = [
  {
    step: '01',
    title: 'Upload Source Documents',
    detail: 'Ingest supplier tax invoices (PDF, PNG, JPG), Purchase Register CSV/XLSX, and exported GSTR-2B statements.',
    route: '/documents',
  },
  {
    step: '02',
    title: 'Extract & Review Fields',
    detail: 'Server-side Gemini parses invoice fields with source evidence while preserving missing fields as null for CA review.',
    route: '/documents?tab=invoices',
  },
  {
    step: '03',
    title: 'Run Deterministic 3-Way Match',
    detail: 'Compare approved invoices, Purchase Register, and GSTR-2B via exact, normalised, tolerance, and fuzzy candidate rules.',
    route: '/reconciliation',
  },
  {
    step: '04',
    title: 'Investigate Exceptions & Follow Up',
    detail: 'Inspect field deltas, generate evidence-grounded explanations, and draft human-approved Email/WhatsApp follow-ups.',
    route: '/discrepancies',
  },
  {
    step: '05',
    title: 'Export Audit-Ready Schedules',
    detail: 'Review full audit logs and download PDF, Excel (.xlsx), and CSV compliance schedules.',
    route: '/reports',
  },
];

export function HelpGuideDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();

  return (
    <SlideDrawer
      open={open}
      onClose={onClose}
      widthClass="max-w-lg"
      title="GST Reconcile AI — Operations & Compliance Guide"
      subtitle="Workflow reference, matching rules, and human-in-the-loop governance"
    >
      <div className="space-y-6 text-xs">
        <div className="rounded-md border border-slate-200 bg-slate-50 p-4 space-y-2">
          <div className="flex items-center gap-2 font-semibold text-[#0F172A]">
            <ShieldAlert className="h-4 w-4 text-amber-700 shrink-0" />
            <span>Compliance & AI Governance Boundary</span>
          </div>
          <p className="text-slate-600 leading-relaxed">
            All numerical GST comparisons, tolerances, and discrepancy classifications are computed by a deterministic rule engine. AI models are restricted to multimodal document extraction, evidence-grounded discrepancy explanations, and drafting supplier follow-up text—never final ITC eligibility decisions.
          </p>
        </div>

        <div>
          <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <BookOpen className="h-3.5 w-3.5" />
            <span>End-to-End Operations Workflow</span>
          </h3>
          <div className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
            {WORKFLOW_STEPS.map((item) => (
              <div key={item.step} className="flex items-start justify-between gap-3 p-3.5">
                <div className="flex items-start gap-3">
                  <span className="font-mono text-xs font-bold text-[#1D4ED8]">{item.step}</span>
                  <div>
                    <div className="font-semibold text-[#0F172A]">{item.title}</div>
                    <p className="mt-0.5 text-slate-600 leading-relaxed">{item.detail}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    navigate(item.route);
                  }}
                  className="shrink-0 rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-[#0F2744] hover:bg-slate-50"
                >
                  Open
                </button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Deterministic Matching Hierarchy
          </h3>
          <ul className="space-y-2 rounded-md border border-slate-200 bg-white p-3.5 text-slate-700">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />
              <span><strong>Level 1 (Exact):</strong> Supplier GSTIN + exact invoice number + date & amount alignment.</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />
              <span><strong>Level 2 (Normalised):</strong> Strips punctuation, slashes, spaces, and leading zeros in invoice numbers.</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#0F766E]" />
              <span><strong>Level 3 (Tolerance):</strong> Evaluates configurable ₹ rounding and ± date tolerances.</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
              <span><strong>Level 4 (Fuzzy Candidate):</strong> Flags near-matches for explicit human confirmation—never auto-confirmed.</span>
            </li>
          </ul>
        </div>

        <div className="rounded-md border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-1.5 font-semibold text-[#0F172A]">
                <Sparkles className="h-3.5 w-3.5 text-[#1D4ED8]" />
                <span>Natural-Language Ledger Query</span>
              </div>
              <p className="mt-0.5 text-slate-500">
                Query reconciled records and discrepancies in read-only mode scoped to the active client & period.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                navigate('/assistant');
              }}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-[#0F2744] hover:bg-slate-50"
            >
              <span>Open Query Tool</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </SlideDrawer>
  );
}
