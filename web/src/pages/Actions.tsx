import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Zap, X, CheckCircle2, XCircle, Clock, Loader2, Plus,
  Edit2, History, ExternalLink, Github, Webhook, ChevronDown, ChevronUp,
  Search, Tag, ChevronRight,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import type { Entity, ActionRun, JsonSchema } from '../lib/types';
import SchemaForm from '../components/SchemaForm';
import ActionWizard from '../components/ActionWizard';

// ─── Constants ────────────────────────────────────────────────────────────────

const statusIcon: Record<string, React.ReactNode> = {
  pending: <Clock className="h-7 w-7 text-[var(--gantry-warning)]" />,
  running: <Loader2 className="h-7 w-7 animate-spin text-[var(--gantry-accent)]" />,
  success: <CheckCircle2 className="h-7 w-7 text-[var(--gantry-success)]" />,
  failed: <XCircle className="h-7 w-7 text-[var(--gantry-danger)]" />,
};

const statusLabel: Record<string, string> = {
  pending: 'Queued',
  running: 'Running…',
  success: 'Completed',
  failed: 'Failed',
};

const statusBadge: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  running: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  success: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

// Type badge colors — hardcoded safe Tailwind classes (no dynamic construction)
const typeBadgeClass: Record<string, string> = {
  'github-action': 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  'webhook': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  'argocd-sync': 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  'internal': 'bg-[var(--gantry-bg-tertiary)] text-[var(--gantry-text-secondary)]',
};

function TypeIcon({ type, className = 'h-5 w-5' }: { type: string; className?: string }) {
  if (type === 'github-action') return <Github className={className} />;
  if (type === 'webhook') return <Webhook className={className} />;
  return <Zap className={className} />;
}

function getInputSchema(action: Entity): JsonSchema {
  const inputs = action.spec?.inputs;
  if (!inputs || !Array.isArray(inputs)) return { type: 'object', properties: {} };
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const input of inputs) {
    properties[input.name] = {
      type: input.type === 'select' ? 'string' : input.type === 'textarea' ? 'string' : input.type || 'string',
      title: input.title || input.name,
      description: input.description,
      enum: input.type === 'select' && !input.entityKind ? input.options?.map((o: any) => String(o.value ?? o)) : undefined,
      'x-entity-ref': input.type === 'select' && input.entityKind ? input.entityKind : undefined,
      default: input.default,
      format: input.type === 'textarea' ? 'textarea' : undefined,
    };
    if (input.required) required.push(input.name);
  }
  return { type: 'object', properties, required };
}

function parseOutputs(outputs: string) {
  try { return JSON.parse(outputs); } catch { return null; }
}

function relativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(dateStr).toLocaleDateString();
}

function requiresGitHubUserCredential(action: Entity): boolean {
  return action.spec?.type === 'github-action' && action.spec?.config?.credentialMode === 'user';
}

function requestGitHubUserToken(): Promise<{ token: string; login: string }> {
  return new Promise((resolve, reject) => {
    const popup = window.open('/api/v1/auth/github/token', 'gantry-github-token', 'width=520,height=720');
    if (!popup) {
      reject(new Error('GitHub authorization popup was blocked'));
      return;
    }

    const timeout = window.setTimeout(() => {
      cleanup();
      popup.close();
      reject(new Error('GitHub authorization timed out'));
    }, 120000);
    const closedPoll = window.setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new Error('GitHub authorization was cancelled'));
      }
    }, 500);

    let cleanup = () => {};

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== 'gantry:github-token') return;
      cleanup();
      popup.close();
      if (data.error) {
        reject(new Error(data.error));
        return;
      }
      if (!data.token) {
        reject(new Error('GitHub authorization returned no token'));
        return;
      }
      resolve({ token: data.token, login: data.login || '' });
    };

    cleanup = () => {
      window.clearTimeout(timeout);
      window.clearInterval(closedPoll);
      window.removeEventListener('message', onMessage);
    };

    window.addEventListener('message', onMessage);
  });
}

