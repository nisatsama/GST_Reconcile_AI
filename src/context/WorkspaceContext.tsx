import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../api/client';
import type {
  BusinessClient,
  DashboardPayload,
  ReconciliationConfig,
  ReportingPeriod,
  UserRoleView,
  Workspace,
} from '../shared/types';

interface WorkspaceContextValue {
  workspace: Workspace | null;
  clients: BusinessClient[];
  periods: ReportingPeriod[];
  reconciliationConfig: ReconciliationConfig;
  selectedClientId: string;
  selectedPeriodId: string;
  selectedClient: BusinessClient | null;
  selectedPeriod: ReportingPeriod | null;
  dashboard: DashboardPayload | null;
  geminiConfigured: boolean;
  loading: boolean;
  error: string | null;
  setSelectedClientId: (id: string) => void;
  setSelectedPeriodId: (id: string) => void;
  setUserRoleView: (role: UserRoleView) => Promise<void>;
  refreshAll: () => Promise<void>;
  resetDemo: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [clients, setClients] = useState<BusinessClient[]>([]);
  const [periods, setPeriods] = useState<ReportingPeriod[]>([]);
  const [reconciliationConfig, setReconciliationConfig] = useState<ReconciliationConfig>({
    dateToleranceDays: 2,
    amountToleranceRupees: 5,
    enableFuzzyMatch: true,
    fuzzySimilarityThreshold: 0.72,
  });
  const [selectedClientId, setSelectedClientId] = useState<string>('client_eastern');
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('2026-10');
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [geminiConfigured, setGeminiConfigured] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadWorkspaceAndDashboard = useCallback(
    async (cId: string, pId: string) => {
      setLoading(true);
      setError(null);
      try {
        const [wsRes, healthRes, dashRes] = await Promise.all([
          api.getWorkspace(),
          api.health(),
          api.getDashboard(cId, pId),
        ]);
        setWorkspace(wsRes.workspace);
        setClients(wsRes.clients);
        setPeriods(wsRes.periods);
        setReconciliationConfig(wsRes.reconciliationConfig);
        setGeminiConfigured(healthRes.geminiConfigured);
        setDashboard(dashRes);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load workspace data.');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadWorkspaceAndDashboard(selectedClientId, selectedPeriodId);
  }, [selectedClientId, selectedPeriodId, loadWorkspaceAndDashboard]);

  const refreshAll = useCallback(async () => {
    await loadWorkspaceAndDashboard(selectedClientId, selectedPeriodId);
  }, [selectedClientId, selectedPeriodId, loadWorkspaceAndDashboard]);

  const resetDemo = useCallback(async () => {
    setLoading(true);
    try {
      await api.resetWorkspace();
      setSelectedClientId('client_eastern');
      setSelectedPeriodId('2026-10');
      await loadWorkspaceAndDashboard('client_eastern', '2026-10');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset demo dataset.');
      setLoading(false);
    }
  }, [loadWorkspaceAndDashboard]);

  const setUserRoleView = useCallback(async (role: UserRoleView) => {
    const res = await api.updateWorkspaceConfig({ userRoleView: role });
    setWorkspace(res.workspace);
  }, []);

  const selectedClient = clients.find((c) => c.id === selectedClientId) ?? clients[0] ?? null;
  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId) ?? periods[2] ?? null;

  return (
    <WorkspaceContext.Provider
      value={{
        workspace,
        clients,
        periods,
        reconciliationConfig,
        selectedClientId,
        selectedPeriodId,
        selectedClient,
        selectedPeriod,
        dashboard,
        geminiConfigured,
        loading,
        error,
        setSelectedClientId,
        setSelectedPeriodId,
        setUserRoleView,
        refreshAll,
        resetDemo,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return ctx;
}
