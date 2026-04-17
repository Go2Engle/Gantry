import { useState, useEffect, useCallback } from 'react';
import { ClipboardList } from 'lucide-react';
import { api } from '../lib/api';
import type { AuditEntry } from '../lib/types';

const ACTION_COLORS: Record<string, string> = {
  'entity.created': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  'entity.updated': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  'entity.deleted': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

function actionColor(action: string): string {
  return ACTION_COLORS[action] ?? 'bg-[var(--gantry-bg-tertiary)] text-[var(--gantry-text-secondary)]';
}

function formatTime(ts: string): string {
  const date = new Date(ts);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function AuditLog({ embedded = false }: { embedded?: boolean }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const PAGE = 50;

  const loadEntries = useCallback(async (off: number, append: boolean) => {
    try {
      const data = await api.listAuditEntries(PAGE, off);
      const rows = data ?? [];
      setEntries((prev) => (append ? [...prev, ...rows] : rows));
      setHasMore(rows.length === PAGE);
      setOffset(off + rows.length);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load audit log');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadEntries(0, false).finally(() => setLoading(false));
  }, [loadEntries]);

  const loadMore = async () => {
    setLoadingMore(true);
    await loadEntries(offset, true);
    setLoadingMore(false);
  };

  return (
    <div className="space-y-6">
      {!embedded && (
        <div className="flex items-center gap-3">
          <ClipboardList className="h-6 w-6 text-[var(--gantry-accent)]" />
          <div>
            <h1 className="text-2xl font-bold text-[var(--gantry-text-primary)]">Audit Log</h1>
            <p className="text-sm text-[var(--gantry-text-secondary)]">Track all changes and actions in Gantry</p>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--gantry-accent)] border-t-transparent" />
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-6 py-12 text-center">
          <ClipboardList className="mx-auto h-10 w-10 text-[var(--gantry-text-secondary)]" />
          <p className="mt-3 text-sm text-[var(--gantry-text-secondary)]">No audit entries yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
          <table className="min-w-full divide-y divide-[var(--gantry-border)]">
            <thead>
              <tr className="bg-[var(--gantry-bg-secondary)]">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Time</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">User</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Action</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Resource</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--gantry-border)]">
              {entries.map((entry) => (
                <tr key={entry.id} className="hover:bg-[var(--gantry-bg-secondary)]">
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-[var(--gantry-text-secondary)]">
                    {formatTime(entry.timestamp)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-[var(--gantry-text-primary)]">
                    {entry.userName || 'system'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${actionColor(entry.action)}`}>
                      {entry.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--gantry-text-primary)]">
                    {entry.resourceType && entry.resourceName
                      ? `${entry.resourceType}/${entry.resourceName}`
                      : entry.resourceName || entry.resourceType || '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-[var(--gantry-text-secondary)]">
                    {entry.source || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {hasMore && (
            <div className="border-t border-[var(--gantry-border)] px-4 py-3 text-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-lg border border-[var(--gantry-border)] px-4 py-2 text-sm text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-tertiary)] disabled:opacity-50"
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
