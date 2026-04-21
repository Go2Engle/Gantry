import { useState, useEffect, useMemo, useRef } from 'react';
import { ChevronDown, ChevronRight, Terminal, X, RefreshCw, Search } from 'lucide-react';
import { api } from '../lib/api';
import type { Entity, K8sWorkloadInfo, K8sPodInfo, K8sContainerInfo } from '../lib/types';

interface LogTarget {
  namespace: string;
  pod: string;
  container: string;
  cluster?: string;
}

const PHASE_COLORS: Record<string, string> = {
  Running: 'text-green-600 dark:text-green-400',
  Succeeded: 'text-blue-600 dark:text-blue-400',
  Pending: 'text-yellow-600 dark:text-yellow-400',
  Failed: 'text-red-600 dark:text-red-400',
  Unknown: 'text-[var(--gantry-text-secondary)]',
};

const STATE_BADGE: Record<string, string> = {
  running: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  waiting: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  terminated: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  unknown: 'bg-[var(--gantry-bg-tertiary)] text-[var(--gantry-text-secondary)]',
};

function normalizeLogLine(line: string): string[] {
  // Drop CR from CRLF streams, unescape common JSON-escape sequences inside
  // structured log payloads, then split on real newlines so each visual line
  // becomes its own entry — this keeps search filtering and match counts
  // honest when a single k8s log line contains an embedded stack trace.
  const unescaped = line
    .replace(/\r$/, '')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, '\t');
  return unescaped.split('\n');
}

