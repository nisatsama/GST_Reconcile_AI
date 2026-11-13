import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileSpreadsheet, FileText, Table2 } from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { Gstr2bPage } from './Gstr2bPage';
import { InvoicesPage } from './InvoicesPage';
import { PurchaseRegisterPage } from './PurchaseRegisterPage';

export type DocumentTab = 'invoices' | 'purchase-register' | 'gstr-2b';

export function DocumentsPage({ initialTab = 'invoices' }: { initialTab?: DocumentTab }) {
  const { selectedClient, selectedPeriod, dashboard } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const paramTab = searchParams.get('tab') as DocumentTab | null;

  const [activeTab, setActiveTab] = useState<DocumentTab>(paramTab || initialTab);

  useEffect(() => {
    if (paramTab && (paramTab === 'invoices' || paramTab === 'purchase-register' || paramTab === 'gstr-2b')) {
      setActiveTab(paramTab);
    } else {
      setActiveTab(initialTab);
    }
  }, [paramTab, initialTab]);

  const selectTab = (tab: DocumentTab) => {
    setActiveTab(tab);
    setSearchParams({ tab }, { replace: true });
  };

  return (
    <div className="space-y-5">
      {/* Unified Document Centre Header & Selector Tabs */}
      <div className="flex flex-col justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] lg:flex-row lg:items-center">
        <div>
          <h1 className="font-display text-xl font-bold text-[#0F172A]">
            Document Management & Ingestion
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">
            Upload invoices (PDF/Image), Purchase Registers, and GSTR-2B statements for{' '}
            {selectedClient?.tradeName} · {selectedPeriod?.label}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-md bg-slate-100 p-1 text-xs shrink-0">
          <button
            type="button"
            onClick={() => selectTab('invoices')}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 font-medium transition-colors ${
              activeTab === 'invoices'
                ? 'bg-white text-[#0F172A] shadow-sm'
                : 'text-slate-600 hover:text-[#0F172A]'
            }`}
          >
            <FileText className="h-3.5 w-3.5 text-[#0F766E]" />
            <span>
              Supplier Invoices ({dashboard?.kpis.totalInvoicesProcessed ?? 0})
            </span>
          </button>
          <button
            type="button"
            onClick={() => selectTab('purchase-register')}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 font-medium transition-colors ${
              activeTab === 'purchase-register'
                ? 'bg-white text-[#0F172A] shadow-sm'
                : 'text-slate-600 hover:text-[#0F172A]'
            }`}
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-[#1D4ED8]" />
            <span>
              Purchase Register ({dashboard?.kpis.totalPurchaseRegisterEntries ?? 0})
            </span>
          </button>
          <button
            type="button"
            onClick={() => selectTab('gstr-2b')}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 font-medium transition-colors ${
              activeTab === 'gstr-2b'
                ? 'bg-white text-[#0F172A] shadow-sm'
                : 'text-slate-600 hover:text-[#0F172A]'
            }`}
          >
            <Table2 className="h-3.5 w-3.5 text-[#0F2744]" />
            <span>GSTR-2B ({dashboard?.kpis.totalGstr2bEntries ?? 0})</span>
          </button>
        </div>
      </div>

      {activeTab === 'invoices' ? (
        <InvoicesPage embedded />
      ) : activeTab === 'purchase-register' ? (
        <PurchaseRegisterPage embedded />
      ) : (
        <Gstr2bPage embedded />
      )}
    </div>
  );
}
