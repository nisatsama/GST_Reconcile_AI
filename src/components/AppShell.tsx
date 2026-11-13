import React, { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  GitCompare,
  HelpCircle,
  History,
  LayoutDashboard,
  Menu,
  RotateCcw,
  Search,
  Settings,
  Users,
  X,
} from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import type { UserRoleView } from '../shared/types';
import { formatINR } from '../shared/validation';
import { ConfirmDialog } from './ConfirmDialog';
import { GlobalSearchModal } from './GlobalSearchModal';
import { HelpGuideDrawer } from './HelpGuideDrawer';
import { useToast } from './ToastProvider';

const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/reconciliation', label: 'Reconciliation', icon: GitCompare },
  {
    to: '/documents',
    label: 'Documents',
    icon: FolderOpen,
    matchPrefixes: ['/documents', '/invoices', '/purchase-register', '/gstr-2b'],
  },
  { to: '/discrepancies', label: 'Exceptions', icon: AlertTriangle },
  { to: '/suppliers', label: 'Supplier Management', icon: Users },
  { to: '/reports', label: 'Reports & Analytics', icon: BarChart3 },
  { to: '/audit-trail', label: 'Audit Trail', icon: History },
  { to: '/settings', label: 'Settings', icon: Settings },
];

const ROLE_LABELS: Record<UserRoleView, string> = {
  CA_FIRM: 'CA Firm Partner',
  ACCOUNTANT: 'Senior Accountant',
  MSME: 'MSME Finance Lead',
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const {
    workspace,
    clients,
    periods,
    selectedClientId,
    selectedPeriodId,
    selectedClient,
    dashboard,
    setSelectedClientId,
    setSelectedPeriodId,
    setUserRoleView,
    resetDemo,
    loading,
  } = useWorkspace();

  const { pushToast } = useToast();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [financialYear, setFinancialYear] = useState('FY 2026-27');

  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const currentNav =
    NAV_ITEMS.find((n) => {
      if (n.to === '/') return location.pathname === '/';
      if (n.matchPrefixes) {
        return n.matchPrefixes.some((p) => location.pathname.startsWith(p));
      }
      return location.pathname.startsWith(n.to);
    }) ??
    (location.pathname.startsWith('/assistant')
      ? { to: '/assistant', label: 'Natural-Language Query' }
      : NAV_ITEMS[0]);

  const pendingReviewCount =
    (dashboard?.kpis.discrepanciesRequiringReview ?? 0) +
    (dashboard?.kpis.invoicesNeedingReview ?? 0);

  const handleConfirmReset = async () => {
    setResetting(true);
    try {
      await resetDemo();
      setResetConfirmOpen(false);
      setProfileOpen(false);
      pushToast({
        tone: 'success',
        title: 'Demo dataset restored',
        description: 'All seeded invoices, registers, GSTR-2B rows, and audit logs are reset.',
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Reset failed',
        description: err instanceof Error ? err.message : 'Unable to reset workspace.',
      });
    } finally {
      setResetting(false);
    }
  };

  const isNavItemActive = (item: (typeof NAV_ITEMS)[number]) => {
    if (item.to === '/') return location.pathname === '/';
    if (item.matchPrefixes) {
      return item.matchPrefixes.some((p) => location.pathname.startsWith(p));
    }
    return location.pathname.startsWith(item.to);
  };

  return (
    <div className="flex min-h-screen bg-[#F8FAFC] text-[#0F172A]">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/45 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Left Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-slate-800/80 bg-[#0F2744] text-white transition-all duration-150 lg:static ${
          collapsed ? 'w-[68px]' : 'w-[248px]'
        } ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        {/* 1. Product Logo & Name */}
        <div className="flex h-14 items-center justify-between border-b border-white/10 px-3.5">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex min-w-0 items-center gap-2.5 text-left"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#1D4ED8] text-white">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" />
                <path d="m9 14 2 2 4-4" />
              </svg>
            </span>
            {!collapsed && (
              <div className="min-w-0">
                <div className="font-display text-sm font-bold tracking-tight text-white truncate">
                  GST Reconcile AI
                </div>
                <div className="text-[11px] text-slate-300 truncate">
                  Compliance Operations
                </div>
              </div>
            )}
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden h-7 w-7 items-center justify-center rounded text-slate-300 hover:bg-white/10 hover:text-white lg:flex"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
            className="flex h-7 w-7 items-center justify-center rounded text-slate-300 hover:bg-white/10 lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Primary 8 Navigation Items */}
        <nav aria-label="Primary navigation" className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isNavItemActive(item);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-white/15 text-white'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
                title={collapsed ? item.label : undefined}
              >
                <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-[#5EEAD4]' : 'text-slate-300'}`} />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>

        {/* Bottom Organisation Switcher + GSTIN Context + User Profile */}
        <div className="border-t border-white/10 p-2.5 space-y-2.5">
          {!collapsed ? (
            <>
              {/* Organisation Switcher & GSTIN Context */}
              <div className="rounded-md border border-white/10 bg-white/5 p-2.5 space-y-1.5">
                <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-slate-400">
                  <span>Organisation</span>
                  <span className="text-amber-300">Demo Data</span>
                </div>
                <div className="relative">
                  <select
                    aria-label="Switch organisation"
                    value={selectedClientId}
                    onChange={(e) => setSelectedClientId(e.target.value)}
                    className="w-full appearance-none rounded border border-white/15 bg-[#0A1C33] py-1.5 pl-2.5 pr-7 text-xs font-medium text-white focus:border-[#5EEAD4] focus:outline-none"
                  >
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.tradeName}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-2 h-3.5 w-3.5 text-slate-400" />
                </div>
                {selectedClient && (
                  <div className="flex items-center justify-between pt-0.5 text-[11px] text-slate-300">
                    <span className="font-mono text-slate-200">{selectedClient.gstin}</span>
                    <span className="truncate pl-2 text-slate-400">{selectedClient.stateCode}</span>
                  </div>
                )}
              </div>

              {/* User Profile & Account Settings */}
              <div className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-white/10">
                <button
                  type="button"
                  onClick={() => navigate('/settings')}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#0F766E] text-xs font-semibold text-white">
                    RM
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-white">Rajesh Mehta</div>
                    <div className="truncate text-[11px] text-slate-400">
                      {ROLE_LABELS[workspace?.userRoleView ?? 'CA_FIRM']}
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/settings')}
                  aria-label="Account and workspace settings"
                  className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
                >
                  <Settings className="h-3.5 w-3.5" />
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => navigate('/settings')}
              title={`${selectedClient?.tradeName ?? 'Organisation'} (${selectedClient?.gstin ?? ''})`}
              className="mx-auto flex h-9 w-9 items-center justify-center rounded-md bg-white/10 text-xs font-semibold text-white hover:bg-white/15"
            >
              RM
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Consistent Enterprise Top Navigation */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>

            <div className="flex min-w-0 items-center gap-2 text-xs">
              <Building2 className="hidden h-4 w-4 shrink-0 text-[#0F766E] sm:block" />
              <span className="hidden font-medium text-slate-600 truncate sm:inline max-w-[200px]">
                {selectedClient?.tradeName ?? 'Workspace'}
              </span>
              <span className="hidden text-slate-300 sm:inline">/</span>
              <span className="font-display text-sm font-semibold text-[#0F172A] truncate">
                {currentNav.label}
              </span>
            </div>
          </div>

          {/* Right Top Controls: FY Selector + GST Period Selector + Global Search + Notifications + Help + Avatar */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Financial Year Selector */}
            <select
              aria-label="Select financial year"
              value={financialYear}
              onChange={(e) => setFinancialYear(e.target.value)}
              className="hidden rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs font-medium text-[#0F172A] hover:border-slate-300 focus:border-[#1D4ED8] focus:outline-none md:block"
            >
              <option value="FY 2026-27">FY 2026-27</option>
            </select>

            {/* GST Period Selector */}
            <select
              aria-label="Select GST period"
              value={selectedPeriodId}
              onChange={(e) => setSelectedPeriodId(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-[#0F172A] hover:border-slate-300 focus:border-[#1D4ED8] focus:outline-none"
            >
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>

            {/* Global Search Trigger */}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Global search"
              className="flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-slate-50/70 px-2.5 text-xs text-slate-500 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-800"
            >
              <Search className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">Search invoices, GSTIN...</span>
              <kbd className="hidden rounded border border-slate-200 bg-white px-1 font-mono text-[10px] text-slate-400 xl:inline">
                ⌘K
              </kbd>
            </button>

            {/* Notifications Popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setNotifOpen((v) => !v);
                  setProfileOpen(false);
                }}
                aria-label="Notifications"
                className="relative flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              >
                <Bell className="h-4 w-4" />
                {pendingReviewCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded bg-red-600 px-1 font-mono text-[10px] font-semibold text-white tabular-nums">
                    {pendingReviewCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 rounded-lg border border-slate-200 bg-white p-3 shadow-xl">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="text-xs font-semibold text-[#0F172A]">
                      Compliance Alerts
                    </span>
                    <button
                      type="button"
                      onClick={() => setNotifOpen(false)}
                      className="text-xs text-slate-500 hover:text-slate-800"
                    >
                      Close
                    </button>
                  </div>
                  <div className="mt-2 space-y-2 text-xs">
                    {(dashboard?.kpis.invoicesNeedingReview ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setNotifOpen(false);
                          navigate('/documents?tab=invoices');
                        }}
                        className="w-full rounded-md border border-slate-200 p-2.5 text-left hover:bg-slate-50"
                      >
                        <div className="font-medium text-amber-800">
                          {dashboard?.kpis.invoicesNeedingReview} invoice extraction(s) pending review
                        </div>
                        <div className="mt-0.5 text-slate-500">
                          Verify low-confidence fields before reconciliation.
                        </div>
                      </button>
                    )}
                    {(dashboard?.kpis.openDiscrepancies ?? 0) > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setNotifOpen(false);
                          navigate('/discrepancies');
                        }}
                        className="w-full rounded-md border border-slate-200 p-2.5 text-left hover:bg-slate-50"
                      >
                        <div className="font-medium text-red-700">
                          {dashboard?.kpis.openDiscrepancies} open exceptions ·{' '}
                          <span className="font-mono">
                            {formatINR(dashboard?.kpis.potentialItcUnderInvestigation)}
                          </span>
                        </div>
                        <div className="mt-0.5 text-slate-500">
                          Inspect evidence and draft supplier follow-ups.
                        </div>
                      </button>
                    ) : (
                      <div className="py-3 text-center text-slate-500">
                        No pending alerts for this period.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Help / Support */}
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              aria-label="Help and compliance guide"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              title="Workflow & Compliance Guide"
            >
              <HelpCircle className="h-4 w-4" />
            </button>

            {/* User Avatar & Role Popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setProfileOpen((v) => !v);
                  setNotifOpen(false);
                }}
                aria-label="User account menu"
                className="flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-[#0F172A] hover:bg-slate-50"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded bg-[#0F2744] font-mono text-[10px] font-semibold text-white">
                  RM
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
              </button>

              {profileOpen && (
                <div className="absolute right-0 mt-2 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-xl">
                  <div className="border-b border-slate-100 px-2.5 py-2">
                    <div className="text-xs font-semibold text-[#0F172A]">Rajesh Mehta</div>
                    <div className="text-[11px] text-slate-500">
                      {workspace?.name ?? 'GST Reconcile Workspace'}
                    </div>
                  </div>
                  <div className="py-1.5">
                    <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Role View
                    </div>
                    {(['CA_FIRM', 'ACCOUNTANT', 'MSME'] as UserRoleView[]).map((role) => (
                      <button
                        key={role}
                        type="button"
                        onClick={async () => {
                          await setUserRoleView(role);
                          setProfileOpen(false);
                          pushToast({
                            tone: 'info',
                            title: `Switched view to ${ROLE_LABELS[role]}`,
                          });
                        }}
                        className={`flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-xs ${
                          workspace?.userRoleView === role
                            ? 'bg-blue-50 font-semibold text-[#1D4ED8]'
                            : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <span>{ROLE_LABELS[role]}</span>
                        {workspace?.userRoleView === role && (
                          <span className="text-[10px]">Active</span>
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="border-t border-slate-100 pt-1.5 space-y-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setProfileOpen(false);
                        navigate('/settings');
                      }}
                      className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                    >
                      <Settings className="h-3.5 w-3.5 text-slate-400" />
                      <span>Workspace Settings</span>
                    </button>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => {
                        setProfileOpen(false);
                        setResetConfirmOpen(true);
                      }}
                      className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Reset Demo Dataset</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 px-4 py-5 lg:px-6 lg:py-6">
          <div className="mx-auto max-w-[1400px]">{children}</div>
        </main>
      </div>

      {/* Global Search, Help Guide & Confirm Reset Dialog */}
      <GlobalSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      <HelpGuideDrawer open={helpOpen} onClose={() => setHelpOpen(false)} />
      <ConfirmDialog
        open={resetConfirmOpen}
        tone="danger"
        busy={resetting}
        title="Reset Demo Dataset?"
        description="This will restore all demo clients, sample invoices, Purchase Register rows, GSTR-2B imports, and audit history back to the initial clean seed state."
        confirmLabel="Restore Clean Demo Data"
        onConfirm={handleConfirmReset}
        onCancel={() => setResetConfirmOpen(false)}
      />
    </div>
  );
}