function formatAge(startTime?: string): string {
  if (!startTime) return '—';
  const ms = Date.now() - new Date(startTime).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightLine(line: string, query: string): React.ReactNode {
  if (!query) return line;
  const re = new RegExp(`(${escapeRegExp(query)})`, 'gi');
  const parts = line.split(re);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded bg-yellow-300 px-0.5 text-gray-900 dark:bg-yellow-500/40 dark:text-yellow-100">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function LogViewer({ target, onClose }: { target: LogTarget; onClose: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const filteredLines = useMemo(() => {
    if (!search) return lines;
    const q = search.toLowerCase();
    return lines.filter((l) => l.toLowerCase().includes(q));
  }, [lines, search]);

  const matchCount = useMemo(() => {
    if (!search) return 0;
    const re = new RegExp(escapeRegExp(search), 'gi');
    return lines.reduce((sum, l) => sum + (l.match(re)?.length ?? 0), 0);
  }, [lines, search]);

  function connect() {
    if (controllerRef.current) controllerRef.current.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLines([]);
    setError('');
    setConnected(true);

    api
      .streamKubernetesPodLogs(
        target.namespace,
        target.pod,
        target.container,
        target.cluster,
        controller.signal,
      )
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        function read() {
          reader
            .read()
            .then(({ done, value }) => {
              if (done) { setConnected(false); return; }
              buf += decoder.decode(value, { stream: true });
              const parts = buf.split('\n');
              buf = parts.pop() ?? '';
              const newLines = parts
                .flatMap(normalizeLogLine)
                .filter((l) => l !== '');
              if (newLines.length > 0) {
                setLines((prev) => [...prev, ...newLines].slice(-1000));
              }
              read();
            })
            .catch(() => setConnected(false));
        }
        read();
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
        setConnected(false);
      });
  }

  useEffect(() => {
    connect();
    return () => controllerRef.current?.abort();
  }, [target.namespace, target.pod, target.container, target.cluster]);

  useEffect(() => {
    // Only auto-scroll when not searching — otherwise it yanks the user
    // away from the match they're reading.
    if (search) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [filteredLines, search]);

  return (
    <div className="mt-4 w-full min-w-0 overflow-hidden rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
      {/* Log header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Terminal className="h-4 w-4 shrink-0 text-[var(--gantry-text-secondary)]" />
          <span className="truncate font-mono text-xs text-[var(--gantry-text-primary)]">
            {target.pod} / {target.container}
          </span>
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-[var(--gantry-text-secondary)]'}`}
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative flex items-center">
            <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-[var(--gantry-text-secondary)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setSearch('');
              }}
              placeholder="Search logs…"
              className="w-48 rounded border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] py-1 pl-7 pr-6 text-xs text-[var(--gantry-text-primary)] placeholder:text-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                title="Clear search"
                aria-label="Clear search"
                className="absolute right-1 rounded p-0.5 text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)]"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {search && (
            <span className="font-mono text-xs text-[var(--gantry-text-secondary)]">
              {matchCount} match{matchCount !== 1 ? 'es' : ''}
            </span>
          )}
          <button
            onClick={connect}
            title="Reconnect"
            aria-label="Reconnect log stream"
            className="rounded p-1 text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close log viewer"
            className="rounded p-1 text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {/* Log body */}
      <div className="h-72 w-full min-w-0 overflow-auto bg-[var(--gantry-bg-primary)] p-4 font-mono text-xs leading-5 text-[var(--gantry-text-primary)]">
        {error && <p className="text-[var(--gantry-danger)]">{error}</p>}
        {lines.length === 0 && !error && (
          <p className="text-[var(--gantry-text-secondary)]">
            {connected ? 'Waiting for logs…' : 'No logs.'}
          </p>
        )}
        {lines.length > 0 && search && filteredLines.length === 0 && (
          <p className="text-[var(--gantry-text-secondary)]">No matches for "{search}".</p>
        )}
        {filteredLines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-words">
            {highlightLine(line, search)}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function PodRow({ pod }: { pod: K8sPodInfo }) {
  const [expanded, setExpanded] = useState(false);
  const [logTarget, setLogTarget] = useState<LogTarget | null>(null);

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-[var(--gantry-bg-secondary)]"
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="px-4 py-3">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-[var(--gantry-text-secondary)]" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-[var(--gantry-text-secondary)]" />
          )}
        </td>
        <td className="px-4 py-3 font-mono text-xs text-[var(--gantry-text-primary)]">{pod.name}</td>
        <td className="px-4 py-3 text-xs text-[var(--gantry-text-secondary)]">{pod.namespace}</td>
        <td className="px-4 py-3">
          <span className={`text-xs font-medium ${PHASE_COLORS[pod.phase] ?? PHASE_COLORS.Unknown}`}>
            {pod.phase}
          </span>
        </td>
        <td className="px-4 py-3 text-xs text-[var(--gantry-text-secondary)]">
          {pod.containers.filter((c) => c.ready).length}/{pod.containers.length}
        </td>
        <td className="px-4 py-3 text-xs text-[var(--gantry-text-secondary)]">{pod.totalRestarts}</td>
        <td className="px-4 py-3 text-xs text-[var(--gantry-text-secondary)]">{formatAge(pod.startTime)}</td>
      </tr>
      {expanded && (
        <tr>
          <td
            colSpan={7}
            className="bg-[var(--gantry-bg-secondary)] px-8 pb-4 pt-2"
            style={{ maxWidth: 0 }}
          >
            <div className="min-w-0 space-y-2 overflow-hidden">
              {pod.nodeName && (
                <p className="text-xs text-[var(--gantry-text-secondary)]">
                  Node: <span className="font-mono text-[var(--gantry-text-primary)]">{pod.nodeName}</span>
                </p>
              )}
              <div className="space-y-1.5">
                {pod.containers.map((c: K8sContainerInfo) => (
                  <div
                    key={c.name}
                    className="flex min-w-0 items-center gap-3 rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-3 py-2"
                  >
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATE_BADGE[c.state] ?? STATE_BADGE.unknown}`}
                    >
                      {c.state}
                      {c.reason ? ` (${c.reason})` : ''}
                    </span>
                    <span className="shrink-0 text-xs font-medium text-[var(--gantry-text-primary)]">{c.name}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--gantry-text-secondary)]">{c.image}</span>
                    {c.restarts > 0 && (
                      <span className="shrink-0 text-xs text-yellow-600 dark:text-yellow-400">
                        {c.restarts} restart{c.restarts !== 1 ? 's' : ''}
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setLogTarget(
                          logTarget?.container === c.name ? null : { namespace: pod.namespace, pod: pod.name, container: c.name, cluster: pod.clusterName }
                        );
                      }}
                      className="flex shrink-0 items-center gap-1 rounded border border-[var(--gantry-border)] px-2 py-0.5 text-xs text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)]"
                    >
                      <Terminal className="h-3 w-3" /> Logs
                    </button>
                  </div>
                ))}
              </div>
              {logTarget && (
                <LogViewer target={logTarget} onClose={() => setLogTarget(null)} />
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function KubernetesTab({ entity }: { entity: Entity }) {
  const [workload, setWorkload] = useState<K8sWorkloadInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // For Service entities, use deployedIn environments as namespace hints.
  // For Infrastructure entities (k8s Services), look up workload via the backing Service from dependsOn.
  const isInfrastructure = entity.kind === 'Infrastructure';
  const appName: string = isInfrastructure
    ? ((entity.spec?.dependsOn as any[])?.[0]?.name ?? entity.metadata.name)
    : entity.metadata.name;

  // Namespace hints for the K8s workload query.
  // Service: from spec.deployedIn; Infrastructure: from the kubernetes.io/namespace annotation.
  const namespaces: string[] = isInfrastructure
    ? (entity.metadata.annotations?.['kubernetes.io/namespace']
        ? [entity.metadata.annotations['kubernetes.io/namespace']]
        : [])
    : ((entity.spec?.deployedIn as any[]) ?? [])
        .filter((d: any) => d?.kind === 'Environment')
        .map((d: any) => d.name as string);

  useEffect(() => {
    setLoading(true);
    api
      .getKubernetesWorkload(appName, namespaces)
      .then(setWorkload)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [appName]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-[var(--gantry-accent)] border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
        {error}
      </div>
    );
  }

  if (!workload) return null;

  const hasPods = workload.pods.length > 0;

  return (
    <div className="space-y-6">
      {/* Deployments summary */}
      {workload.deployments.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-[var(--gantry-text-primary)]">Deployments</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {workload.deployments.map((dep) => (
              <div
                key={`${dep.namespace}/${dep.name}`}
                className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[var(--gantry-text-primary)]">{dep.name}</span>
                  <span className="rounded-full bg-[var(--gantry-bg-tertiary)] px-2 py-0.5 text-xs text-[var(--gantry-text-secondary)]">
                    {dep.namespace}
                  </span>
                </div>
                <div className="mt-3 flex items-end gap-1">
                  <span
                    className={`text-2xl font-bold ${
                      dep.readyReplicas === dep.desiredReplicas && dep.desiredReplicas > 0
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-yellow-600 dark:text-yellow-400'
                    }`}
                  >
                    {dep.readyReplicas}
                  </span>
                  <span className="mb-1 text-sm text-[var(--gantry-text-secondary)]">
                    / {dep.desiredReplicas} ready
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pods table */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-[var(--gantry-text-primary)]">
          Pods
          {hasPods && (
            <span className="ml-2 text-xs font-normal text-[var(--gantry-text-secondary)]">
              — click a row to expand containers and view logs
            </span>
          )}
        </h3>
        {!hasPods ? (
          <p className="text-sm text-[var(--gantry-text-secondary)]">No pods found.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
            <table className="min-w-full divide-y divide-[var(--gantry-border)]">
              <thead>
                <tr className="bg-[var(--gantry-bg-secondary)]">
                  <th className="w-8 px-4 py-3" />
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Pod</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Namespace</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Ready</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Restarts</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Age</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--gantry-border)]">
                {workload.pods.map((pod) => (
                  <PodRow key={`${pod.namespace}/${pod.name}`} pod={pod} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
