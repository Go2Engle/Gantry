import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Server,
  Globe,
  Database,
  Users,
  Cloud,
  FileText,
  Box,
  ArrowRight,
  BookOpen,
  Zap,
  Search,
  ClipboardList,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Pencil,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  Plus,
  Trash2,
  ExternalLink,
  Link as LinkIcon,
  LayoutDashboard,
  Book,
  Github,
  Slack,
  Bell,
  Activity,
  GitBranch,
  Package,
  Info,
  AlertTriangle,
  AlertCircle,
  Save,
  X,
  GripVertical,
  Network,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import type {
  Entity,
  AuditEntry,
  ActionRun,
  DashboardConfig,
  DashboardAnnouncement,
  DashboardQuickLink,
  DashboardPinnedEntity,
  DashboardWidgetConfig,
  DashboardSeverity,
  DashboardLinkIcon,
  HistoryEntry,
  StatusMonitorResult,
  GitOpsStatus,
  HarborSummaryResponse,
  TopologyData,
} from '../lib/types';
import { ENTITY_KINDS } from '../lib/types';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Server,
  Globe,
  Database,
  Users,
  Cloud,
  FileText,
  Network,
};

const LINK_ICON_MAP: Record<DashboardLinkIcon, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  docs: BookOpen,
  runbook: Book,
  github: Github,
  slack: Slack,
  alert: Bell,
  monitor: Activity,
  ci: GitBranch,
  other: LinkIcon,
};

const SEVERITY_ICON: Record<DashboardSeverity, React.ComponentType<{ className?: string }>> = {
  info: Info,
  warning: AlertTriangle,
  danger: AlertCircle,
};

const SEVERITY_STYLES: Record<DashboardSeverity, string> = {
  info: 'border-[var(--gantry-accent)] bg-[var(--gantry-accent)]/10',
  warning: 'border-yellow-400 bg-yellow-400/10',
  danger: 'border-[var(--gantry-danger)] bg-[var(--gantry-danger)]/10',
};

const SEVERITY_ICON_STYLES: Record<DashboardSeverity, string> = {
  info: 'text-[var(--gantry-accent)]',
  warning: 'text-yellow-500',
  danger: 'text-[var(--gantry-danger)]',
};

const WIDGET_LABELS: Record<string, string> = {
  entity_stats: 'Entity Stats',
  quick_links: 'Quick Links',
  pinned_entities: 'Pinned Entities',
  status_monitor: 'Status Monitor',
  recent_activity: 'Recent Activity',
  action_runs: 'Action Runs',
  my_entities: 'My Entities',
  recently_updated: 'Recently Updated',
  recently_browsed: 'Recently Browsed',
  gitops_status: 'GitOps Status',
  harbor_vulns: 'Harbor Vulnerabilities',
  topology_overview: 'Topology Overview',
};

const DEFAULT_WIDGETS: DashboardWidgetConfig[] = [
  { id: 'entity_stats', visible: true, order: 0, width: 'full' },
  { id: 'quick_links', visible: true, order: 1, width: 'full' },
  { id: 'pinned_entities', visible: true, order: 2, width: 'full' },
  { id: 'status_monitor', visible: true, order: 3, width: 'full' },
  { id: 'recent_activity', visible: true, order: 4, width: 'half' },
  { id: 'action_runs', visible: true, order: 5, width: 'half' },
  { id: 'my_entities', visible: true, order: 6, width: 'half' },
  { id: 'recently_updated', visible: true, order: 7, width: 'half' },
  { id: 'recently_browsed', visible: true, order: 8, width: 'half' },
  { id: 'gitops_status', visible: true, order: 9, width: 'half' },
  { id: 'harbor_vulns', visible: true, order: 10, width: 'half' },
  { id: 'topology_overview', visible: true, order: 11, width: 'half' },
];

interface KindCount {
  name: string;
  plural: string;
  icon: string;
  count: number;
}

const ACTION_DOT: Record<string, string> = {
  'entity.created': 'bg-green-500',
  'entity.updated': 'bg-blue-500',
  'entity.deleted': 'bg-red-500',
};

const RUN_STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <Clock className="h-4 w-4 text-yellow-500" />,
  running: <Loader2 className="h-4 w-4 animate-spin text-[var(--gantry-accent)]" />,
  success: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  failed: <XCircle className="h-4 w-4 text-[var(--gantry-danger)]" />,
};

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

function newId(): string {
  return crypto.randomUUID();
}

function widthOf(w: DashboardWidgetConfig): 'full' | 'half' {
  return w.width === 'half' ? 'half' : 'full';
}

