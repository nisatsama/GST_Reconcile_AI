import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ToastProvider } from './components/ToastProvider';
import { WorkspaceProvider } from './context/WorkspaceContext';
import { AssistantPage } from './pages/AssistantPage';
import { AuditTrailPage } from './pages/AuditTrailPage';
import { DiscrepanciesPage } from './pages/DiscrepanciesPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { OverviewPage } from './pages/OverviewPage';
import { ReconciliationPage } from './pages/ReconciliationPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { SuppliersPage } from './pages/SuppliersPage';

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <WorkspaceProvider>
          <AppShell>
            <Routes>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/reconciliation" element={<ReconciliationPage />} />
              <Route path="/documents" element={<DocumentsPage />} />
              <Route path="/invoices" element={<DocumentsPage initialTab="invoices" />} />
              <Route
                path="/purchase-register"
                element={<DocumentsPage initialTab="purchase-register" />}
              />
              <Route path="/gstr-2b" element={<DocumentsPage initialTab="gstr-2b" />} />
              <Route path="/discrepancies" element={<DiscrepanciesPage />} />
              <Route path="/suppliers" element={<SuppliersPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/audit-trail" element={<AuditTrailPage />} />
              <Route path="/assistant" element={<AssistantPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AppShell>
        </WorkspaceProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
