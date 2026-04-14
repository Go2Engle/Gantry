import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  RefreshCw,
  Search,
  Loader2,
  AlertCircle,
  Server,
  Globe,
  Database,
  Users,
  Cloud,
  FileText,
  Box,
  Zap,
  Network,
  ExternalLink,
  X,
  ArrowRight,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { api } from '../lib/api';
import type {
  TopologyData,
  TopologyNode,
  TopologyEdge,
  TopologyEnvironment,
  TopologyStatusMap,
} from '../lib/types';

// ─── Constants ───────────────────────────────────────────────────────────────

const KIND_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  Service: Server,
  API: Globe,
  Infrastructure: Database,
  Team: Users,
  Environment: Cloud,
  Documentation: FileText,
  Action: Zap,
};

const KIND_COLOR: Record<string, string> = {
  Service: 'bg-blue-500',
  API: 'bg-violet-500',
  Infrastructure: 'bg-amber-500',
  Team: 'bg-emerald-500',
  Environment: 'bg-cyan-500',
  Documentation: 'bg-indigo-500',
  Action: 'bg-red-500',
};

const KIND_COLOR_LIGHT: Record<string, string> = {
  Service: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  API: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  Infrastructure: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  Team: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  Environment: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  Documentation: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  Action: 'bg-red-500/10 text-red-600 dark:text-red-400',
};

const STATUS_DOT: Record<string, string> = {
  operational: 'bg-green-500',
  degraded: 'bg-yellow-500',
  partial: 'bg-orange-500',
  major: 'bg-red-500',
  maintenance: 'bg-blue-500',
  unknown: 'bg-gray-400',
};

const STATUS_LABEL: Record<string, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  partial: 'Partial Outage',
  major: 'Major Outage',
  maintenance: 'Maintenance',
  unknown: 'Unknown',
};

const ENV_TYPE_BADGE: Record<string, string> = {
  production: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
  staging: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20',
  development: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20',
};

