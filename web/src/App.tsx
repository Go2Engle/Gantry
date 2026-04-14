import { useCallback, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { useAuth } from './hooks/useAuth';
import Sidebar from './components/Sidebar';
import CommandPalette from './components/CommandPalette';
import ErrorBoundary from './components/ErrorBoundary';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Catalog from './pages/Catalog';
import EntityDetail from './pages/EntityDetail';
import Actions from './pages/Actions';
import AuditLog from './pages/AuditLog';
import Settings from './pages/Settings';
import UsersPage from './pages/Users';
import Plugins from './pages/Plugins';
import StatusMonitor from './pages/StatusMonitor';
import GitOps from './pages/GitOps';
import Harbor from './pages/Harbor';
import Nexus from './pages/Nexus';
import RBAC from './pages/RBAC';
import TopologyExplorer from './pages/TopologyExplorer';


function AuthenticatedLayout() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const closeMobileSidebar = useCallback(() => setMobileSidebarOpen(false), []);

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--gantry-bg-secondary)]">
      <Sidebar mobileOpen={mobileSidebarOpen} onCloseMobile={closeMobileSidebar} />
      <main className="relative flex-1 overflow-y-auto bg-[var(--gantry-bg-secondary)]">
        <div className="sticky top-0 z-20 border-b border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]/95 px-4 py-3 backdrop-blur lg:hidden">
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="rounded-lg p-2 text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)] hover:text-[var(--gantry-text-primary)]"
            aria-label="Open navigation menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
        <ErrorBoundary>
          <Routes>
            <Route path="/topology" element={<div className="px-4 py-6 sm:px-6 sm:py-8"><TopologyExplorer /></div>} />
            <Route path="*" element={
              <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/catalog" element={<Catalog />} />
                  <Route path="/catalog/:kind" element={<Catalog />} />
                  <Route path="/catalog/:kind/:name" element={<EntityDetail />} />
                  <Route path="/actions" element={<Actions />} />
                  <Route path="/audit" element={<AuditLog />} />
                  <Route path="/users" element={<UsersPage />} />
                  <Route path="/plugins" element={<Plugins />} />
                  <Route path="/status" element={<StatusMonitor />} />
                  <Route path="/gitops" element={<GitOps />} />
                  <Route path="/harbor" element={<Harbor />} />
                  <Route path="/nexus" element={<Nexus />} />
                  <Route path="/rbac" element={<RBAC />} />
                  <Route path="/settings" element={<Settings />} />
                </Routes>
              </div>
            } />
          </Routes>
        </ErrorBoundary>
      </main>
      <CommandPalette />
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-[var(--gantry-bg-primary)]">
      <div className="flex flex-col items-center gap-4">
        <div className="spinner h-8 w-8 text-[var(--gantry-accent)]" />
        <p className="text-sm text-[var(--gantry-text-secondary)]">Loading Gantry...</p>
      </div>
    </div>
  );
}

export default function App() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!isAuthenticated) return <Login />;
  return <AuthenticatedLayout />;
}
