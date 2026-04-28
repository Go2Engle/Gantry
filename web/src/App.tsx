import { lazy, Suspense, useCallback, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { useAuth } from './hooks/useAuth';
import Sidebar from './components/Sidebar';
import CommandPalette from './components/CommandPalette';
import ErrorBoundary from './components/ErrorBoundary';
import Login from './pages/Login';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Catalog = lazy(() => import('./pages/Catalog'));
const EntityDetail = lazy(() => import('./pages/EntityDetail'));
const Actions = lazy(() => import('./pages/Actions'));
const ActionRuns = lazy(() => import('./pages/ActionRuns'));
const Settings = lazy(() => import('./pages/Settings'));
const Admin = lazy(() => import('./pages/Admin'));
const Plugins = lazy(() => import('./pages/Plugins'));
const StatusMonitor = lazy(() => import('./pages/StatusMonitor'));
const GitOps = lazy(() => import('./pages/GitOps'));
const Harbor = lazy(() => import('./pages/Harbor'));
const Nexus = lazy(() => import('./pages/Nexus'));
const TopologyExplorer = lazy(() => import('./pages/TopologyExplorer'));
const Flow = lazy(() => import('./pages/Flow'));

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
          <Suspense fallback={<PageLoadingState />}>
            <Routes>
              <Route path="/flow" element={<div className="px-4 py-6 sm:px-6 sm:py-8"><Flow /></div>} />
              <Route path="/topology" element={<div className="px-4 py-6 sm:px-6 sm:py-8"><TopologyExplorer /></div>} />
              <Route path="*" element={
                <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/catalog" element={<Catalog />} />
                    <Route path="/catalog/:kind" element={<Catalog />} />
                    <Route path="/catalog/:kind/:name" element={<EntityDetail />} />
                    <Route path="/actions" element={<Actions />} />
                    <Route path="/actions/runs" element={<ActionRuns />} />
                    <Route path="/admin" element={<Admin />} />
                    <Route path="/admin/users" element={<Admin section="users" />} />
                    <Route path="/admin/access" element={<Admin section="access" />} />
                    <Route path="/admin/plugins" element={<Admin section="plugins" />} />
                    <Route path="/admin/audit" element={<Admin section="audit" />} />
                    <Route path="/users" element={<Navigate to="/admin/users" replace />} />
                    <Route path="/rbac" element={<Navigate to="/admin/access" replace />} />
                    <Route path="/audit" element={<Navigate to="/admin/audit" replace />} />
                    <Route path="/plugins" element={<Plugins />} />
                    <Route path="/status" element={<StatusMonitor />} />
                    <Route path="/gitops" element={<GitOps />} />
                    <Route path="/harbor" element={<Harbor />} />
                    <Route path="/nexus" element={<Nexus />} />
                    <Route path="/settings" element={<Settings />} />
                  </Routes>
                </div>
              } />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
      <CommandPalette />
    </div>
  );
}

function PageLoadingState() {
  return (
    <div className="flex min-h-[16rem] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="spinner h-7 w-7 text-[var(--gantry-accent)]" />
        <p className="text-sm text-[var(--gantry-text-secondary)]">Loading page...</p>
      </div>
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
