import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface SlideDrawerProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  widthClass?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export function SlideDrawer({
  open,
  onClose,
  title,
  subtitle,
  widthClass = 'max-w-2xl',
  footer,
  children,
}: SlideDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 transition-opacity"
      onClick={onClose}
    >
      <div
        className={`flex h-full w-full ${widthClass} flex-col border-l border-slate-200 bg-white shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <div className="font-display text-base font-semibold text-[#0F172A]">{title}</div>
            {subtitle && <div className="mt-1 text-xs text-slate-500">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>

        {footer && (
          <div className="border-t border-slate-200 bg-slate-50/80 px-6 py-3.5">{footer}</div>
        )}
      </div>
    </div>
  );
}
