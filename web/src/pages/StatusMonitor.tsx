import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  HelpCircle,
  ExternalLink,
  Search,
  Wrench,
  Loader2,
  Activity,
} from 'lucide-react';
import { api } from '../lib/api';
import type { StatusMonitorResult } from '../lib/types';

const STATUS_CONFIG: Record<string, { label: string; dot: string; icon: React.ComponentType<{ className?: string }>; badge: string }> = {
  operational: {
    label: 'Operational',
    dot: 'bg-green-500',
    icon: CheckCircle2,
    badge: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  },
  degraded: {
    label: 'Degraded',
    dot: 'bg-yellow-500',
    icon: AlertTriangle,
    badge: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  },
  partial: {
    label: 'Partial Outage',
    dot: 'bg-orange-500',
    icon: AlertCircle,
    badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  },
  major: {
    label: 'Major Outage',
    dot: 'bg-red-500',
    icon: AlertCircle,
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  },
  maintenance: {
    label: 'Maintenance',
    dot: 'bg-blue-500',
    icon: Wrench,
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  },
  unknown: {
    label: 'Unknown',
    dot: 'bg-gray-400',
    icon: HelpCircle,
    badge: 'bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400',
  },
};

const CATEGORY_LABELS: Record<string, string> = {
  'developer-tools': 'Developer Tools',
  'ci-cd': 'CI/CD & Hosting',
  'cdn-edge': 'CDN & Edge',
  monitoring: 'Monitoring',
  infrastructure: 'Infrastructure',
  communication: 'Communication',
  'package-registry': 'Package Registries',
  payments: 'E-Commerce & Payments',
  other: 'Other',
  custom: 'Custom',
};

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export default function StatusMonitor() {
  const [statuses, setStatuses] = useState<StatusMonitorResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'issues'>('all');

  const fetchStatuses = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const data = await api.getStatusMonitorStatuses();
      setStatuses(data);
      setLastChecked(new Date());
      setError('');
    } catch (err: any) {
      setError(err.message || 'Failed to fetch statuses');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchStatuses();
    const interval = setInterval(() => fetchStatuses(), 5 * 60_000);
    return () => clearInterval(interval);
  }, [fetchStatuses]);

  // Gather unique categories
  const categories = ['all', ...Array.from(new Set(statuses.map((s) => s.category)))];

  // Filter statuses
  const filtered = statuses.filter((s) => {
    if (search && !s.title.toLowerCase().includes(search.toLowerCase()) && !s.name.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    if (categoryFilter !== 'all' && s.category !== categoryFilter) return false;
    if (statusFilter === 'issues' && (s.status === 'operational' || s.status === 'unknown')) return false;
    return true;
  });

  // Summary counts
  const operational = statuses.filter((s) => s.status === 'operational').length;
  const issues = statuses.filter((s) => s.status !== 'operational' && s.status !== 'unknown').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--gantry-accent)]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-8 text-center">
        <AlertCircle className="mx-auto mb-3 h-10 w-10 text-[var(--gantry-danger)]" />
        <h2 className="text-lg font-semibold text-[var(--gantry-text-primary)]">Unable to load statuses</h2>
        <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">{error}</p>
        <button
          onClick={() => { setLoading(true); setError(''); fetchStatuses(); }}
          className="mt-4 rounded-lg bg-[var(--gantry-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--gantry-accent-hover)]"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--gantry-text-primary)]">Status Monitor</h1>
          <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">
            Monitoring {statuses.length} services
            {lastChecked && <> &middot; Last checked {relativeTime(lastChecked.toISOString())}</>}
          </p>
        </div>
        <button
          onClick={() => fetchStatuses(true)}
          disabled={refreshing}
          className="flex items-center gap-2 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-4 py-2 text-sm font-medium text-[var(--gantry-text-primary)] transition-colors hover:border-[var(--gantry-accent)] hover:text-[var(--gantry-accent)] disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Summary banner */}
      {issues > 0 ? (
        <div className="flex items-center gap-3 rounded-xl border border-yellow-400/30 bg-yellow-400/10 px-5 py-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-yellow-500" />
          <div>
            <p className="text-sm font-semibold text-[var(--gantry-text-primary)]">
              {issues} {issues === 1 ? 'service' : 'services'} reporting issues
            </p>
            <p className="text-xs text-[var(--gantry-text-secondary)]">
              {operational} of {statuses.length} services are fully operational
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-green-500/30 bg-green-500/10 px-5 py-4">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
          <div>
            <p className="text-sm font-semibold text-[var(--gantry-text-primary)]">
              All systems operational
            </p>
            <p className="text-xs text-[var(--gantry-text-secondary)]">
              All {statuses.length} monitored services are reporting normal status
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--gantry-text-secondary)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search providers..."
            className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] py-2 pl-9 pr-3 text-sm text-[var(--gantry-text-primary)] placeholder:text-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
          />
        </div>

        {/* Status filter */}
        <div className="flex rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-0.5">
          <button
            onClick={() => setStatusFilter('all')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === 'all'
                ? 'bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]'
                : 'text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)]'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setStatusFilter('issues')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === 'issues'
                ? 'bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]'
                : 'text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)]'
            }`}
          >
            Issues Only
            {issues > 0 && (
              <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-yellow-500 px-1 text-[10px] font-bold text-white">
                {issues}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Category pills */}
      <div className="flex flex-wrap gap-2">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              categoryFilter === cat
                ? 'bg-[var(--gantry-accent)] text-[var(--gantry-bg-primary)]'
                : 'bg-[var(--gantry-bg-primary)] text-[var(--gantry-text-secondary)] border border-[var(--gantry-border)] hover:border-[var(--gantry-accent)] hover:text-[var(--gantry-accent)]'
            }`}
          >
            {cat === 'all' ? 'All' : CATEGORY_LABELS[cat] || cat}
          </button>
        ))}
      </div>

      {/* Provider grid */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-8 text-center">
          <Activity className="mx-auto mb-3 h-8 w-8 text-[var(--gantry-text-secondary)]" />
          <p className="text-sm text-[var(--gantry-text-secondary)]">
            {statusFilter === 'issues' ? 'No services are reporting issues.' : 'No providers match your filters.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((provider, idx) => {
            const cfg = STATUS_CONFIG[provider.status] || STATUS_CONFIG.unknown;
            return (
              <div
                key={provider.custom ? `custom-${provider.name}-${idx}` : provider.name}
                className="group flex items-center gap-3 rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-4 py-3 transition-colors hover:border-[var(--gantry-accent)]/30"
              >
                {/* Status dot */}
                <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${cfg.dot}`} />

                {/* Provider info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-[var(--gantry-text-primary)]">
                      {provider.title}
                    </span>
                    {provider.custom && (
                      <span className="shrink-0 rounded bg-[var(--gantry-bg-tertiary)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--gantry-text-secondary)]">
                        Custom
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-[var(--gantry-text-secondary)]">
                    {provider.description || cfg.label}
                  </p>
                </div>

                {/* Status badge */}
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${cfg.badge}`}>
                  {cfg.label}
                </span>

                {/* External link */}
                <a
                  href={provider.statusUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded p-1 text-[var(--gantry-text-secondary)] opacity-0 transition-opacity hover:text-[var(--gantry-accent)] group-hover:opacity-100"
                  title="Open status page"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