const RELATION_LABEL: Record<string, string> = {
  dependsOn: 'depends on',
  deployedIn: 'deployed in',
  providesApi: 'provides',
  consumesApi: 'consumes',
  ownedBy: 'owned by',
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function TopologyExplorer() {
  const [data, setData] = useState<TopologyData | null>(null);
  const [statuses, setStatuses] = useState<TopologyStatusMap>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<string[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [laneOrder, setLaneOrder] = useState<string[]>([]);
  const [hideUnassigned, setHideUnassigned] = useState(false);

  const fetchData = useCallback(
    async (showRefresh = false) => {
      if (showRefresh) setRefreshing(true);
      try {
        const [topoData, topoStatus] = await Promise.all([
          api.getTopologyData(),
          api.getTopologyStatus(),
        ]);
        setData(topoData);
        setStatuses(topoStatus);
        setError('');
      } catch (err: any) {
        setError(err.message || 'Failed to fetch topology data');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const load = async () => {
      await fetchData();

      try {
        const cfg = await api.getPluginConfig('topology-explorer');
        const order = cfg?.values?.laneOrder;
        if (Array.isArray(order)) setLaneOrder(order);
        setHideUnassigned(Boolean(cfg?.values?.hideUnassigned));

        const configuredRefreshInterval = cfg?.values?.refreshInterval;
        const refreshInterval =
          typeof configuredRefreshInterval === 'number' && configuredRefreshInterval >= 0
            ? configuredRefreshInterval * 1000
            : 30_000;

        if (refreshInterval > 0) {
          interval = setInterval(() => fetchData(), refreshInterval);
        }
      } catch {
        interval = setInterval(() => fetchData(), 30_000);
      }
    };

    void load();

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [fetchData]);

  // ── Derived data ──────────────────────────────────────────────────────────

  // Filter nodes (excluding Environment kind — those become columns)
  const filteredNodes = useMemo(() => {
    if (!data) return [];
    return data.nodes.filter((n) => {
      if (n.kind === 'Environment') return false;
      if (kindFilter.length > 0 && !kindFilter.includes(n.kind)) return false;
      if (
        search &&
        !n.name.toLowerCase().includes(search.toLowerCase()) &&
        !(n.title || '').toLowerCase().includes(search.toLowerCase())
      )
        return false;
      return true;
    });
  }, [data, kindFilter, search]);

  // Build a map: entityId -> list of environment names it's deployed in
  const entityEnvMap = useMemo(() => {
    if (!data) return new Map<string, string[]>();
    const m = new Map<string, string[]>();
    for (const e of data.edges) {
      if (e.relation === 'deployedIn') {
        const envName = e.to.replace('Environment/', '');
        const list = m.get(e.from) || [];
        list.push(envName);
        m.set(e.from, list);
      }
    }
    return m;
  }, [data]);

  // Group entities by environment (entities can appear in multiple)
  const envColumns = useMemo(() => {
    if (!data) return [];

    const sorted = [...data.environments].sort((a, b) => {
      // Use custom lane order if set, otherwise fall back to type-based ordering
      if (laneOrder.length > 0) {
        const aIdx = laneOrder.indexOf(a.name);
        const bIdx = laneOrder.indexOf(b.name);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
      } else {
        const envOrder = ['production', 'staging', 'development'];
        const aIdx = envOrder.indexOf(a.type || '');
        const bIdx = envOrder.indexOf(b.type || '');
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
      }
      return a.name.localeCompare(b.name);
    });

    return sorted.map((env) => ({
      env,
      nodes: filteredNodes.filter((n) => {
        const envs = entityEnvMap.get(n.id);
        return envs?.includes(env.name);
      }),
    }));
  }, [data, filteredNodes, entityEnvMap, laneOrder]);

  // Entities not deployed in any environment
  const unassignedNodes = useMemo(() => {
    return filteredNodes.filter((n) => {
      const envs = entityEnvMap.get(n.id);
      return !envs || envs.length === 0;
    });
  }, [filteredNodes, entityEnvMap]);

  // Non-deployment edges for the selected node
  const selectedEdges = useMemo(() => {
    if (!selectedNode || !data) return [];
    return data.edges.filter(
      (e) => (e.from === selectedNode || e.to === selectedNode) && e.relation !== 'deployedIn',
    );
  }, [selectedNode, data]);

  // Flat list of all nodes including children (for detail panel lookup)
  const allNodes = useMemo(() => {
    if (!data) return [];
    const flat: TopologyNode[] = [];
    for (const n of data.nodes) {
      flat.push(n);
      if (n.children) {
        for (const c of n.children) {
          flat.push(c);
        }
      }
    }
    return flat;
  }, [data]);

  // Available kinds to filter (excluding Environment)
  const availableKinds = useMemo(() => {
    if (!data) return [];
    const s = new Set(data.nodes.filter((n) => n.kind !== 'Environment').map((n) => n.kind));
    return Array.from(s).sort();
  }, [data]);

  const toggleKind = (k: string) => {
    setKindFilter((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  };

  // ── Loading / Error ───────────────────────────────────────────────────────

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
        <h2 className="text-lg font-semibold text-[var(--gantry-text-primary)]">Unable to load topology</h2>
        <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">{error}</p>
        <button
          onClick={() => {
            setLoading(true);
            setError('');
            fetchData();
          }}
          className="mt-4 rounded-lg bg-[var(--gantry-accent)] px-4 py-2 text-sm font-medium text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)]"
        >
          Retry
        </button>
      </div>
    );
  }

  const totalNodes = filteredNodes.length;
  const totalEdges = data?.edges.filter((e) => e.relation !== 'deployedIn').length || 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--gantry-text-primary)]">Topology Explorer</h1>
          <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">
            {totalNodes} entities &middot; {totalEdges} relationships &middot;{' '}
            {data?.environments.length || 0} environments
          </p>
        </div>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="flex items-center gap-2 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-4 py-2 text-sm font-medium text-[var(--gantry-text-primary)] transition-colors hover:border-[var(--gantry-accent)] hover:text-[var(--gantry-accent)] disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-4 py-3">
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--gantry-text-secondary)]" />
          <input
            type="text"
            placeholder="Search entities..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] py-2 pl-9 pr-3 text-sm text-[var(--gantry-text-primary)] placeholder:text-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {availableKinds.map((kind) => {
            const active = kindFilter.includes(kind);
            const Icon = KIND_ICON[kind] || Box;
            return (
              <button
                key={kind}
                onClick={() => toggleKind(kind)}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-[var(--gantry-accent)] text-[var(--gantry-bg-primary)]'
                    : 'border border-[var(--gantry-border)] text-[var(--gantry-text-secondary)] hover:border-[var(--gantry-accent)] hover:text-[var(--gantry-accent)]'
                }`}
              >
                <Icon className="h-3 w-3" />
                {kind}
              </button>
            );
          })}
        </div>
      </div>

      {/* Environment columns */}
      {(envColumns.length > 0 || unassignedNodes.length > 0) ? (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {envColumns.map(({ env, nodes }) => (
            <EnvironmentColumn
              key={env.name}
              env={env}
              nodes={nodes}
              statuses={statuses}
              selectedNode={selectedNode}
              onSelectNode={setSelectedNode}
              entityEnvMap={entityEnvMap}
            />
          ))}
          {unassignedNodes.length > 0 && !hideUnassigned && (
            <div className="flex w-72 shrink-0 flex-col rounded-xl border border-dashed border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
              <div className="border-b border-[var(--gantry-border)] px-4 py-3">
                <div className="flex items-center gap-2">
                  <Box className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
                  <h3 className="text-sm font-semibold text-[var(--gantry-text-primary)]">Unassigned</h3>
                </div>
                <p className="mt-0.5 text-xs text-[var(--gantry-text-secondary)]">
                  {unassignedNodes.length} {unassignedNodes.length === 1 ? 'entity' : 'entities'} not
                  deployed to any environment
                </p>
              </div>
              <div className="flex-1 space-y-0.5 overflow-y-auto p-2" style={{ maxHeight: 520 }}>
                {unassignedNodes.map((node) => (
                  <EntityCard
                    key={node.id}
                    node={node}
                    envName=""
                    statuses={statuses}
                    selectedNode={selectedNode}
                    onSelectNode={setSelectedNode}
                    entityEnvMap={entityEnvMap}
                    depth={0}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] py-16">
          <div className="text-center">
            <Network className="mx-auto mb-3 h-12 w-12 text-[var(--gantry-text-secondary)]" />
            <p className="text-sm font-medium text-[var(--gantry-text-primary)]">No entities found</p>
            <p className="mt-1 text-xs text-[var(--gantry-text-secondary)]">
              Create entities to visualize your topology
            </p>
          </div>
        </div>
      )}

      {/* Detail panel */}
      {selectedNode && data && (
        <DetailPanel
          nodeId={selectedNode}
          nodes={allNodes}
          edges={selectedEdges}
          statuses={statuses}
          entityEnvMap={entityEnvMap}
          environments={data.environments}
          onClose={() => setSelectedNode(null)}
        />
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-4 py-3">
        <span className="text-xs font-semibold text-[var(--gantry-text-secondary)]">Entity Types</span>
        <div className="flex flex-wrap gap-3">
          {availableKinds.map((kind) => (
            <div key={kind} className="flex items-center gap-1.5">
              <div className={`h-2 w-2 rounded-full ${KIND_COLOR[kind] || 'bg-gray-400'}`} />
              <span className="text-xs text-[var(--gantry-text-secondary)]">{kind}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Environment Column ──────────────────────────────────────────────────────

function EnvironmentColumn({
  env,
  nodes,
  statuses,
  selectedNode,
  onSelectNode,
  entityEnvMap,
}: {
  env: TopologyEnvironment;
  nodes: TopologyNode[];
  statuses: TopologyStatusMap;
  selectedNode: string | null;
  onSelectNode: (id: string | null) => void;
  entityEnvMap: Map<string, string[]>;
}) {
  // Group nodes by kind within the column
  const grouped = useMemo(() => {
    const m = new Map<string, TopologyNode[]>();
    const kindOrder = ['Service', 'API', 'Infrastructure', 'Documentation', 'Action', 'Team'];
    for (const n of nodes) {
      const arr = m.get(n.kind) || [];
      arr.push(n);
      m.set(n.kind, arr);
    }
    const result: { kind: string; nodes: TopologyNode[] }[] = [];
    for (const kind of kindOrder) {
      const arr = m.get(kind);
      if (arr) result.push({ kind, nodes: arr });
    }
    for (const [kind, arr] of m) {
      if (!kindOrder.includes(kind)) result.push({ kind, nodes: arr });
    }
    return result;
  }, [nodes]);

  const envTypeBadge = ENV_TYPE_BADGE[env.type || ''] || 'bg-[var(--gantry-bg-tertiary)] text-[var(--gantry-text-secondary)] border-[var(--gantry-border)]';

  return (
    <div className="flex w-80 shrink-0 flex-col rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
      {/* Column header */}
      <div className="border-b border-[var(--gantry-border)] px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cloud className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
            <h3 className="text-sm font-semibold text-[var(--gantry-text-primary)]">
              {env.title || env.name}
            </h3>
          </div>
          {env.type && (
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${envTypeBadge}`}>
              {env.type}
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-[var(--gantry-text-secondary)]">
          <span>{nodes.length} {nodes.length === 1 ? 'entity' : 'entities'}</span>
          {env.provider && (
            <>
              <span>&middot;</span>
              <span>{env.provider}</span>
            </>
          )}
          {env.region && (
            <>
              <span>&middot;</span>
              <span>{env.region}</span>
            </>
          )}
        </div>
      </div>

      {/* Entity list grouped by kind */}
      <div className="flex-1 overflow-y-auto p-2" style={{ maxHeight: 600 }}>
        {nodes.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-xs text-[var(--gantry-text-secondary)]">
            No matching entities
          </div>
        ) : (
          <div className="space-y-3">
            {grouped.map(({ kind, nodes: kindNodes }) => (
              <div key={kind}>
                <div className="mb-1 flex items-center gap-1.5 px-1">
                  <div className={`h-1.5 w-1.5 rounded-full ${KIND_COLOR[kind] || 'bg-gray-400'}`} />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--gantry-text-secondary)]">
                    {kind} ({kindNodes.length})
                  </span>
                </div>
                <div className="space-y-0.5">
                  {kindNodes.map((node) => (
                    <EntityCard
                      key={node.id}
                      node={node}
                      envName={env.name}
                      statuses={statuses}
                      selectedNode={selectedNode}
                      onSelectNode={onSelectNode}
                      entityEnvMap={entityEnvMap}
                      depth={0}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Entity Card (collapsible with children) ────────────────────────────────

function EntityCard({
  node,
  envName,
  statuses,
  selectedNode,
  onSelectNode,
  entityEnvMap,
  depth,
}: {
  node: TopologyNode;
  envName: string;
  statuses: TopologyStatusMap;
  selectedNode: string | null;
  onSelectNode: (id: string | null) => void;
  entityEnvMap: Map<string, string[]>;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);

  const Icon = KIND_ICON[node.kind] || Box;
  const iconStyle = KIND_COLOR_LIGHT[node.kind] || 'bg-gray-500/10 text-gray-600 dark:text-gray-400';
  const status = statuses[node.name];
  const statusDot = status ? STATUS_DOT[status.status] || STATUS_DOT.unknown : null;
  const statusTip = status ? STATUS_LABEL[status.status] || status.status : '';
  const selected = selectedNode === node.id;

  // Filter children to only those deployed in this environment
  const envChildren = useMemo(() => {
    if (!node.children || node.children.length === 0) return [];
    return node.children.filter((child) => {
      const childEnvs = entityEnvMap.get(child.id);
      return childEnvs?.includes(envName);
    });
  }, [node.children, envName, entityEnvMap]);

  const hasChildren = envChildren.length > 0;

  return (
    <div>
      <div
        className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
          selected
            ? 'bg-[var(--gantry-accent)]/10 ring-1 ring-[var(--gantry-accent)]'
            : 'hover:bg-[var(--gantry-bg-secondary)]'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {/* Expand/collapse chevron */}
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)]"
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* Clickable entity content */}
        <button
          onClick={() => onSelectNode(selected ? null : node.id)}
          className="flex min-w-0 flex-1 items-center gap-2"
        >
          <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${iconStyle}`}>
            <Icon className="h-3 w-3" />
          </div>
          <p className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--gantry-text-primary)]">
            {node.title || node.name}
          </p>
          {hasChildren && (
            <span className="shrink-0 rounded-full bg-[var(--gantry-bg-tertiary)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--gantry-text-secondary)]">
              {envChildren.length}
            </span>
          )}
          {statusDot && (
            <div className={`h-2 w-2 shrink-0 rounded-full ${statusDot}`} title={statusTip} />
          )}
        </button>
      </div>

      {/* Expanded children */}
      {expanded && hasChildren && (
        <div className="mt-0.5">
          {envChildren.map((child) => (
            <EntityCard
              key={child.id}
              node={child}
              envName={envName}
              statuses={statuses}
              selectedNode={selectedNode}
              onSelectNode={onSelectNode}
              entityEnvMap={entityEnvMap}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Detail Panel ────────────────────────────────────────────────────────────

function DetailPanel({
  nodeId,
  nodes,
  edges,
  statuses,
  entityEnvMap,
  environments,
  onClose,
}: {
  nodeId: string;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  statuses: TopologyStatusMap;
  entityEnvMap: Map<string, string[]>;
  environments: TopologyEnvironment[];
  onClose: () => void;
}) {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const inbound = edges.filter((e) => e.to === nodeId);
  const outbound = edges.filter((e) => e.from === nodeId);
  const status = statuses[node.name];
  const deployedEnvNames = entityEnvMap.get(nodeId) || [];
  const deployedEnvs = deployedEnvNames
    .map((name) => environments.find((e) => e.name === name))
    .filter(Boolean) as TopologyEnvironment[];
  const Icon = KIND_ICON[node.kind] || Box;
  const iconStyle = KIND_COLOR_LIGHT[node.kind] || 'bg-gray-500/10 text-gray-600 dark:text-gray-400';

  return (
    <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconStyle}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-[var(--gantry-text-primary)]">
              {node.title || node.name}
            </h3>
            <p className="text-xs text-[var(--gantry-text-secondary)]">
              {node.kind} &middot; {node.name}
              {node.owner && <> &middot; Owner: {node.owner}</>}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status && (
            <span className="flex items-center gap-1.5 rounded-full border border-[var(--gantry-border)] px-2.5 py-1 text-xs font-medium text-[var(--gantry-text-primary)]">
              <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status.status] || STATUS_DOT.unknown}`} />
              {STATUS_LABEL[status.status] || status.status}
            </span>
          )}
          <Link
            to={`/catalog/${node.kind}/${node.name}`}
            className="flex items-center gap-1 rounded-lg border border-[var(--gantry-border)] px-3 py-1.5 text-xs font-medium text-[var(--gantry-accent)] hover:bg-[var(--gantry-accent)]/10"
          >
            View <ExternalLink className="h-3 w-3" />
          </Link>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {node.description && (
        <p className="mt-3 text-sm text-[var(--gantry-text-secondary)]">{node.description}</p>
      )}

      {/* Environments */}
      {deployedEnvs.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-2 text-xs font-semibold text-[var(--gantry-text-secondary)]">
            Deployed In
          </h4>
          <div className="flex flex-wrap gap-2">
            {deployedEnvs.map((env) => {
              const badge =
                ENV_TYPE_BADGE[env.type || ''] ||
                'bg-[var(--gantry-bg-tertiary)] text-[var(--gantry-text-secondary)] border-[var(--gantry-border)]';
              return (
                <span
                  key={env.name}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${badge}`}
                >
                  <Cloud className="h-3 w-3" />
                  {env.title || env.name}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Relationships */}
      {(outbound.length > 0 || inbound.length > 0) && (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {outbound.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold text-[var(--gantry-text-secondary)]">
                Outbound ({outbound.length})
              </h4>
              <div className="space-y-1">
                {outbound.map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="shrink-0 font-medium text-[var(--gantry-text-primary)]">
                      {RELATION_LABEL[e.relation] || e.relation}
                    </span>
                    <ArrowRight className="h-3 w-3 shrink-0 text-[var(--gantry-text-secondary)]" />
                    <Link
                      to={`/catalog/${e.to}`}
                      className="truncate text-[var(--gantry-accent)] hover:underline"
                    >
                      {e.to}
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}
          {inbound.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold text-[var(--gantry-text-secondary)]">
                Inbound ({inbound.length})
              </h4>
              <div className="space-y-1">
                {inbound.map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <Link
                      to={`/catalog/${e.from}`}
                      className="truncate text-[var(--gantry-accent)] hover:underline"
                    >
                      {e.from}
                    </Link>
                    <ArrowRight className="h-3 w-3 shrink-0 text-[var(--gantry-text-secondary)]" />
                    <span className="shrink-0 font-medium text-[var(--gantry-text-primary)]">
                      {RELATION_LABEL[e.relation] || e.relation}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