// ─── Action Card ──────────────────────────────────────────────────────────────

function ActionCard({
  action, canWrite, canExecute, showCategory,
  onExecute, onHistory, onEdit,
}: {
  action: Entity;
  canWrite: boolean;
  canExecute: boolean;
  showCategory: boolean;
  onExecute: () => void;
  onHistory: () => void;
  onEdit: () => void;
}) {
  const type = action.spec?.type ?? '';
  const category = action.spec?.category as string | undefined;
  const inputCount = Array.isArray(action.spec?.inputs) ? action.spec.inputs.length : 0;
  const userCredentialMode = requiresGitHubUserCredential(action);

  return (
    <div className="group flex flex-col rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] transition-shadow hover:shadow-md">
      {/* Card top accent strip */}
      <div className="h-1 w-full rounded-t-xl bg-[var(--gantry-accent)]/20" />

      <div className="flex flex-1 flex-col p-5">
        {/* Header row */}
        <div className="flex items-start gap-3">
          <div className="shrink-0 rounded-lg bg-[var(--gantry-bg-secondary)] p-2.5 text-[var(--gantry-text-secondary)] ring-1 ring-[var(--gantry-border)]">
            <TypeIcon type={type} className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="truncate text-sm font-semibold text-[var(--gantry-text-primary)]">
              {action.metadata.title || action.metadata.name}
            </h3>
            {action.metadata.name !== action.metadata.title && action.metadata.title && (
              <p className="truncate text-xs text-[var(--gantry-text-secondary)]">{action.metadata.name}</p>
            )}
          </div>
        </div>

        {/* Badges */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {type && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${typeBadgeClass[type] ?? typeBadgeClass['internal']}`}>
              {type}
            </span>
          )}
          {inputCount > 0 && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--gantry-bg-tertiary)] px-2 py-0.5 text-xs text-[var(--gantry-text-secondary)]">
              {inputCount} input{inputCount !== 1 ? 's' : ''}
            </span>
          )}
          {userCredentialMode && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--gantry-bg-tertiary)] px-2 py-0.5 text-xs text-[var(--gantry-text-secondary)]">
              user GitHub token
            </span>
          )}
          {showCategory && category && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--gantry-bg-tertiary)] px-2 py-0.5 text-xs text-[var(--gantry-text-secondary)]">
              <Tag className="h-2.5 w-2.5" />{category}
            </span>
          )}
          {action.metadata.owner && (
            <span className="inline-flex items-center rounded-full bg-[var(--gantry-bg-tertiary)] px-2 py-0.5 text-xs text-[var(--gantry-text-secondary)]">
              {action.metadata.owner}
            </span>
          )}
        </div>

        {/* Description */}
        {action.metadata.description && (
          <p className="mt-3 flex-1 text-xs leading-relaxed text-[var(--gantry-text-secondary)] line-clamp-2">
            {action.metadata.description}
          </p>
        )}

        {/* Divider */}
        <div className="mt-4 border-t border-[var(--gantry-border)]" />

        {/* Action buttons */}
        <div className="mt-3 flex flex-col gap-2">
          {canExecute ? (
            <button
              onClick={onExecute}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--gantry-accent)] px-4 py-2 text-sm font-medium text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)]"
            >
              <Zap className="h-4 w-4" /> Execute
            </button>
          ) : (
            <p className="text-center text-xs text-[var(--gantry-text-secondary)]">Execute not permitted</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={onHistory}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--gantry-border)] py-1.5 text-xs text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-secondary)] hover:text-[var(--gantry-text-primary)]"
            >
              <History className="h-3.5 w-3.5" /> History
            </button>
            {canWrite && (
              <button
                onClick={onEdit}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--gantry-border)] py-1.5 text-xs text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-secondary)] hover:text-[var(--gantry-text-primary)]"
              >
                <Edit2 className="h-3.5 w-3.5" /> Edit
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Category Section ─────────────────────────────────────────────────────────

function CategorySection({
  title, actions, canWrite, canExecute, onExecute, onHistory, onEdit,
}: {
  title: string;
  actions: Entity[];
  canWrite: boolean;
  canExecute: boolean;
  onExecute: (a: Entity) => void;
  onHistory: (a: Entity) => void;
  onEdit: (a: Entity) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section>
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="group flex w-full items-center gap-2 pb-2 text-left"
      >
        {collapsed
          ? <ChevronRight className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
          : <ChevronDown className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
        }
        <span className="text-sm font-semibold text-[var(--gantry-text-primary)]">{title}</span>
        <span className="rounded-full bg-[var(--gantry-bg-tertiary)] px-2 py-0.5 text-xs text-[var(--gantry-text-secondary)]">
          {actions.length}
        </span>
        <div className="flex-1 border-t border-[var(--gantry-border)] ml-2" />
      </button>

      {!collapsed && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {actions.map((action) => (
            <ActionCard
              key={action.metadata.name}
              action={action}
              canWrite={canWrite}
              canExecute={canExecute}
              showCategory={false}
              onExecute={() => onExecute(action)}
              onHistory={() => onHistory(action)}
              onEdit={() => onEdit(action)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Run History Modal ────────────────────────────────────────────────────────

function RunHistoryModal({ action, onClose }: { action: Entity; onClose: () => void }) {
  const [runs, setRuns] = useState<ActionRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.listActionRuns(action.metadata.name)
      .then(setRuns).catch(() => {}).finally(() => setLoading(false));
  }, [action.metadata.name]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[80vh] w-full max-w-2xl flex-col rounded-xl bg-[var(--gantry-bg-primary)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--gantry-border)] px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--gantry-text-primary)]">Run History</h2>
            <p className="text-sm text-[var(--gantry-text-secondary)]">
              {action.metadata.title || action.metadata.name}
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--gantry-accent)]" />
            </div>
          )}
          {!loading && runs.length === 0 && (
            <div className="py-12 text-center text-sm text-[var(--gantry-text-secondary)]">
              No runs yet for this action.
            </div>
          )}
          {!loading && runs.map((run) => {
            const isOpen = expanded.has(run.id);
            const parsed = run.outputs ? parseOutputs(run.outputs) : null;
            return (
              <div key={run.id} className="border-b border-[var(--gantry-border)]">
                <button
                  type="button"
                  onClick={() => toggle(run.id)}
                  className="flex w-full items-center gap-3 px-6 py-3 text-left hover:bg-[var(--gantry-bg-secondary)]"
                >
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${statusBadge[run.status] ?? statusBadge.pending}`}>
                    {statusLabel[run.status] ?? run.status}
                  </span>
                  <span className="flex-1 font-mono text-xs text-[var(--gantry-text-secondary)]">
                    {run.id.slice(0, 8)}
                  </span>
                  <span className="text-xs text-[var(--gantry-text-secondary)]">
                    by {run.triggeredBy || 'unknown'}
                  </span>
                  <span className="text-xs text-[var(--gantry-text-secondary)]">
                    {run.startedAt ? relativeTime(run.startedAt) : ''}
                  </span>
                  {isOpen
                    ? <ChevronUp className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
                    : <ChevronDown className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
                  }
                </button>

                {isOpen && (
                  <div className="border-t border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-6 py-3 space-y-3">
                    {run.inputs && run.inputs !== '{}' && (
                      <div>
                        <p className="mb-1 text-xs font-medium text-[var(--gantry-text-secondary)]">Inputs</p>
                        <pre className="rounded-md bg-[var(--gantry-bg-tertiary)] p-2 text-xs text-[var(--gantry-text-primary)] overflow-auto">
                          {JSON.stringify(parseOutputs(run.inputs) ?? run.inputs, null, 2)}
                        </pre>
                      </div>
                    )}
                    {run.error && (
                      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
                        {run.error}
                      </div>
                    )}
                    {parsed && (
                      <div>
                        <p className="mb-1 text-xs font-medium text-[var(--gantry-text-secondary)]">Output</p>
                        {parsed.runUrl && (
                          <a href={parsed.runUrl} target="_blank" rel="noopener noreferrer"
                            className="mb-1 flex items-center gap-1.5 text-xs text-[var(--gantry-accent)] hover:underline">
                            <ExternalLink className="h-3 w-3" /> View GitHub Actions run
                          </a>
                        )}
                        <pre className="rounded-md bg-[var(--gantry-bg-tertiary)] p-2 text-xs text-[var(--gantry-text-primary)] overflow-auto">
                          {JSON.stringify(parsed, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="border-t border-[var(--gantry-border)] px-6 py-3">
          <button onClick={onClose}
            className="rounded-lg border border-[var(--gantry-border)] px-4 py-2 text-sm text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-secondary)]">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Active Run Status Modal ──────────────────────────────────────────────────

function RunStatusModal({ run, onClose }: { run: ActionRun; onClose: () => void }) {
  const isDone = run.status === 'success' || run.status === 'failed';
  const parsed = run.outputs ? parseOutputs(run.outputs) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-[var(--gantry-bg-primary)] p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <h2 className="text-base font-semibold text-[var(--gantry-text-primary)]">{run.actionName}</h2>
          {isDone && (
            <button onClick={onClose} className="text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)]">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="mt-6 flex flex-col items-center gap-2 py-3">
          {statusIcon[run.status] ?? statusIcon.pending}
          <p className="text-sm font-medium text-[var(--gantry-text-primary)]">
            {statusLabel[run.status] ?? run.status}
          </p>
          <p className="font-mono text-xs text-[var(--gantry-text-secondary)]">Run {run.id.slice(0, 8)}…</p>
        </div>

        {run.error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            {run.error}
          </div>
        )}

        {parsed && (
          <div className="mt-4 space-y-1">
            {parsed.runUrl && (
              <a href={parsed.runUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm text-[var(--gantry-accent)] hover:underline">
                <ExternalLink className="h-4 w-4" /> View GitHub Actions run
              </a>
            )}
            <p className="text-xs font-medium text-[var(--gantry-text-secondary)]">Output</p>
            <pre className="max-h-40 overflow-auto rounded-lg bg-[var(--gantry-bg-tertiary)] p-3 text-xs text-[var(--gantry-text-primary)]">
              {JSON.stringify(parsed, null, 2)}
            </pre>
          </div>
        )}

        {run.completedAt && (
          <p className="mt-3 text-center text-xs text-[var(--gantry-text-secondary)]">
            Completed {new Date(run.completedAt).toLocaleTimeString()}
          </p>
        )}

        {isDone && (
          <button onClick={onClose}
            className="mt-5 w-full rounded-lg border border-[var(--gantry-border)] py-2 text-sm font-medium text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-tertiary)]">
            Close
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Actions() {
  const { user } = useAuth();
  const canWrite = user?.permissions?.write ?? false;
  const canExecute = user?.permissions?.execute ?? false;

  const [actions, setActions] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('All');

  const [executing, setExecuting] = useState<Entity | null>(null);
  const [activeRun, setActiveRun] = useState<ActionRun | null>(null);
  const [historyAction, setHistoryAction] = useState<Entity | null>(null);
  const [editAction, setEditAction] = useState<Entity | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadActions = () => {
    setLoading(true);
    api.listActions()
      .then((data) => setActions(data || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadActions(); }, []);

  // Poll active run until terminal state.
  useEffect(() => {
    if (!activeRun || activeRun.status === 'success' || activeRun.status === 'failed') {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const updated = await api.getActionRun(activeRun.actionName, activeRun.id);
        setActiveRun(updated);
        if (updated.status === 'success' || updated.status === 'failed') clearInterval(pollRef.current!);
      } catch { clearInterval(pollRef.current!); }
    }, 1500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeRun?.id, activeRun?.status]);

  const handleExecute = async (inputs: Record<string, any>) => {
    if (!executing) return;
    try {
      const secrets: Record<string, string> = {};
      if (requiresGitHubUserCredential(executing)) {
        const cfg = await api.getGitHubSSOConfig();
        if (!cfg.dispatchAsUser) {
          throw new Error('GitHub user credentials are not enabled for this action.');
        }
        const github = await requestGitHubUserToken();
        if (!github.token) {
          throw new Error('GitHub authorization returned no token');
        }
        secrets.githubToken = github.token;
      }
      const run = await api.executeAction(
        executing.metadata.name,
        inputs,
        Object.keys(secrets).length > 0 ? secrets : undefined,
      );
      setExecuting(null);
      setActiveRun(run);
    } catch (e: any) { setError(e.message); }
  };

  const handleWizardSave = (_saved: Entity) => {
    setShowWizard(false);
    setEditAction(null);
    loadActions();
  };

  // Derived: unique ordered categories
  const categories = useMemo(() => {
    const cats = new Set<string>();
    actions.forEach((a) => { if (a.spec?.category) cats.add(a.spec.category as string); });
    return Array.from(cats).sort();
  }, [actions]);

  // Derived: filtered + searched actions
  const filtered = useMemo(() => {
    let list = actions;
    if (activeCategory !== 'All') {
      if (activeCategory === '_uncategorized') {
        list = list.filter((a) => !a.spec?.category);
      } else {
        list = list.filter((a) => a.spec?.category === activeCategory);
      }
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((a) =>
        a.metadata.name.toLowerCase().includes(q) ||
        (a.metadata.title ?? '').toLowerCase().includes(q) ||
        (a.metadata.description ?? '').toLowerCase().includes(q) ||
        (a.spec?.category as string ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [actions, activeCategory, search]);

  // Group filtered actions by category for section view
  const sections = useMemo(() => {
    // When a filter is active, show flat list (one section without header)
    if (activeCategory !== 'All' || search.trim()) {
      return [{ title: '', actions: filtered, showHeader: false }];
    }
    // Group by category
    const grouped = new Map<string, Entity[]>();
    const uncategorized: Entity[] = [];
    actions.forEach((a) => {
      const cat = a.spec?.category as string | undefined;
      if (cat) {
        if (!grouped.has(cat)) grouped.set(cat, []);
        grouped.get(cat)!.push(a);
      } else {
        uncategorized.push(a);
      }
    });
    const result: { title: string; actions: Entity[]; showHeader: boolean }[] = [];
    Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([cat, acts]) => result.push({ title: cat, actions: acts, showHeader: true }));
    if (uncategorized.length > 0) {
      result.push({ title: 'Uncategorized', actions: uncategorized, showHeader: true });
    }
    return result;
  }, [actions, activeCategory, search, filtered]);

  const hasCategories = categories.length > 0;
  const uncategorizedCount = actions.filter((a) => !a.spec?.category).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--gantry-accent)] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--gantry-text-primary)]">Actions</h1>
          <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">
            Self-service workflows — {actions.length} action{actions.length !== 1 ? 's' : ''}
            {hasCategories && ` across ${categories.length} categor${categories.length !== 1 ? 'ies' : 'y'}`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Link
            to="/actions/runs"
            className="flex items-center gap-2 rounded-lg border border-[var(--gantry-border)] px-4 py-2 text-sm font-medium text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-tertiary)]"
          >
            <History className="h-4 w-4" /> Run History
          </Link>
          {canWrite && (
            <button
              onClick={() => setShowWizard(true)}
              className="flex items-center gap-2 rounded-lg bg-[var(--gantry-accent)] px-4 py-2 text-sm font-medium text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)]"
            >
              <Plus className="h-4 w-4" /> New Action
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {actions.length > 0 && (
        <>
          {/* ── Search + category filter bar ── */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {/* Search */}
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--gantry-text-secondary)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search actions…"
                className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] pl-9 pr-3 py-2 text-sm text-[var(--gantry-text-primary)] placeholder-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
              />
            </div>

            {/* Category chips — only shown when there are categories */}
            {hasCategories && (
              <div className="flex flex-wrap gap-1.5">
                {(['All', ...categories, ...(uncategorizedCount > 0 ? ['_uncategorized'] : [])] as string[]).map((cat) => {
                  const label = cat === '_uncategorized' ? 'Uncategorized' : cat;
                  const count = cat === 'All'
                    ? actions.length
                    : cat === '_uncategorized'
                      ? uncategorizedCount
                      : actions.filter((a) => a.spec?.category === cat).length;
                  const isActive = activeCategory === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setActiveCategory(cat)}
                      className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        isActive
                          ? 'bg-[var(--gantry-accent)] text-[var(--gantry-bg-primary)]'
                          : 'bg-[var(--gantry-bg-secondary)] text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)] hover:text-[var(--gantry-text-primary)]'
                      }`}
                    >
                      {label}
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                        isActive ? 'bg-[var(--gantry-bg-primary)]/20' : 'bg-[var(--gantry-bg-tertiary)]'
                      }`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Sections / grid ── */}
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--gantry-text-secondary)]">
              No actions match your search.
            </div>
          ) : (
            <div className="space-y-8">
              {sections.map((section) => (
                section.showHeader ? (
                  <CategorySection
                    key={section.title}
                    title={section.title}
                    actions={section.actions}
                    canWrite={canWrite}
                    canExecute={canExecute}
                    onExecute={setExecuting}
                    onHistory={setHistoryAction}
                    onEdit={setEditAction}
                  />
                ) : (
                  <div key="flat" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {section.actions.map((action) => (
                      <ActionCard
                        key={action.metadata.name}
                        action={action}
                        canWrite={canWrite}
                        canExecute={canExecute}
                        showCategory={activeCategory === 'All'}
                        onExecute={() => setExecuting(action)}
                        onHistory={() => setHistoryAction(action)}
                        onEdit={() => setEditAction(action)}
                      />
                    ))}
                  </div>
                )
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Empty state ── */}
      {actions.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--gantry-border)] py-20">
          <div className="rounded-xl bg-[var(--gantry-bg-secondary)] p-4">
            <Zap className="h-8 w-8 text-[var(--gantry-text-secondary)]" />
          </div>
          <p className="mt-4 text-sm font-medium text-[var(--gantry-text-primary)]">No actions yet</p>
          <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">
            Create your first self-service workflow to get started.
          </p>
          {canWrite && (
            <button
              onClick={() => setShowWizard(true)}
              className="mt-5 flex items-center gap-2 rounded-lg bg-[var(--gantry-accent)] px-5 py-2.5 text-sm font-medium text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)]"
            >
              <Plus className="h-4 w-4" /> Create your first action
            </button>
          )}
        </div>
      )}

      {/* ── Execute modal ── */}
      {executing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-[var(--gantry-bg-primary)] p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-[var(--gantry-text-primary)]">
                  {executing.metadata.title || executing.metadata.name}
                </h2>
                {executing.metadata.description && (
                  <p className="mt-0.5 text-sm text-[var(--gantry-text-secondary)]">
                    {executing.metadata.description}
                  </p>
                )}
              </div>
              <button onClick={() => setExecuting(null)} className="text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)]">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 max-h-[60vh] overflow-y-auto">
              <SchemaForm
                schema={getInputSchema(executing)}
                onSubmit={handleExecute}
                onCancel={() => setExecuting(null)}
                submitLabel="Execute"
              />
            </div>
          </div>
        </div>
      )}

      {activeRun && (
        <RunStatusModal
          run={activeRun}
          onClose={() => { if (pollRef.current) clearInterval(pollRef.current); setActiveRun(null); }}
        />
      )}

      {historyAction && (
        <RunHistoryModal action={historyAction} onClose={() => setHistoryAction(null)} />
      )}

      {showWizard && (
        <ActionWizard onSave={handleWizardSave} onClose={() => setShowWizard(false)} />
      )}

      {editAction && (
        <ActionWizard existing={editAction} onSave={handleWizardSave} onClose={() => setEditAction(null)} />
      )}
    </div>
  );
}
