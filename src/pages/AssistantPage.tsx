import React, { useState } from 'react';
import { Bot, Send, ShieldAlert } from 'lucide-react';
import { api } from '../api/client';
import { useWorkspace } from '../context/WorkspaceContext';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  citedInvoices?: string[];
  disclaimer?: string;
  error?: boolean;
}

const SAMPLE_QUESTIONS = [
  'Which suppliers have the most unresolved discrepancies?',
  'Show invoices missing from the uploaded GSTR-2B data.',
  'Explain why invoice ABC/091 was flagged.',
  'What is the total tax amount associated with unresolved mismatches?',
  "Summarise this month's reconciliation.",
  'Which discrepancies require manual review?',
];

export function AssistantPage() {
  const { selectedClientId, selectedPeriodId, selectedClient, selectedPeriod } = useWorkspace();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const sendQuestion = async (questionText: string) => {
    const trimmed = questionText.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = {
      id: `u_${Date.now()}`,
      role: 'user',
      text: trimmed,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await api.askAssistant(selectedClientId, selectedPeriodId, trimmed);
      setMessages((prev) => [
        ...prev,
        {
          id: `a_${Date.now()}`,
          role: 'assistant',
          text: res.answer,
          citedInvoices: res.citedInvoices,
          disclaimer: res.disclaimer,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `e_${Date.now()}`,
          role: 'assistant',
          text: err instanceof Error ? err.message : 'Unable to process query request.',
          error: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendQuestion(input);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight text-[#0F172A]">
              Natural-Language Reconciliation Query
            </h1>
            <p className="mt-0.5 text-xs text-slate-500">
              Scoped strictly to <strong className="text-[#0F172A]">{selectedClient?.tradeName}</strong> (
              <span className="font-mono">{selectedClient?.gstin}</span>) ·{' '}
              <strong className="text-[#0F172A]">{selectedPeriod?.label}</strong>. Answers are retrieved from verified workspace records.
            </p>
          </div>
          <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
            <ShieldAlert className="h-3.5 w-3.5 text-[#0F2744]" />
            <span>Read-only workspace intelligence</span>
          </div>
        </div>
      </div>

      {/* Quick Prompts */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Suggested Workspace Queries
        </div>
        <div className="flex flex-wrap gap-2">
          {SAMPLE_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              disabled={loading}
              onClick={() => void sendQuestion(q)}
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-[#0F2744] hover:border-[#1D4ED8] hover:bg-blue-50/40 disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Query Viewport */}
      <div className="flex h-[480px] flex-col rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-xs text-slate-500">
              <Bot className="mb-3 h-9 w-9 text-[#0F2744]" />
              <div className="font-display text-sm font-semibold text-[#0F172A]">
                Query verified records for {selectedClient?.tradeName} ({selectedPeriod?.shortLabel})
              </div>
              <p className="mt-1 max-w-md text-xs leading-relaxed">
                Queries inspect your actual Purchase Register, GSTR-2B imports, deterministic reconciliation outcomes, and exceptions. Records are never invented and legal ITC determinations are never issued automatically.
              </p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-2xl rounded-lg px-4 py-3 text-xs ${
                    msg.role === 'user'
                      ? 'bg-[#0F2744] text-white'
                      : msg.error
                        ? 'border border-red-200 bg-red-50 text-red-700'
                        : 'border border-slate-200 bg-slate-50 text-[#0F172A]'
                  }`}
                >
                  <div className="whitespace-pre-wrap leading-relaxed">{msg.text}</div>
                  {msg.citedInvoices && msg.citedInvoices.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-slate-200 pt-2 text-[11px] text-slate-500">
                      <span>Referenced Invoices:</span>
                      {msg.citedInvoices.map((inv) => (
                        <span
                          key={inv}
                          className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[#0F2744]"
                        >
                          {inv}
                        </span>
                      ))}
                    </div>
                  )}
                  {msg.disclaimer && (
                    <div className="mt-2 text-[11px] text-slate-500">{msg.disclaimer}</div>
                  )}
                </div>
              </div>
            ))
          )}
          {loading && (
            <div className="text-xs text-slate-500">
              Retrieving workspace records and summarizing evidence...
            </div>
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 border-t border-slate-200 p-3.5"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask about ${selectedClient?.tradeName} (${selectedPeriod?.shortLabel}) discrepancies, suppliers, or totals...`}
            className="flex-1 rounded-md border border-slate-200 px-3 py-2 text-xs text-[#0F172A] focus:border-[#1D4ED8] focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#0F2744] px-4 py-2 text-xs font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            <span>Query</span>
          </button>
        </form>
      </div>
    </div>
  );
}
