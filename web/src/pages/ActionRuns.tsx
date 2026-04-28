import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  XCircle,
  Zap,
} from 'lucide-react';
import { api } from '../lib/api';
import { encodePathSegment } from '../lib/utils';
import type { ActionRun, Entity } from '../lib/types';

const RUN_HISTORY_PAGE_SIZE = 100;

const statusBadge: Record<string, string> = {
  pending: 'bg-[var(--gantry-bg-tertiary)] text-[var(--gantry-text-secondary)]',
  running: 'bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]',
  success: 'bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]',
  failed: 'bg-[var(--gantry-danger)]/10 text-[var(--gantry-danger)]',
};

const statusLabel: Record<string, string> = {
  pending: 'Queued',
  running: 'Running',
  success: 'Completed',
  failed: 'Failed',
};

const statusIcon: Record<string, React.ReactNode> = {
  pending: <Clock className="h-4 w-4 text-[var(--gantry-text-secondary)]" />,
  running: <Loader2 className="h-4 w-4 animate-spin text-[var(--gantry-accent)]" />,
  success: <CheckCircle2 className="h-4 w-4 text-[var(--gantry-accent)]" />,
  failed: <XCircle className="h-4 w-4 text-[var(--gantry-danger)]" />,
};

function parseJSON(value?: string) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function relativeTime(dateStr?: string) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(dateStr).toLocaleDateString();
}

function formatDateTime(dateStr?: string) {
  if (!dateStr) return 'Not recorded';
  return new Date(dateStr).toLocaleString();
}

