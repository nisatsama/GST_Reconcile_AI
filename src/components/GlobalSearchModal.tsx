import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  FileText,
  GitCompare,
  Loader2,
  Search,
  Users,
  X,
} from 'lucide-react';
import { api } from '../api/client';
import { useWorkspace } from '../context/WorkspaceContext';
import type { GlobalSearchResult } from '../shared/types';

interface GlobalSearchModalProps {
  open: boolean;
  onClose: () => void;
}

export function GlobalSearchModal({ open, onClose }: GlobalSearchModalProps) {
  const { selectedClientId, selectedPeriodId, selectedClient, selectedPeriod } = useWorkspace();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.globalSearch(selectedClientId, selectedPeriodId, trimmed);
        setResults(res.results);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [query, open, selectedClientId, selectedPeriodId]);

  if (!open) return null;

  const iconForKind = (kind: GlobalSearchResult['kind']) => {
    switch (kind) {
      case 'INVOICE':
        return FileText;
      case 'DISCREPANCY':
        return AlertTriangle;
      case 'SUPPLIER':
        return Users;
      default:
        return GitCompare;
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Global workspace search"
      className="fixed inset-0 z-[60] flex items-start justify-center bg-slate-900/45 px-4 pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <Search className="h-4 w-4 text-slate-400 shrink-0" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search invoices, GSTINs, exceptions, suppliers in ${selectedClient?.tradeName ?? 'workspace'}...`}
            className="flex-1 bg-transparent text-sm text-[#0F172A] placeholder:text-slate-400 focus:outline-none"
          />
          {searching && <Loader2 className="h-4 w-4 animate-spin text-[#1D4ED8]" />}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[380px] overflow-y-auto divide-y divide-slate-100">
          {!query.trim() ? (
            <div className="px-4 py-8 text-center text-xs text-slate-500">
              Type an invoice number, supplier legal name, GSTIN, or exception category for{' '}
              <span className="font-medium text-slate-700">{selectedPeriod?.label}</span>.
            </div>
          ) : results.length === 0 && !searching ? (
            <div className="px-4 py-8 text-center text-xs text-slate-500">
              No matching records found for &ldquo;{query}&rdquo;.
            </div>
          ) : (
            results.map((item) => {
              const Icon = iconForKind(item.kind);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onClose();
                    navigate(item.route);
                  }}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-[#0F2744]">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-semibold text-[#0F2744] truncate">
                        {item.title}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-600 truncate">{item.subtitle}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-[11px] text-slate-500">
                    <span>{item.meta}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-2 text-[11px] text-slate-500">
          <span>Scoped to {selectedClient?.gstin} · {selectedPeriod?.shortLabel}</span>
          <span className="font-mono">ESC to close</span>
        </div>
      </div>
    </div>
  );
}