function StatusMonitorWidgetSkeleton() {
  return (
    <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
      <div className="flex items-center justify-between border-b border-[var(--gantry-border)] px-6 py-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
          <h2 className="text-base font-semibold text-[var(--gantry-text-primary)]">Service Status</h2>
        </div>
        <span className="text-sm text-[var(--gantry-text-secondary)]">Loading...</span>
      </div>
      <div className="space-y-3 px-6 py-4 animate-pulse">
        <div className="h-4 w-44 rounded bg-[var(--gantry-bg-secondary)]" />
        <div className="space-y-2">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-3">
              <div className="h-2.5 w-2.5 rounded-full bg-[var(--gantry-bg-tertiary)]" />
              <div className="h-3.5 flex-1 rounded bg-[var(--gantry-bg-secondary)]" />
              <div className="h-5 w-24 rounded bg-[var(--gantry-bg-secondary)]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EntityPicker: searchable dropdown for pinned entity selection
// ---------------------------------------------------------------------------

function EntityPicker({
  kind,
  value,
  entities,
  onChange,
}: {
  kind: string;
  value: string;
  entities: Entity[];
  onChange: (name: string) => void;
}) {
  const [search, setSearch] = useState(value);
  const [open, setOpen] = useState(false);

  // Sync input when value or kind changes externally.
  useEffect(() => {
    setSearch(value);
  }, [value, kind]);

  const matches = entities
    .filter(
      (e) =>
        e.kind === kind &&
        (search === '' ||
          e.metadata.name.toLowerCase().includes(search.toLowerCase()) ||
          (e.metadata.title ?? '').toLowerCase().includes(search.toLowerCase()))
    )
    .slice(0, 8);

  return (
    <div className="relative flex-1">
      <input
        type="text"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
          if (e.target.value === '') onChange('');
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search entity name..."
        className="w-full rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-1.5 text-sm text-[var(--gantry-text-primary)] placeholder:text-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
      />
      {open && matches.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] shadow-lg">
          {matches.map((e) => (
            <button
              key={e.metadata.name}
              type="button"
              onMouseDown={() => {
                onChange(e.metadata.name);
                setSearch(e.metadata.name);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--gantry-bg-secondary)]"
            >
              <span className="font-medium text-[var(--gantry-text-primary)]">{e.metadata.name}</span>
              {e.metadata.title && (
                <span className="truncate text-[var(--gantry-text-secondary)]">{e.metadata.title}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit-mode helpers
// ---------------------------------------------------------------------------

function EditSectionHeader({ title, onAdd, addLabel }: { title: string; onAdd: () => void; addLabel: string }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold text-[var(--gantry-text-primary)]">{title}</h3>
      <button
        onClick={onAdd}
        className="flex items-center gap-1 rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-2 py-1 text-xs text-[var(--gantry-text-secondary)] transition-colors hover:border-[var(--gantry-accent)] hover:text-[var(--gantry-accent)]"
      >
        <Plus className="h-3 w-3" /> {addLabel}
      </button>
    </div>
  );
}

function inputCls(extra = '') {
  return `w-full rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-1.5 text-sm text-[var(--gantry-text-primary)] placeholder:text-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none ${extra}`;
}

function selectCls() {
  return `rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-1.5 text-sm text-[var(--gantry-text-primary)] focus:border-[var(--gantry-accent)] focus:outline-none`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Dashboard() {
  const { user } = useAuth();
  const isAdmin = user?.permissions?.admin ?? false;

  const [entities, setEntities] = useState<Entity[]>([]);
  const [activity, setActivity] = useState<AuditEntry[]>([]);
  const [actionRuns, setActionRuns] = useState<ActionRun[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [statusMonitor, setStatusMonitor] = useState<StatusMonitorResult[]>([]);
  const [statusMonitorLoading, setStatusMonitorLoading] = useState(true);
  const [gitopsStatus, setGitopsStatus] = useState<GitOpsStatus | null>(null);
  const [harborSummary, setHarborSummary] = useState<HarborSummaryResponse | null>(null);
  const [topologyData, setTopologyData] = useState<TopologyData | null>(null);
  const [config, setConfig] = useState<DashboardConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Edit mode state
  const [editMode, setEditMode] = useState(false);
  const [editConfig, setEditConfig] = useState<DashboardConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Drag-and-drop state
  // Refs are used for synchronous cross-event reads; state drives re-renders for visual feedback.
  const dragSectionRef = useRef<string | null>(null);
  const dragFromIdxRef = useRef<number | null>(null);
  const [dragSection, setDragSection] = useState<string | null>(null);
  const [dragFromIdx, setDragFromIdx] = useState<number | null>(null);
  const [dragToIdx, setDragToIdx] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      api.listEntities(),
      api.listAuditEntries(5, 0).catch(() => [] as AuditEntry[]),
      api.listAllActionRuns(5).catch(() => [] as ActionRun[]),
      api.getDashboardConfig().catch(() => null),
      api.getHistory(5).catch(() => [] as HistoryEntry[]),
      api.getGitOpsStatus().catch(() => null as GitOpsStatus | null),
    ])
      .then(([ents, audit, runs, cfg, hist, gops]) => {
        setEntities(ents || []);
        setActivity(audit || []);
        setActionRuns(runs || []);
        setHistory(hist || []);
        setGitopsStatus(gops || null);
        setConfig(cfg || { announcements: [], quickLinks: [], pinnedEntities: [], widgets: DEFAULT_WIDGETS });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading) return;

    let cancelled = false;
    setStatusMonitorLoading(true);

    api.getStatusMonitorStatuses()
      .then((statuses) => {
        if (!cancelled) {
          setStatusMonitor(statuses || []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatusMonitor([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setStatusMonitorLoading(false);
        }
      });

    api.getHarborSummary()
      .then((s) => { if (!cancelled) setHarborSummary(s); })
      .catch(() => { if (!cancelled) setHarborSummary(null); });

    api.getTopologyData()
      .then((d) => { if (!cancelled) setTopologyData(d); })
      .catch(() => { if (!cancelled) setTopologyData(null); });

    return () => {
      cancelled = true;
    };
  }, [loading]);

  const kindCounts: KindCount[] = ENTITY_KINDS.map((k) => ({
    ...k,
    count: entities.filter((e) => e.kind === k.name).length,
  }));

  const totalEntities = entities.length;

  const recentEntities = [...entities]
    .sort((a, b) => {
      const aDate = a.metadata.updatedAt || a.metadata.createdAt || '';
      const bDate = b.metadata.updatedAt || b.metadata.createdAt || '';
      return bDate.localeCompare(aDate);
    })
    .slice(0, 5);

  const myEntities = user
    ? entities.filter((e) => e.metadata.owner === user.username).slice(0, 5)
    : [];

  // Merge saved widgets with defaults so newly added widgets appear automatically.
  function mergeWidgets(saved: DashboardWidgetConfig[] | undefined): DashboardWidgetConfig[] {
    if (!saved || saved.length === 0) return DEFAULT_WIDGETS;
    const ids = new Set(saved.map((w) => w.id));
    const maxOrder = Math.max(...saved.map((w) => w.order), 0);
    const missing = DEFAULT_WIDGETS.filter((d) => !ids.has(d.id)).map((d, i) => ({ ...d, order: maxOrder + 1 + i }));
    return [...saved, ...missing];
  }

  // Sorted visible widgets for view mode
  const visibleWidgets = mergeWidgets(config?.widgets)
    .filter((w) => w.visible)
    .sort((a, b) => a.order - b.order);

  // Plugin widgets that should only appear when data is available (plugin enabled).
  const pluginWidgetAvailable: Record<string, boolean> = {
    status_monitor: statusMonitor.length > 0,
    gitops_status: gitopsStatus !== null,
    harbor_vulns: harborSummary !== null,
  };

  // Sorted all widgets for edit mode — use editConfig.widgets directly
  // (enterEditMode pre-merges so editConfig always has the full list).
  // Hide plugin widgets when their plugin is not enabled.
  const sortedEditWidgets = (editConfig?.widgets ?? DEFAULT_WIDGETS)
    .slice()
    .filter((w) => !(w.id in pluginWidgetAvailable) || pluginWidgetAvailable[w.id])
    .sort((a, b) => a.order - b.order);

  function enterEditMode() {
    const clone: DashboardConfig = JSON.parse(JSON.stringify(config));
    clone.widgets = mergeWidgets(clone.widgets);
    setEditConfig(clone);
    setSaveError('');
    setEditMode(true);
  }

  function cancelEdit() {
    setEditConfig(null);
    setSaveError('');
    setEditMode(false);
  }

  async function saveEdit() {
    if (!editConfig) return;
    setSaving(true);
    setSaveError('');
    try {
      const saved = await api.setDashboardConfig(editConfig);
      setConfig(saved);
      setEditMode(false);
      setEditConfig(null);
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  // Widget edit helpers
  function toggleWidgetVisible(id: string) {
    if (!editConfig) return;
    setEditConfig({
      ...editConfig,
      widgets: editConfig.widgets.map((w) => (w.id === id ? { ...w, visible: !w.visible } : w)),
    });
  }

  function toggleWidgetWidth(id: string) {
    if (!editConfig) return;
    setEditConfig({
      ...editConfig,
      widgets: editConfig.widgets.map((w) =>
        w.id === id ? { ...w, width: widthOf(w) === 'half' ? 'full' : 'half' } : w
      ),
    });
  }

  function moveWidget(id: string, direction: 'up' | 'down') {
    if (!editConfig) return;
    const sorted = editConfig.widgets.slice().sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((w) => w.id === id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const newOrder = sorted[swapIdx].order;
    const oldOrder = sorted[idx].order;
    setEditConfig({
      ...editConfig,
      widgets: editConfig.widgets.map((w) => {
        if (w.id === sorted[idx].id) return { ...w, order: newOrder };
        if (w.id === sorted[swapIdx].id) return { ...w, order: oldOrder };
        return w;
      }),
    });
  }

  // Announcement edit helpers
  function addAnnouncement() {
    if (!editConfig) return;
    const a: DashboardAnnouncement = { id: newId(), title: '', body: '', severity: 'info' };
    setEditConfig({ ...editConfig, announcements: [...editConfig.announcements, a] });
  }
  function updateAnnouncement(id: string, patch: Partial<DashboardAnnouncement>) {
    if (!editConfig) return;
    setEditConfig({
      ...editConfig,
      announcements: editConfig.announcements.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    });
  }
  function removeAnnouncement(id: string) {
    if (!editConfig) return;
    setEditConfig({ ...editConfig, announcements: editConfig.announcements.filter((a) => a.id !== id) });
  }

  // Quick link edit helpers
  function addQuickLink() {
    if (!editConfig) return;
    const l: DashboardQuickLink = { id: newId(), title: '', url: '', icon: 'other' };
    setEditConfig({ ...editConfig, quickLinks: [...editConfig.quickLinks, l] });
  }
  function updateQuickLink(id: string, patch: Partial<DashboardQuickLink>) {
    if (!editConfig) return;
    setEditConfig({
      ...editConfig,
      quickLinks: editConfig.quickLinks.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    });
  }
  function removeQuickLink(id: string) {
    if (!editConfig) return;
    setEditConfig({ ...editConfig, quickLinks: editConfig.quickLinks.filter((l) => l.id !== id) });
  }

  // Pinned entity edit helpers
  function addPinnedEntity() {
    if (!editConfig) return;
    const p: DashboardPinnedEntity = { id: newId(), kind: 'Service', name: '' };
    setEditConfig({ ...editConfig, pinnedEntities: [...editConfig.pinnedEntities, p] });
  }
  function updatePinnedEntity(id: string, patch: Partial<DashboardPinnedEntity>) {
    if (!editConfig) return;
    setEditConfig({
      ...editConfig,
      pinnedEntities: editConfig.pinnedEntities.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });
  }
  function removePinnedEntity(id: string) {
    if (!editConfig) return;
    setEditConfig({ ...editConfig, pinnedEntities: editConfig.pinnedEntities.filter((p) => p.id !== id) });
  }

  // ---------------------------------------------------------------------------
  // Drag-and-drop helpers
  // ---------------------------------------------------------------------------

  function reorderArr<T>(arr: T[], from: number, to: number): T[] {
    const r = [...arr];
    const [item] = r.splice(from, 1);
    r.splice(to, 0, item);
    return r;
  }

  function onDragStart(e: React.DragEvent, section: string, idx: number) {
    e.dataTransfer.effectAllowed = 'move';
    dragSectionRef.current = section;
    dragFromIdxRef.current = idx;
    setDragSection(section);
    setDragFromIdx(idx);
    setDragToIdx(idx);
  }

  function onDragOver(e: React.DragEvent, section: string, idx: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragSectionRef.current !== section) return;
    setDragToIdx(idx);
  }

  function onDrop(section: string, toIdx: number) {
    if (dragSectionRef.current !== section || dragFromIdxRef.current === null || !editConfig) return;
    const from = dragFromIdxRef.current;
    dragSectionRef.current = null;
    dragFromIdxRef.current = null;
    setDragSection(null);
    setDragFromIdx(null);
    setDragToIdx(null);
    if (from === toIdx) return;

    if (section === 'quickLinks') {
      setEditConfig({ ...editConfig, quickLinks: reorderArr(editConfig.quickLinks, from, toIdx) });
    } else if (section === 'pinnedEntities') {
      setEditConfig({ ...editConfig, pinnedEntities: reorderArr(editConfig.pinnedEntities, from, toIdx) });
    } else if (section === 'widgets') {
      const sorted = editConfig.widgets.slice().sort((a, b) => a.order - b.order);
      const reordered = reorderArr(sorted, from, toIdx).map((w, i) => ({ ...w, order: i }));
      setEditConfig({ ...editConfig, widgets: reordered });
    }
  }

  function onDragEnd(e: React.DragEvent) {
    (e.currentTarget as HTMLElement).draggable = false;
    dragSectionRef.current = null;
    dragFromIdxRef.current = null;
    setDragSection(null);
    setDragFromIdx(null);
    setDragToIdx(null);
  }

  function dragRowCls(section: string, idx: number): string {
    const isDragging = dragSection === section && dragFromIdx === idx;
    const isOver = dragSection === section && dragToIdx === idx && dragFromIdx !== idx;
    return `${isDragging ? 'opacity-40' : ''} ${isOver ? 'ring-1 ring-[var(--gantry-accent)]' : ''}`;
  }

  // ---------------------------------------------------------------------------
  // Widget renderers (view mode) — accept width to adapt inner layout
  // ---------------------------------------------------------------------------

  function renderWidget(id: string, width: 'full' | 'half' = 'full') {
    switch (id) {
      case 'entity_stats':
        return (
          <div className={`grid gap-4 ${width === 'half' ? 'grid-cols-2 md:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6'}`}>
            {kindCounts.map((kind) => {
              const Icon = iconMap[kind.icon] || Box;
              return (
                <Link
                  key={kind.name}
                  to={`/catalog/${kind.name}`}
                  className="group rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-4 transition-all hover:shadow-md"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--gantry-accent)]/10">
                      <Icon className="h-5 w-5 text-[var(--gantry-accent)]" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-[var(--gantry-text-primary)]">{kind.count}</p>
                      <p className="text-xs text-[var(--gantry-text-secondary)]">{kind.name}s</p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        );

      case 'recent_activity':
        return (
          <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
            <div className="flex items-center justify-between border-b border-[var(--gantry-border)] px-6 py-4">
              <div className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
                <h2 className="text-base font-semibold text-[var(--gantry-text-primary)]">Recent Activity</h2>
              </div>
              <Link to="/admin/audit" className="flex items-center gap-1 text-sm text-[var(--gantry-accent)] hover:opacity-75">
                View all <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            {activity.length === 0 ? (
              <p className="px-6 py-4 text-sm text-[var(--gantry-text-secondary)]">No recent activity.</p>
            ) : (
              <div className="divide-y divide-[var(--gantry-border)]">
                {activity.map((entry) => (
                  <div key={entry.id} className="flex items-center gap-3 px-6 py-3">
                    <div className={`h-2 w-2 shrink-0 rounded-full ${ACTION_DOT[entry.action] ?? 'bg-[var(--gantry-text-secondary)]'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-[var(--gantry-text-primary)]">
                        {entry.resourceType && entry.resourceName
                          ? `${entry.resourceType}/${entry.resourceName}`
                          : entry.action}
                      </p>
                      <p className="text-xs text-[var(--gantry-text-secondary)]">
                        {entry.action}{entry.userName ? ` by ${entry.userName}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-[var(--gantry-text-secondary)]">
                      {relativeTime(entry.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      case 'action_runs':
        return (
          <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
            <div className="flex items-center justify-between border-b border-[var(--gantry-border)] px-6 py-4">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
                <h2 className="text-base font-semibold text-[var(--gantry-text-primary)]">Action Runs</h2>
              </div>
              <Link to="/actions" className="flex items-center gap-1 text-sm text-[var(--gantry-accent)] hover:opacity-75">
                Go to Actions <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            {actionRuns.length === 0 ? (
              <p className="px-6 py-4 text-sm text-[var(--gantry-text-secondary)]">No action runs yet.</p>
            ) : (
              <div className="divide-y divide-[var(--gantry-border)]">
                {actionRuns.map((run) => (
                  <div key={run.id} className="flex items-center gap-3 px-6 py-3">
                    {RUN_STATUS_ICON[run.status] ?? RUN_STATUS_ICON.pending}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--gantry-text-primary)]">{run.actionName}</p>
                      <p className="truncate text-xs text-[var(--gantry-text-secondary)]">
                        {run.triggeredBy ? `by ${run.triggeredBy}` : 'system'}
                        {run.error ? ` — ${run.error}` : ''}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      run.status === 'success' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                      run.status === 'failed'  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                      run.status === 'running' ? 'bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]' :
                      'bg-[var(--gantry-bg-tertiary)] text-[var(--gantry-text-secondary)]'
                    }`}>
                      {run.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      case 'my_entities':
        return myEntities.length > 0 ? (
          <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
            <div className="border-b border-[var(--gantry-border)] px-6 py-4">
              <h2 className="text-base font-semibold text-[var(--gantry-text-primary)]">My Entities</h2>
              <p className="mt-0.5 text-xs text-[var(--gantry-text-secondary)]">Owned by {user?.username}</p>
            </div>
            <div className="divide-y divide-[var(--gantry-border)]">
              {myEntities.map((entity) => {
                const Icon = iconMap[ENTITY_KINDS.find((k) => k.name === entity.kind)?.icon || ''] || Box;
                return (
                  <Link
                    key={`${entity.kind}-${entity.metadata.name}`}
                    to={`/catalog/${entity.kind}/${entity.metadata.name}${entity.metadata.namespace && entity.metadata.namespace !== 'default' ? `?namespace=${encodeURIComponent(entity.metadata.namespace)}` : ''}`}
                    className="flex items-center gap-4 px-6 py-3 transition-colors hover:bg-[var(--gantry-bg-secondary)]"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-[var(--gantry-text-secondary)]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--gantry-text-primary)]">
                        {entity.metadata.title || entity.metadata.name}
                      </p>
                      <p className="text-xs text-[var(--gantry-text-secondary)]">{entity.kind}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ) : null;

      case 'recently_updated':
        return recentEntities.length > 0 ? (
          <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
            <div className="flex items-center justify-between border-b border-[var(--gantry-border)] px-6 py-4">
              <h2 className="text-base font-semibold text-[var(--gantry-text-primary)]">Recently Updated</h2>
              <Link to="/catalog" className="flex items-center gap-1 text-sm text-[var(--gantry-accent)] hover:opacity-75">
                View all <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="divide-y divide-[var(--gantry-border)]">
              {recentEntities.map((entity) => {
                const Icon = iconMap[ENTITY_KINDS.find((k) => k.name === entity.kind)?.icon || ''] || Box;
                return (
                  <Link
                    key={`${entity.kind}-${entity.metadata.name}`}
                    to={`/catalog/${entity.kind}/${entity.metadata.name}${entity.metadata.namespace && entity.metadata.namespace !== 'default' ? `?namespace=${encodeURIComponent(entity.metadata.namespace)}` : ''}`}
                    className="flex items-center gap-4 px-6 py-3 transition-colors hover:bg-[var(--gantry-bg-secondary)]"
                  >
                    <Icon className="h-5 w-5 shrink-0 text-[var(--gantry-text-secondary)]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--gantry-text-primary)]">
                        {entity.metadata.name}
                      </p>
                      <p className="text-xs text-[var(--gantry-text-secondary)]">
                        {entity.kind}{entity.metadata.owner ? ` / ${entity.metadata.owner}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-[var(--gantry-text-secondary)]">
                      {formatDate(entity.metadata.updatedAt || entity.metadata.createdAt)}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        ) : null;

      case 'quick_links': {
        const links = config?.quickLinks ?? [];
        if (links.length === 0) return null;
        return (
          <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-4">
            <h2 className="mb-3 text-sm font-semibold text-[var(--gantry-text-secondary)]">Quick Links</h2>
            <div className="flex flex-wrap gap-2">
              {links.map((l) => {
                const Icon = LINK_ICON_MAP[l.icon] || LinkIcon;
                return (
                  <a
                    key={l.id}
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] transition-colors hover:border-[var(--gantry-accent)] hover:text-[var(--gantry-accent)]"
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {l.title}
                    <ExternalLink className="h-3 w-3 shrink-0 text-[var(--gantry-text-secondary)]" />
                  </a>
                );
              })}
            </div>
          </div>
        );
      }

      case 'pinned_entities': {
        const pinned = config?.pinnedEntities ?? [];
        if (pinned.length === 0) return null;
        return (
          <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-4">
            <h2 className="mb-3 text-sm font-semibold text-[var(--gantry-text-secondary)]">Pinned Entities</h2>
            <div className="flex flex-wrap gap-2">
              {pinned.map((p) => {
                const Icon = iconMap[ENTITY_KINDS.find((k) => k.name === p.kind)?.icon || ''] || Box;
                return (
                  <Link
                    key={p.id}
                    to={`/catalog/${p.kind}/${p.name}`}
                    className="flex items-center gap-1.5 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] transition-colors hover:border-[var(--gantry-accent)] hover:text-[var(--gantry-accent)]"
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="font-medium">{p.name}</span>
                    <span className="text-[var(--gantry-text-secondary)]">· {p.kind}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      }

      case 'recently_browsed':
        return (
          <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
            <div className="border-b border-[var(--gantry-border)] px-6 py-4">
              <h2 className="text-base font-semibold text-[var(--gantry-text-primary)]">Recently Browsed</h2>
              <p className="mt-0.5 text-xs text-[var(--gantry-text-secondary)]">Your recent entity views</p>
            </div>
            {history.length === 0 ? (
              <p className="px-6 py-4 text-sm text-[var(--gantry-text-secondary)]">No entities browsed yet.</p>
            ) : (
              <div className="divide-y divide-[var(--gantry-border)]">
                {history.map((entry) => {
                  const Icon = iconMap[ENTITY_KINDS.find((k) => k.name === entry.kind)?.icon || ''] || Box;
                  return (
                    <Link
                      key={`${entry.kind}-${entry.name}-${entry.namespace}`}
                      to={`/catalog/${entry.kind}/${entry.name}${entry.namespace && entry.namespace !== 'default' ? `?namespace=${encodeURIComponent(entry.namespace)}` : ''}`}
                      className="flex items-center gap-4 px-6 py-3 transition-colors hover:bg-[var(--gantry-bg-secondary)]"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-[var(--gantry-text-secondary)]" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[var(--gantry-text-primary)]">{entry.name}</p>
                        <p className="text-xs text-[var(--gantry-text-secondary)]">{entry.kind}</p>
                      </div>
                      <span className="shrink-0 text-xs text-[var(--gantry-text-secondary)]">
                        {relativeTime(entry.viewedAt)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );

      case 'status_monitor': {
        if (statusMonitorLoading) {
          return <StatusMonitorWidgetSkeleton />;
        }

        // Only render if we have status data (plugin enabled and responding).
        if (statusMonitor.length === 0) return null;
        const smIssues = statusMonitor.filter((s) => s.status !== 'operational' && s.status !== 'unknown');
        const smOperational = statusMonitor.filter((s) => s.status === 'operational').length;
        const STATUS_DOT: Record<string, string> = {
          operational: 'bg-green-500',
          degraded: 'bg-yellow-500',
          partial: 'bg-orange-500',
          major: 'bg-red-500',
          maintenance: 'bg-blue-500',
          unknown: 'bg-gray-400',
        };
        const STATUS_BADGE: Record<string, string> = {
          degraded: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
          partial: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
          major: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
          maintenance: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
        };
        return (
          <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
            <div className="flex items-center justify-between border-b border-[var(--gantry-border)] px-6 py-4">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
                <h2 className="text-base font-semibold text-[var(--gantry-text-primary)]">Service Status</h2>
              </div>
              <Link to="/status" className="flex items-center gap-1 text-sm text-[var(--gantry-accent)] hover:opacity-75">
                View all <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            {smIssues.length === 0 ? (
              <div className="flex items-center gap-3 px-6 py-4">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
                <div>
                  <p className="text-sm font-medium text-[var(--gantry-text-primary)]">All systems operational</p>
                  <p className="text-xs text-[var(--gantry-text-secondary)]">{smOperational} of {statusMonitor.length} monitored services</p>
                </div>
              </div>
            ) : (
              <div className="px-4 py-3 space-y-1.5">
                <div className="flex items-center gap-2 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 px-3 py-2 text-xs font-medium text-yellow-700 dark:text-yellow-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>{smIssues.length} {smIssues.length === 1 ? 'service' : 'services'} reporting issues</span>
                </div>
                {smIssues.slice(0, 5).map((s) => (
                  <div key={s.name} className="flex items-center gap-2.5 rounded-lg px-3 py-1.5">
                    <div className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[s.status] || STATUS_DOT.unknown}`} />
                    <a href={s.statusUrl} target="_blank" rel="noopener noreferrer" className="flex-1 truncate text-sm text-[var(--gantry-text-primary)] hover:text-[var(--gantry-accent)] hover:underline">{s.title}</a>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[s.status] || 'bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400'}`}>
                      {s.status === 'degraded' ? 'Degraded' : s.status === 'partial' ? 'Partial Outage' : s.status === 'major' ? 'Major Outage' : s.status === 'maintenance' ? 'Maintenance' : s.status}
                    </span>
                  </div>
                ))}
                {smIssues.length > 5 && (
                  <div className="px-3 pt-1 text-xs text-[var(--gantry-text-secondary)]">
                    +{smIssues.length - 5} more
                  </div>
                )}
              </div>
            )}
          </div>
        );
      }

      case 'harbor_vulns': {
        if (!harborSummary) return null;
        return (
          <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
            <div className="flex items-center justify-between border-b border-[var(--gantry-border)] px-6 py-4">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
                <h2 className="text-base font-semibold text-[var(--gantry-text-primary)]">Harbor Security</h2>
              </div>
              <Link to="/harbor" className="flex items-center gap-1 text-sm text-[var(--gantry-accent)] hover:opacity-75">
                View all <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div className="text-xs text-[var(--gantry-text-secondary)]">
                {harborSummary.repositories} repositories scanned
              </div>
              {harborSummary.total === 0 ? (
                <p className="text-sm font-medium text-green-600 dark:text-green-400">No vulnerabilities found</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {harborSummary.critical > 0 && (
                    <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700 dark:bg-red-900/30 dark:text-red-400">
                      {harborSummary.critical} Critical
                    </span>
                  )}
                  {harborSummary.high > 0 && (
                    <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-bold text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                      {harborSummary.high} High
                    </span>
                  )}
                  {harborSummary.medium > 0 && (
                    <span className="rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-bold text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                      {harborSummary.medium} Medium
                    </span>
                  )}
                  {harborSummary.low > 0 && (
                    <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                      {harborSummary.low} Low
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      }

      case 'gitops_status': {
        if (!gitopsStatus) return null;
        return (
          <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
            <div className="flex items-center justify-between border-b border-[var(--gantry-border)] px-6 py-4">
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
                <h2 className="text-base font-semibold text-[var(--gantry-text-primary)]">GitOps</h2>
              </div>
              <Link to="/gitops" className="flex items-center gap-1 text-sm text-[var(--gantry-accent)] hover:opacity-75">
                Manage <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className={`h-2.5 w-2.5 rounded-full ${gitopsStatus.connected ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-sm font-medium text-[var(--gantry-text-primary)]">
                  {gitopsStatus.connected ? 'Connected' : 'Disconnected'}
                </span>
                {gitopsStatus.branch && (
                  <span className="rounded bg-[var(--gantry-bg-tertiary)] px-1.5 py-0.5 text-xs text-[var(--gantry-text-secondary)]">
                    {gitopsStatus.branch}
                  </span>
                )}
              </div>
              {gitopsStatus.lastError && (
                <p className="text-xs text-[var(--gantry-danger)] truncate" title={gitopsStatus.lastError}>
                  {gitopsStatus.lastError}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 text-xs text-[var(--gantry-text-secondary)]">
                <div>Last push: {gitopsStatus.lastPushAt ? new Date(gitopsStatus.lastPushAt).toLocaleString() : 'Never'}</div>
                <div>Last pull: {gitopsStatus.lastPullAt ? new Date(gitopsStatus.lastPullAt).toLocaleString() : 'Never'}</div>
              </div>
            </div>
          </div>
        );
      }

      case 'topology_overview': {
        if (!topologyData) return null;
        const nodeCount = topologyData.nodes.length;
        const edgeCount = topologyData.edges.length;
        const envCount = topologyData.environments.length;
        if (nodeCount === 0) return null;

        // Count by kind
        const kindCounts = new Map<string, number>();
        for (const n of topologyData.nodes) {
          kindCounts.set(n.kind, (kindCounts.get(n.kind) || 0) + 1);
        }

        // Count by relation
        const relCounts = new Map<string, number>();
        for (const e of topologyData.edges) {
          relCounts.set(e.relation, (relCounts.get(e.relation) || 0) + 1);
        }

        const RELATION_LABEL: Record<string, string> = {
          dependsOn: 'Dependencies',
          deployedIn: 'Deployments',
          providesApi: 'API Providers',
          consumesApi: 'API Consumers',
          ownedBy: 'Ownership',
        };

        return (
          <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
            <div className="flex items-center justify-between border-b border-[var(--gantry-border)] px-6 py-4">
              <div className="flex items-center gap-2">
                <Network className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
                <h2 className="text-base font-semibold text-[var(--gantry-text-primary)]">Topology</h2>
              </div>
              <Link to="/topology" className="flex items-center gap-1 text-sm text-[var(--gantry-accent)] hover:opacity-75">
                Explore <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div className="flex items-center gap-4 text-sm">
                <span className="font-medium text-[var(--gantry-text-primary)]">{nodeCount} entities</span>
                <span className="text-[var(--gantry-text-secondary)]">{edgeCount} relationships</span>
                {envCount > 0 && (
                  <span className="text-[var(--gantry-text-secondary)]">{envCount} environments</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {Array.from(kindCounts.entries())
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 6)
                  .map(([kind, count]) => (
                    <span
                      key={kind}
                      className="rounded-full border border-[var(--gantry-border)] px-2 py-0.5 text-xs text-[var(--gantry-text-secondary)]"
                    >
                      {count} {kind}{count !== 1 ? 's' : ''}
                    </span>
                  ))}
              </div>
              {relCounts.size > 0 && (
                <div className="flex flex-wrap gap-2">
                  {Array.from(relCounts.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 4)
                    .map(([rel, count]) => (
                      <span
                        key={rel}
                        className="text-xs text-[var(--gantry-text-secondary)]"
                      >
                        {count} {RELATION_LABEL[rel] || rel}
                      </span>
                    ))}
                </div>
              )}
            </div>
          </div>
        );
      }

      default:
        return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="spinner h-8 w-8 text-[var(--gantry-accent)]" />
      </div>
    );
  }

  // ── EDIT MODE ──────────────────────────────────────────────────────────────
  if (editMode && editConfig) {
    return (
      <div className="space-y-6">
        {/* Edit header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-[var(--gantry-text-primary)]">Edit Dashboard</h1>
            <span className="rounded-full border border-yellow-400 bg-yellow-400/10 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:text-yellow-300">
              Editing
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={cancelEdit}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-4 py-2 text-sm text-[var(--gantry-text-secondary)] transition-colors hover:border-[var(--gantry-accent)] hover:text-[var(--gantry-text-primary)]"
            >
              <X className="h-4 w-4" /> Cancel
            </button>
            <button
              onClick={saveEdit}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--gantry-accent)] bg-[var(--gantry-accent)] px-4 py-2 text-sm font-medium text-[var(--gantry-bg-primary)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Changes
            </button>
          </div>
        </div>

        {saveError && (
          <div className="rounded-lg border border-[var(--gantry-danger)] bg-[var(--gantry-danger)]/10 px-4 py-3 text-sm text-[var(--gantry-danger)]">
            {saveError}
          </div>
        )}

        {/* ── Announcements ── */}
        <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-6 space-y-4">
          <EditSectionHeader title="Announcements" onAdd={addAnnouncement} addLabel="Add Announcement" />
          <p className="text-xs text-[var(--gantry-text-secondary)]">Banners shown to all users at the top of the dashboard.</p>
          {editConfig.announcements.length === 0 && (
            <p className="text-sm text-[var(--gantry-text-secondary)] italic">No announcements.</p>
          )}
          {editConfig.announcements.map((a) => (
            <div key={a.id} className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] p-4 space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Title"
                  value={a.title}
                  onChange={(e) => updateAnnouncement(a.id, { title: e.target.value })}
                  className={inputCls('flex-1')}
                />
                <select
                  value={a.severity}
                  onChange={(e) => updateAnnouncement(a.id, { severity: e.target.value as DashboardSeverity })}
                  className={selectCls()}
                >
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="danger">Danger</option>
                </select>
                <button
                  onClick={() => removeAnnouncement(a.id)}
                  className="flex-shrink-0 rounded-md p-1.5 text-[var(--gantry-text-secondary)] transition-colors hover:bg-[var(--gantry-danger)]/10 hover:text-[var(--gantry-danger)]"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <textarea
                placeholder="Body text (plain text, newlines preserved)"
                value={a.body}
                onChange={(e) => updateAnnouncement(a.id, { body: e.target.value })}
                rows={3}
                className={inputCls('resize-none')}
              />
            </div>
          ))}
        </div>

        {/* ── Quick Links ── */}
        <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-6 space-y-4">
          <EditSectionHeader title="Quick Links" onAdd={addQuickLink} addLabel="Add Link" />
          <p className="text-xs text-[var(--gantry-text-secondary)]">Curated links shown on the dashboard (open in new tab).</p>
          {editConfig.quickLinks.length === 0 && (
            <p className="text-sm text-[var(--gantry-text-secondary)] italic">No quick links.</p>
          )}
          <div className="space-y-2" onDragOver={(e) => e.preventDefault()}>
          {editConfig.quickLinks.map((l, idx) => (
            <div
              key={l.id}
              onDragStart={(e) => onDragStart(e, 'quickLinks', idx)}
              onDragOver={(e) => onDragOver(e, 'quickLinks', idx)}
              onDrop={() => onDrop('quickLinks', idx)}
              onDragEnd={onDragEnd}
              className={`flex items-center gap-2 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 transition-opacity ${dragRowCls('quickLinks', idx)}`}
            >
              <GripVertical
                className="h-4 w-4 shrink-0 cursor-grab text-[var(--gantry-text-secondary)] active:cursor-grabbing"
                onMouseDown={(e) => { const row = (e.currentTarget as unknown as HTMLElement).parentElement; if (row) row.draggable = true; }}
              />
              <select
                value={l.icon}
                onChange={(e) => updateQuickLink(l.id, { icon: e.target.value as DashboardLinkIcon })}
                className={selectCls()}
              >
                <option value="dashboard">Dashboard</option>
                <option value="docs">Docs</option>
                <option value="runbook">Runbook</option>
                <option value="github">GitHub</option>
                <option value="slack">Slack</option>
                <option value="alert">Alert</option>
                <option value="monitor">Monitor</option>
                <option value="ci">CI</option>
                <option value="other">Other</option>
              </select>
              <input
                type="text"
                placeholder="Title"
                value={l.title}
                onChange={(e) => updateQuickLink(l.id, { title: e.target.value })}
                className="w-36 shrink-0 rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-1.5 text-sm text-[var(--gantry-text-primary)] placeholder:text-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
              />
              <input
                type="url"
                placeholder="URL"
                value={l.url}
                onChange={(e) => updateQuickLink(l.id, { url: e.target.value })}
                className="min-w-0 flex-1 rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-1.5 text-sm text-[var(--gantry-text-primary)] placeholder:text-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
              />
              <button
                onClick={() => removeQuickLink(l.id)}
                className="flex-shrink-0 rounded-md p-1.5 text-[var(--gantry-text-secondary)] transition-colors hover:bg-[var(--gantry-danger)]/10 hover:text-[var(--gantry-danger)]"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          </div>
        </div>

        {/* ── Pinned Entities ── */}
        <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-6 space-y-4">
          <EditSectionHeader title="Pinned Entities" onAdd={addPinnedEntity} addLabel="Add Entity" />
          <p className="text-xs text-[var(--gantry-text-secondary)]">Highlight specific catalog entities for developers.</p>
          {editConfig.pinnedEntities.length === 0 && (
            <p className="text-sm text-[var(--gantry-text-secondary)] italic">No pinned entities.</p>
          )}
          <div className="space-y-2" onDragOver={(e) => e.preventDefault()}>
          {editConfig.pinnedEntities.map((p, idx) => (
            <div
              key={p.id}
              onDragStart={(e) => onDragStart(e, 'pinnedEntities', idx)}
              onDragOver={(e) => onDragOver(e, 'pinnedEntities', idx)}
              onDrop={() => onDrop('pinnedEntities', idx)}
              onDragEnd={onDragEnd}
              className={`flex items-center gap-2 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 transition-opacity ${dragRowCls('pinnedEntities', idx)}`}
            >
              <GripVertical
                className="h-4 w-4 shrink-0 cursor-grab text-[var(--gantry-text-secondary)] active:cursor-grabbing"
                onMouseDown={(e) => { const row = (e.currentTarget as unknown as HTMLElement).parentElement; if (row) row.draggable = true; }}
              />
              <select
                value={p.kind}
                onChange={(e) => updatePinnedEntity(p.id, { kind: e.target.value, name: '' })}
                className={selectCls()}
              >
                {ENTITY_KINDS.map((k) => (
                  <option key={k.name} value={k.name}>{k.name}</option>
                ))}
              </select>
              <EntityPicker
                kind={p.kind}
                value={p.name}
                entities={entities}
                onChange={(name) => updatePinnedEntity(p.id, { name })}
              />
              <button
                onClick={() => removePinnedEntity(p.id)}
                className="flex-shrink-0 rounded-md p-1.5 text-[var(--gantry-text-secondary)] transition-colors hover:bg-[var(--gantry-danger)]/10 hover:text-[var(--gantry-danger)]"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          </div>
        </div>

        {/* ── Widget Order, Visibility & Width ── */}
        <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-6 space-y-4">
          <h3 className="text-sm font-semibold text-[var(--gantry-text-primary)]">Widget Visibility, Order &amp; Width</h3>
          <p className="text-xs text-[var(--gantry-text-secondary)]">
            Control which widgets are shown, their order, and whether they span full or half the page width.
          </p>
          <div className="space-y-2">
            {sortedEditWidgets.map((w, idx) => {
              const isHalf = widthOf(w) === 'half';
              return (
                <div
                  key={w.id}
                  onDragStart={(e) => onDragStart(e, 'widgets', idx)}
                  onDragOver={(e) => onDragOver(e, 'widgets', idx)}
                  onDrop={() => onDrop('widgets', idx)}
                  onDragEnd={onDragEnd}
                  className={`flex items-center gap-3 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-4 py-3 transition-opacity ${dragRowCls('widgets', idx)}`}
                >
                  <div className="flex items-center gap-1">
                    <GripVertical
                      className="h-4 w-4 cursor-grab text-[var(--gantry-text-secondary)] active:cursor-grabbing"
                      onMouseDown={(e) => { const row = (e.currentTarget as unknown as HTMLElement).parentElement?.parentElement; if (row) row.draggable = true; }}
                    />
                    <div className="flex flex-col gap-0.5">
                      <button
                        onClick={() => moveWidget(w.id, 'up')}
                        disabled={idx === 0}
                        className="rounded p-0.5 text-[var(--gantry-text-secondary)] transition-colors hover:text-[var(--gantry-text-primary)] disabled:opacity-30"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => moveWidget(w.id, 'down')}
                        disabled={idx === sortedEditWidgets.length - 1}
                        className="rounded p-0.5 text-[var(--gantry-text-secondary)] transition-colors hover:text-[var(--gantry-text-primary)] disabled:opacity-30"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <span className="flex-1 text-sm text-[var(--gantry-text-primary)]">
                    {WIDGET_LABELS[w.id] ?? w.id}
                  </span>
                  {/* Width toggle */}
                  <button
                    onClick={() => toggleWidgetWidth(w.id)}
                    className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                      isHalf
                        ? 'border-[var(--gantry-accent)] bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]'
                        : 'border-[var(--gantry-border)] text-[var(--gantry-text-secondary)] hover:border-[var(--gantry-accent)] hover:text-[var(--gantry-accent)]'
                    }`}
                    title={isHalf ? 'Currently half width — click for full' : 'Currently full width — click for half'}
                  >
                    {isHalf ? '½ width' : 'Full'}
                  </button>
                  {/* Visibility toggle */}
                  <button
                    onClick={() => toggleWidgetVisible(w.id)}
                    className={`rounded-md p-1.5 transition-colors ${
                      w.visible
                        ? 'text-[var(--gantry-accent)] hover:bg-[var(--gantry-accent)]/10'
                        : 'text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)]'
                    }`}
                    title={w.visible ? 'Hide widget' : 'Show widget'}
                  >
                    {w.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── VIEW MODE ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--gantry-text-primary)]">
            Welcome to Gantry{user?.displayName ? `, ${user.displayName}` : ''}
          </h1>
          <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">
            Your internal developer platform overview
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => document.dispatchEvent(new Event('gantry:open-search'))}
            className="flex items-center gap-2 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-4 py-2 text-sm text-[var(--gantry-text-secondary)] transition-colors hover:border-[var(--gantry-accent)] hover:text-[var(--gantry-text-primary)] w-48 lg:w-64"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">Search entities...</span>
            <kbd className="hidden rounded border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-1.5 py-0.5 text-xs sm:inline-block">
              ⌘K
            </kbd>
          </button>
          {isAdmin && (
            <button
              onClick={enterEditMode}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-3 py-2 text-sm text-[var(--gantry-text-secondary)] transition-colors hover:border-[var(--gantry-accent)] hover:text-[var(--gantry-accent)]"
              title="Edit dashboard (admin only)"
            >
              <Pencil className="h-4 w-4" />
              <span className="hidden sm:inline">Edit Dashboard</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-[var(--gantry-danger)] dark:border-red-800 dark:bg-red-900/20">
          {error}
        </div>
      )}

      {/* Announcements */}
      {config && config.announcements.length > 0 && (
        <div className="space-y-3">
          {config.announcements.map((a) => {
            const Icon = SEVERITY_ICON[a.severity];
            return (
              <div key={a.id} className={`flex gap-3 rounded-lg border-l-4 p-4 ${SEVERITY_STYLES[a.severity]}`}>
                <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${SEVERITY_ICON_STYLES[a.severity]}`} />
                <div className="min-w-0">
                  {a.title && <p className="text-sm font-semibold text-[var(--gantry-text-primary)]">{a.title}</p>}
                  {a.body && <p className="mt-0.5 whitespace-pre-wrap text-sm text-[var(--gantry-text-secondary)]">{a.body}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {totalEntities === 0 && (
        <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-8">
          <h2 className="text-lg font-semibold text-[var(--gantry-text-primary)]">Getting Started</h2>
          <p className="mt-2 text-sm text-[var(--gantry-text-secondary)]">
            Your software catalog is empty. Here are some things you can do to get started:
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <Link
              to="/catalog"
              className="flex items-start gap-3 rounded-lg border border-[var(--gantry-border)] p-4 transition-colors hover:bg-[var(--gantry-bg-secondary)]"
            >
              <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-[var(--gantry-accent)]" />
              <div>
                <p className="text-sm font-medium text-[var(--gantry-text-primary)]">Register a Service</p>
                <p className="mt-1 text-xs text-[var(--gantry-text-secondary)]">
                  Add your first service to the catalog to start tracking your software.
                </p>
              </div>
            </Link>
            <Link
              to="/actions"
              className="flex items-start gap-3 rounded-lg border border-[var(--gantry-border)] p-4 transition-colors hover:bg-[var(--gantry-bg-secondary)]"
            >
              <Zap className="mt-0.5 h-5 w-5 shrink-0 text-[var(--gantry-accent)]" />
              <div>
                <p className="text-sm font-medium text-[var(--gantry-text-primary)]">Explore Actions</p>
                <p className="mt-1 text-xs text-[var(--gantry-text-secondary)]">
                  Browse and execute self-service actions to automate common tasks.
                </p>
              </div>
            </Link>
            <div className="flex items-start gap-3 rounded-lg border border-[var(--gantry-border)] p-4">
              <Search className="mt-0.5 h-5 w-5 shrink-0 text-[var(--gantry-accent)]" />
              <div>
                <p className="text-sm font-medium text-[var(--gantry-text-primary)]">Search with Cmd+K</p>
                <p className="mt-1 text-xs text-[var(--gantry-text-secondary)]">
                  Use the command palette to quickly find entities across your catalog.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Standard widgets — 2-column grid, each widget spans full or half */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 grid-flow-row-dense">
        {visibleWidgets.map((w) => {
          const ww = widthOf(w);
          const content = renderWidget(w.id, ww);
          if (!content) return null;
          return (
            <div key={w.id} className={`[&>*]:h-full ${ww === 'half' ? 'col-span-1' : 'col-span-1 md:col-span-2'}`}>
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
