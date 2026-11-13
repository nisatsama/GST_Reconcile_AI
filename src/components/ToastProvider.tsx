import React, { createContext, useCallback, useContext, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastContextValue {
  pushToast: (toast: Omit<ToastItem, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (toast: Omit<ToastItem, 'id'>) => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
      setTimeout(() => {
        dismiss(id);
      }, 4800);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ pushToast }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0"
      >
        {toasts.map((t) => {
          const Icon =
            t.tone === 'success'
              ? CheckCircle2
              : t.tone === 'error'
                ? XCircle
                : t.tone === 'warning'
                  ? AlertTriangle
                  : Info;

          const iconColor =
            t.tone === 'success'
              ? 'text-emerald-700'
              : t.tone === 'error'
                ? 'text-red-700'
                : t.tone === 'warning'
                  ? 'text-amber-700'
                  : 'text-[#1D4ED8]';

          return (
            <div
              key={t.id}
              role="status"
              className="pointer-events-auto flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3.5 shadow-lg transition-all duration-150"
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconColor}`} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-[#0F172A]">{t.title}</div>
                {t.description && (
                  <div className="mt-0.5 text-xs text-slate-600 leading-relaxed">
                    {t.description}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