export default function ActionRuns() {
  const [runs, setRuns] = useState<ActionRun[]>([]);
  const [actions, setActions] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [actionName, setActionName] = useState('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const loadPage = async (offset = 0, append = false, showSpinner = false) => {
    setError('');
    if (showSpinner) setRefreshing(true);
    if (append) setLoadingMore(true);
    try {
      const [runData, actionData] = await Promise.all([
        api.listAllActionRuns(RUN_HISTORY_PAGE_SIZE + 1, offset),
        api.listActions().catch(() => [] as Entity[]),
      ]);
      const pageRuns = (runData || []).slice(0, RUN_HISTORY_PAGE_SIZE);
      setRuns((prev) => append ? [...prev, ...pageRuns] : pageRuns);
      setActions(actionData || []);
      setHasMore((runData || []).length > RUN_HISTORY_PAGE_SIZE);
    } catch (e: any) {
      setError(e.message || 'failed to load action run history');
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    void loadPage();
  }, []);

  const actionLookup = useMemo(() => {
    const byName = new Map<string, Entity>();
    actions.forEach((action) => byName.set(action.metadata.name, action));
    return byName;
  }, [actions]);

  const actionOptions = useMemo(
    () => Array.from(new Set(runs.map((run) => run.actionName))).sort(),
    [runs],
  );

  const counts = useMemo(() => {
    return runs.reduce<Record<string, number>>((acc, run) => {
      acc[run.status] = (acc[run.status] || 0) + 1;
      return acc;
    }, {});
  }, [runs]);

  const filteredRuns = useMemo(() => {
    const q = search.trim().toLowerCase();
    return runs.filter((run) => {
      const action = actionLookup.get(run.actionName);
      const haystack = [
        run.id,
        run.actionName,
        action?.metadata.title,
        run.triggeredBy,
        run.status,
        run.error,
      ].filter(Boolean).join(' ').toLowerCase();
      return (status === 'all' || run.status === status)
        && (actionName === 'all' || run.actionName === actionName)
        && (!q || haystack.includes(q));
    });
  }, [actionLookup, actionName, runs, search, status]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-7 w-7 animate-spin text-[var(--gantry-accent)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link to="/actions" className="mb-3 inline-flex items-center gap-1.5 text-sm text-[var(--gantry-accent)] hover:opacity-75">
            <ArrowLeft className="h-4 w-4" /> Actions
          </Link>
          <h1 className="text-2xl font-bold text-[var(--gantry-text-primary)]">Action Run History</h1>
          <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">
            {runs.length} run{runs.length !== 1 ? 's' : ''} across {actionOptions.length} action{actionOptions.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => void loadPage(0, false, true)}
          disabled={refreshing}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--gantry-border)] px-4 py-2 text-sm font-medium text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-tertiary)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-[var(--gantry-danger)] bg-[var(--gantry-bg-primary)] px-4 py-3 text-sm text-[var(--gantry-danger)]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(['success', 'failed', 'running', 'pending'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setStatus(status === key ? 'all' : key)}
            className={`rounded-lg border px-4 py-3 text-left transition-colors ${
              status === key
                ? 'border-[var(--gantry-accent)] bg-[var(--gantry-accent)]/10'
                : 'border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-bg-tertiary)]'
            }`}
          >
            <div className="flex items-center gap-2">
              {statusIcon[key]}
              <span className="text-sm font-medium text-[var(--gantry-text-primary)]">{statusLabel[key]}</span>
            </div>
            <p className="mt-1 text-2xl font-semibold text-[var(--gantry-text-primary)]">{counts[key] || 0}</p>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-4 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--gantry-text-secondary)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search runs, actions, users, or errors..."
            className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] py-2 pl-9 pr-3 text-sm text-[var(--gantry-text-primary)] placeholder-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] focus:border-[var(--gantry-accent)] focus:outline-none"
        >
          <option value="all">All statuses</option>
          <option value="success">Completed</option>
          <option value="failed">Failed</option>
          <option value="running">Running</option>
          <option value="pending">Queued</option>
        </select>
        <select
          value={actionName}
          onChange={(e) => setActionName(e.target.value)}
          className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] focus:border-[var(--gantry-accent)] focus:outline-none"
        >
          <option value="all">All actions</option>
          {actionOptions.map((name) => (
            <option key={name} value={name}>{actionLookup.get(name)?.metadata.title || name}</option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
        {filteredRuns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-xl bg-[var(--gantry-bg-secondary)] p-4">
              <Zap className="h-8 w-8 text-[var(--gantry-text-secondary)]" />
            </div>
            <p className="mt-4 text-sm font-medium text-[var(--gantry-text-primary)]">No action runs found</p>
            <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">
              Adjust the filters or run an action to create history.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--gantry-border)]">
            {filteredRuns.map((run) => {
              const action = actionLookup.get(run.actionName);
              const parsedInputs = parseJSON(run.inputs);
              const parsedOutputs = parseJSON(run.outputs);
              const isOpen = expanded.has(run.id);

              return (
                <div key={run.id}>
                  <button
                    type="button"
                    onClick={() => toggle(run.id)}
                    aria-expanded={isOpen}
                    aria-controls={`action-run-details-${run.id}`}
                    className="grid w-full grid-cols-1 gap-3 px-4 py-4 text-left hover:bg-[var(--gantry-bg-secondary)] md:grid-cols-[minmax(0,1fr)_12rem_10rem_7.5rem] xl:grid-cols-[minmax(0,1fr)_16rem_14rem_8.5rem]"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5">{statusIcon[run.status] ?? statusIcon.pending}</span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--gantry-text-primary)]">
                          {action?.metadata.title || run.actionName}
                        </p>
                        <p className="truncate text-xs text-[var(--gantry-text-secondary)]">
                          <span className="font-mono">{run.id.slice(0, 8)}</span>
                          {action?.metadata.title && ` - ${run.actionName}`}
                        </p>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-[var(--gantry-text-secondary)]">Triggered by</p>
                      <p className="truncate text-sm text-[var(--gantry-text-primary)]">{run.triggeredBy || 'system'}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-[var(--gantry-text-secondary)]">Started</p>
                      <p className="text-sm text-[var(--gantry-text-primary)]">{relativeTime(run.startedAt)}</p>
                    </div>
                    <div className="flex items-center justify-between gap-3 md:justify-end">
                      <span className={`min-w-20 rounded-full px-2 py-0.5 text-center text-xs font-medium ${statusBadge[run.status] ?? statusBadge.pending}`}>
                        {statusLabel[run.status] ?? run.status}
                      </span>
                      {isOpen
                        ? <ChevronUp className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
                        : <ChevronDown className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
                      }
                    </div>
                  </button>

                  {isOpen && (
                    <div
                      id={`action-run-details-${run.id}`}
                      className="space-y-4 border-t border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-4 py-4"
                    >
                      <div className="grid gap-3 text-sm md:grid-cols-3">
                        <div>
                          <p className="text-xs font-medium text-[var(--gantry-text-secondary)]">Started at</p>
                          <p className="text-[var(--gantry-text-primary)]">{formatDateTime(run.startedAt)}</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-[var(--gantry-text-secondary)]">Completed at</p>
                          <p className="text-[var(--gantry-text-primary)]">{formatDateTime(run.completedAt)}</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-[var(--gantry-text-secondary)]">Action entity</p>
                          <Link to={`/catalog/Action/${encodePathSegment(run.actionName)}`} className="text-[var(--gantry-accent)] hover:opacity-75">
                            {run.actionName}
                          </Link>
                        </div>
                      </div>

                      {run.error && (
                        <div className="rounded-md border border-[var(--gantry-danger)] bg-[var(--gantry-bg-primary)] px-3 py-2 text-sm text-[var(--gantry-danger)]">
                          {run.error}
                        </div>
                      )}

                      <div className="grid gap-4 lg:grid-cols-2">
                        <div>
                          <p className="mb-1 text-xs font-medium text-[var(--gantry-text-secondary)]">Inputs</p>
                          <pre className="max-h-72 overflow-auto rounded-lg bg-[var(--gantry-bg-tertiary)] p-3 text-xs text-[var(--gantry-text-primary)]">
                            {run.inputs ? JSON.stringify(parsedInputs ?? run.inputs, null, 2) : 'No inputs recorded'}
                          </pre>
                        </div>
                        <div>
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <p className="text-xs font-medium text-[var(--gantry-text-secondary)]">Output</p>
                            {parsedOutputs?.runUrl && (
                              <a
                                href={parsedOutputs.runUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-[var(--gantry-accent)] hover:opacity-75"
                              >
                                <ExternalLink className="h-3 w-3" /> External run
                              </a>
                            )}
                          </div>
                          <pre className="max-h-72 overflow-auto rounded-lg bg-[var(--gantry-bg-tertiary)] p-3 text-xs text-[var(--gantry-text-primary)]">
                            {run.outputs ? JSON.stringify(parsedOutputs ?? run.outputs, null, 2) : 'No output recorded'}
                          </pre>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {hasMore && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void loadPage(runs.length, true)}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--gantry-border)] px-4 py-2 text-sm font-medium text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-tertiary)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
            Load more runs
          </button>
        </div>
      )}
    </div>
  );
}
