import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Box,
  Zap,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  LogOut,
  Server,
  Globe,
  Database,
  Users,
  Cloud,
  FileText,
  ClipboardList,
  UserCog,
  Puzzle,
  Activity,
  GitBranch,
  Shield,
  Package,
  X,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { api } from '../lib/api';
import ThemeToggle from './ThemeToggle';
import { ENTITY_KINDS } from '../lib/types';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Server,
  Globe,
  Database,
  Users,
  Cloud,
  FileText,
};

interface NavItem {
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: { label: string; path: string; icon: React.ComponentType<{ className?: string }> }[];
}

interface SidebarProps {
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard },
  {
    label: 'Catalog',
    path: '/catalog',
    icon: Box,
    children: ENTITY_KINDS.map((k) => ({
      label: k.name,
      path: `/catalog/${k.name}`,
      icon: iconMap[k.icon] || Box,
    })),
  },
  { label: 'Actions', path: '/actions', icon: Zap },
];

export default function Sidebar({ mobileOpen = false, onCloseMobile }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [statusMonitorEnabled, setStatusMonitorEnabled] = useState(false);
  const [gitopsEnabled, setGitopsEnabled] = useState(false);
  const [harborEnabled, setHarborEnabled] = useState(false);
  const location = useLocation();
  const { user, logout } = useAuth();
  const { theme } = useTheme();

  useEffect(() => {
    setCatalogOpen(location.pathname.startsWith('/catalog'));
    onCloseMobile?.();
  }, [location.pathname, onCloseMobile]);

  // Check if the status-monitor plugin is enabled (once on mount).
  useEffect(() => {
    api.listPlugins().then((plugins) => {
      const sm = plugins.find((p) => p.name === 'status-monitor');
      if (sm?.enabled) setStatusMonitorEnabled(true);
      const gops = plugins.find((p) => p.name === 'gitops');
      if (gops?.enabled) setGitopsEnabled(true);
      const hbr = plugins.find((p) => p.name === 'harbor');
      if (hbr?.enabled) setHarborEnabled(true);
    }).catch(() => {});
  }, []);

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const roleLevels: Record<string, number> = {
    viewer: 1,
    developer: 2,
    'platform-engineer': 3,
    admin: 4,
  };
  const effectiveRole = user?.effectiveRole || user?.role || 'viewer';
  const canManagePlugins = (roleLevels[effectiveRole] || 0) >= roleLevels['platform-engineer'];

  const widthClass = collapsed ? 'lg:w-16' : 'lg:w-64';
  const mobileVisibilityClass = mobileOpen ? 'translate-x-0' : '-translate-x-full';

  return (
    <>
      {mobileOpen && (
        <button
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          aria-label="Close navigation menu"
          onClick={onCloseMobile}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] transition-transform duration-200 lg:static lg:z-auto lg:w-auto lg:translate-x-0 lg:transition-all ${widthClass} ${mobileVisibilityClass}`}
      >
        {/* Brand */}
        <div className="flex h-16 items-center justify-between border-b border-[var(--gantry-border)] px-4">
          {(() => {
            const logoSrc = theme === 'dark' ? '/logo-black.png' : '/logo-white.png';
            const brandMark = (
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--gantry-accent)]">
                <img src={logoSrc} alt="Gantry" className="h-6 w-6 object-contain" />
              </div>
            );
            return collapsed ? (
              <Link to="/" className="mx-auto hidden lg:block">{brandMark}</Link>
            ) : (
              <Link to="/" className="flex items-center gap-2">
                {brandMark}
                <span className="text-lg font-semibold text-[var(--gantry-text-primary)]">Gantry</span>
              </Link>
            );
          })()}
          <button
            className="rounded p-1 text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)] lg:hidden"
            aria-label="Close navigation menu"
            onClick={onCloseMobile}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="flex flex-col gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.path);
              const hasChildren = item.children && item.children.length > 0;

              return (
                <li key={item.path}>
                  <div className="flex items-center">
                    <Link
                      to={item.path}
                      className={`flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        active
                          ? 'bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]'
                          : 'text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)] hover:text-[var(--gantry-text-primary)]'
                      }`}
                      title={collapsed ? item.label : undefined}
                    >
                      <Icon className="h-5 w-5 shrink-0" />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                    {hasChildren && !collapsed && (
                      <button
                        onClick={() => setCatalogOpen(!catalogOpen)}
                        className="rounded p-1 text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)]"
                      >
                        {catalogOpen ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>
                    )}
                  </div>
                  {hasChildren && catalogOpen && !collapsed && (
                    <ul className="ml-4 mt-1 flex flex-col gap-0.5 border-l border-[var(--gantry-border)] pl-3">
                      {item.children!.map((child) => {
                        const ChildIcon = child.icon;
                        const childActive = isActive(child.path);
                        return (
                          <li key={child.path}>
                            <Link
                              to={child.path}
                              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                                childActive
                                  ? 'text-[var(--gantry-accent)]'
                                  : 'text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)]'
                              }`}
                            >
                              <ChildIcon className="h-4 w-4 shrink-0" />
                              <span>{child.label}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
            {statusMonitorEnabled && (
              <li>
                <Link
                  to="/status"
                  className={`flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive('/status')
                      ? 'bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]'
                      : 'text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)] hover:text-[var(--gantry-text-primary)]'
                  }`}
                  title={collapsed ? 'Status' : undefined}
                >
                  <Activity className="h-5 w-5 shrink-0" />
                  {!collapsed && <span className="truncate">Status</span>}
                </Link>
              </li>
            )}
            {harborEnabled && (
              <li>
                <Link
                  to="/harbor"
                  className={`flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive('/harbor')
                      ? 'bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]'
                      : 'text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)] hover:text-[var(--gantry-text-primary)]'
                  }`}
                  title={collapsed ? 'Harbor' : undefined}
                >
                  <Package className="h-5 w-5 shrink-0" />
                  {!collapsed && <span className="truncate">Harbor</span>}
                </Link>
              </li>
            )}
            {gitopsEnabled && user?.permissions?.admin && (
              <li>
                <Link
                  to="/gitops"
                  className={`flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive('/gitops')
                      ? 'bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]'
                      : 'text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)] hover:text-[var(--gantry-text-primary)]'
                  }`}
                  title={collapsed ? 'GitOps' : undefined}
                >
                  <GitBranch className="h-5 w-5 shrink-0" />
                  {!collapsed && <span className="truncate">GitOps</span>}
                </Link>
              </li>
            )}
            {canManagePlugins && (
              <li>
                <Link
                  to="/plugins"
                  className={`flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive('/plugins')
                      ? 'bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]'
                      : 'text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)] hover:text-[var(--gantry-text-primary)]'
                  }`}
                  title={collapsed ? 'Plugins' : undefined}
                >
                  <Puzzle className="h-5 w-5 shrink-0" />
                  {!collapsed && <span className="truncate">Plugins</span>}
                </Link>
              </li>
            )}
            {user?.permissions?.admin && (
              <li>
                <Link
                  to="/audit"
                  className={`flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive('/audit')
                      ? 'bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]'
                      : 'text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)] hover:text-[var(--gantry-text-primary)]'
                  }`}
                  title={collapsed ? 'Audit Log' : undefined}
                >
                  <ClipboardList className="h-5 w-5 shrink-0" />
                  {!collapsed && <span className="truncate">Audit Log</span>}
                </Link>
              </li>
            )}
            {user?.permissions?.admin && (
              <li>
                <Link
                  to="/users"
                  className={`flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive('/users')
                      ? 'bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]'
                      : 'text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)] hover:text-[var(--gantry-text-primary)]'
                  }`}
                  title={collapsed ? 'Users' : undefined}
                >
                  <UserCog className="h-5 w-5 shrink-0" />
                  {!collapsed && <span className="truncate">Users</span>}
                </Link>
              </li>
            )}
            {user?.permissions?.admin && (
              <li>
                <Link
                  to="/rbac"
                  className={`flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive('/rbac')
                      ? 'bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]'
                      : 'text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)] hover:text-[var(--gantry-text-primary)]'
                  }`}
                  title={collapsed ? 'Access Control' : undefined}
                >
                  <Shield className="h-5 w-5 shrink-0" />
                  {!collapsed && <span className="truncate">Access Control</span>}
                </Link>
              </li>
            )}
            <li>
              <Link
                to="/settings"
                className={`flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive('/settings')
                    ? 'bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]'
                    : 'text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)] hover:text-[var(--gantry-text-primary)]'
                }`}
                title={collapsed ? 'Settings' : undefined}
              >
                <Settings className="h-5 w-5 shrink-0" />
                {!collapsed && <span className="truncate">Settings</span>}
              </Link>
            </li>
          </ul>
        </nav>

        {/* Bottom section */}
        <div className="border-t border-[var(--gantry-border)] p-3">
          <div className="flex items-center justify-between">
            {!collapsed && <ThemeToggle />}
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="hidden rounded-lg p-2 text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)] lg:inline-flex"
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </button>
          </div>
          {!collapsed && user && (
            <div className="mt-3 flex items-center justify-between rounded-lg bg-[var(--gantry-bg-secondary)] px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--gantry-text-primary)]">
                  {user.displayName || user.username}
                </p>
                <p className="truncate text-xs text-[var(--gantry-text-secondary)]">{effectiveRole}</p>
              </div>
              <button
                onClick={logout}
                className="shrink-0 rounded p-1.5 text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)] hover:text-[var(--gantry-danger)]"
                title="Logout"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
          {collapsed && user && (
            <button
              onClick={logout}
              className="mt-2 hidden w-full items-center justify-center rounded-lg p-2 text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)] hover:text-[var(--gantry-danger)] lg:flex"
              title="Logout"
            >
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
