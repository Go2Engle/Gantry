import { useCallback, useEffect, useMemo, useState, Fragment } from 'react';
import { Archive, ChevronDown, ChevronRight, ChevronUp, Package, RefreshCw, Search, AlertCircle, FileDown } from 'lucide-react';
import { api } from '../lib/api';
import type { NexusAsset, NexusComponent } from '../lib/types';

type SortKey = 'name' | 'version' | 'format' | 'repository' | 'assets' | 'modified';
type SortDir = 'asc' | 'desc';

type Filters = {
  name: string;
  repository: string;
  group: string;
  format: string;
};

const FORMAT_BADGE: Record<string, string> = {
  maven2: 'border border-[var(--gantry-accent)] bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]',
  npm: 'border border-[var(--gantry-danger)] bg-[var(--gantry-danger)]/10 text-[var(--gantry-danger)]',
  docker: 'border border-[var(--gantry-accent)] bg-[var(--gantry-bg-secondary)] text-[var(--gantry-text-primary)]',
  pypi: 'border border-[var(--gantry-border)] bg-[var(--gantry-bg-tertiary)] text-[var(--gantry-text-primary)]',
  nuget: 'border border-[var(--gantry-accent)] bg-[var(--gantry-accent)] text-[var(--gantry-bg-primary)]',
  raw: 'border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] text-[var(--gantry-text-secondary)]',
};

const EMPTY_FILTERS: Filters = {
  name: '',
  repository: '',
  group: '',
  format: '',
};

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '—';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDate(ts: string): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function latestModified(component: NexusComponent): string {
  let latest = '';
  for (const asset of component.assets) {
    if (asset.lastModified && asset.lastModified > latest) latest = asset.lastModified;
  }
  return latest;
}

function SortIcon({ column, sortKey, sortDir }: { column: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (column !== sortKey) return null;
  return sortDir === 'asc'
    ? <ChevronUp className="ml-0.5 inline h-3 w-3" />
    : <ChevronDown className="ml-0.5 inline h-3 w-3" />;
}

function AssetRow({ asset }: { asset: NexusAsset }) {
  const fileName = asset.path?.split('/').pop() || asset.path || '—';

  return (
    <tr className="text-xs">
      <td className="py-1.5 pr-4 text-[var(--gantry-text-primary)]">
        <div className="flex items-center gap-1.5">
          <FileDown className="h-3 w-3 text-[var(--gantry-text-secondary)]" />
          {asset.downloadUrl ? (
            <a
              href={asset.downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[var(--gantry-accent)] hover:text-[var(--gantry-accent-hover)]"
              onClick={(e) => e.stopPropagation()}
            >
              {fileName}
            </a>
          ) : (
            <span>{fileName}</span>
          )}
        </div>
      </td>
      <td className="py-1.5 pr-4 font-mono text-[var(--gantry-text-secondary)]">{asset.contentType || '—'}</td>
      <td className="py-1.5 pr-4 text-[var(--gantry-text-secondary)]">{formatBytes(asset.fileSize)}</td>
      <td className="py-1.5 text-[var(--gantry-text-secondary)]">{formatDate(asset.lastModified)}</td>
    </tr>
  );
}

function ComponentRow({ component }: { component: NexusComponent }) {
  const [expanded, setExpanded] = useState(false);
  const formatCls = FORMAT_BADGE[component.format] || FORMAT_BADGE.raw;
  const modified = latestModified(component);

  return (
    <Fragment>
      <tr
        className="cursor-pointer hover:bg-[var(--gantry-bg-secondary)]"
        onClick={() => setExpanded((value) => !value)}
      >
        <td className="px-4 py-3">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-[var(--gantry-text-secondary)]" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-[var(--gantry-text-secondary)]" />
          )}
        </td>
        <td className="px-4 py-3 text-xs font-medium text-[var(--gantry-text-primary)]">
          {component.group ? `${component.group}/${component.name}` : component.name}
        </td>
        <td className="px-4 py-3 font-mono text-xs text-[var(--gantry-text-primary)]">{component.version || '—'}</td>
        <td className="px-4 py-3">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${formatCls}`}>
            {component.format}
          </span>
        </td>
        <td className="px-4 py-3 text-xs text-[var(--gantry-text-secondary)]">{component.repository || '—'}</td>
        <td className="px-4 py-3 text-xs text-[var(--gantry-text-secondary)]">
          {component.assets.length} {component.assets.length === 1 ? 'asset' : 'assets'}
        </td>
        <td className="px-4 py-3 text-xs text-[var(--gantry-text-secondary)]">
          {modified ? formatDate(modified) : '—'}
        </td>
      </tr>
      {expanded && component.assets.length > 0 && (
        <tr>
          <td colSpan={7} className="bg-[var(--gantry-bg-secondary)] px-8 pb-4 pt-2">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-left text-[var(--gantry-text-secondary)]">
                  <th className="pb-1 pr-4 font-medium">File</th>
                  <th className="pb-1 pr-4 font-medium">Content Type</th>
                  <th className="pb-1 pr-4 font-medium">Size</th>
                  <th className="pb-1 font-medium">Modified</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--gantry-border)]">
                {component.assets.map((asset) => (
                  <AssetRow key={asset.id || asset.path} asset={asset} />
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
      {expanded && component.assets.length === 0 && (
        <tr>
          <td colSpan={7} className="bg-[var(--gantry-bg-secondary)] px-8 pb-4 pt-2">
            <p className="py-2 text-xs text-[var(--gantry-text-secondary)]">No assets found for this component.</p>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

export default function Nexus() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS);
  const [components, setComponents] = useState<NexusComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('modified');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [initialized, setInitialized] = useState(false);

  const fetchComponents = useCallback(async (nextFilters: Filters, showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError('');

    try {
      const data = await api.getNexusComponents(
        nextFilters.name,
        nextFilters.repository || undefined,
        nextFilters.group || undefined,
        nextFilters.format || undefined,
      );
      setComponents(data);
      setAppliedFilters(nextFilters);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch Nexus components');
      setComponents([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    api.getPluginConfig('nexus-repository-manager')
      .then((cfg) => {
        if (!active) return;
        const defaultRepository = (cfg.values?.defaultRepository as string) || '';
        const nextFilters = { ...EMPTY_FILTERS, repository: defaultRepository };
        setFilters(nextFilters);
        return fetchComponents(nextFilters);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
      })
      .finally(() => {
        if (!active) return;
        setInitialized(true);
      });

    return () => {
      active = false;
    };
  }, [fetchComponents]);

  const filteredComponents = useMemo(() => {
    const query = search.trim().toLowerCase();
    const base = query
      ? components.filter((component) => {
        const haystack = [
          component.name,
          component.group,
          component.version,
          component.repository,
          component.format,
          ...component.assets.map((asset) => asset.path),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      })
      : components;

    const sorted = [...base];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = (a.name || '').localeCompare(b.name || '');
          break;
        case 'version':
          cmp = (a.version || '').localeCompare(b.version || '');
          break;
        case 'format':
          cmp = (a.format || '').localeCompare(b.format || '');
          break;
        case 'repository':
          cmp = (a.repository || '').localeCompare(b.repository || '');
          break;
        case 'assets':
          cmp = a.assets.length - b.assets.length;
          break;
        case 'modified':
          cmp = (latestModified(a) || '').localeCompare(latestModified(b) || '');
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return sorted;
  }, [components, search, sortDir, sortKey]);

  const thClass = 'cursor-pointer select-none px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)] transition-colors hover:text-[var(--gantry-text-primary)]';

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(key === 'modified' ? 'desc' : 'asc');
  }

  function handleLoad() {
    void fetchComponents(filters);
  }

  function handleReset() {
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    setComponents([]);
    setError('');
    setSearch('');
    setLoading(false);
    setRefreshing(false);
  }

  const totalAssets = filteredComponents.reduce((sum, component) => sum + component.assets.length, 0);
  const hasAppliedFilters = Object.values(appliedFilters).some(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--gantry-text-primary)]">
            <Archive className="mr-2 inline h-7 w-7" />
            Nexus Repository Manager
          </h1>
          <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">
            Explore components, package versions, and downloadable assets across your Nexus repositories.
          </p>
        </div>
        {(components.length > 0 || hasAppliedFilters) && (
          <button
            onClick={() => void fetchComponents(appliedFilters, true)}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-4 py-2 text-sm font-medium text-[var(--gantry-text-primary)] transition-colors hover:border-[var(--gantry-accent)] hover:text-[var(--gantry-accent)] disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        )}
      </div>

      <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-4 sm:p-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-[var(--gantry-text-primary)]">Component name</span>
            <input
              type="text"
              value={filters.name}
              onChange={(e) => updateFilter('name', e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleLoad(); }}
              placeholder="payments-api"
              className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] placeholder:text-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-[var(--gantry-text-primary)]">Repository</span>
            <input
              type="text"
              value={filters.repository}
              onChange={(e) => updateFilter('repository', e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleLoad(); }}
              placeholder="maven-releases"
              className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] placeholder:text-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-[var(--gantry-text-primary)]">Group / namespace</span>
            <input
              type="text"
              value={filters.group}
              onChange={(e) => updateFilter('group', e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleLoad(); }}
              placeholder="com.example"
              className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] placeholder:text-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-[var(--gantry-text-primary)]">Format</span>
            <input
              type="text"
              value={filters.format}
              onChange={(e) => updateFilter('format', e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleLoad(); }}
              placeholder="docker"
              className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] placeholder:text-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={handleLoad}
            className="rounded-lg bg-[var(--gantry-accent)] px-4 py-2 text-sm font-medium text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)]"
          >
            Load components
          </button>
          <button
            onClick={handleReset}
            className="rounded-lg border border-[var(--gantry-border)] px-4 py-2 text-sm font-medium text-[var(--gantry-text-primary)] hover:border-[var(--gantry-accent)] hover:text-[var(--gantry-accent)]"
          >
            Reset
          </button>
          {hasAppliedFilters && (
            <div className="text-xs text-[var(--gantry-text-secondary)]">
              Loaded with
              {appliedFilters.name && <span className="ml-1 font-medium text-[var(--gantry-text-primary)]">name={appliedFilters.name}</span>}
              {appliedFilters.repository && <span className="ml-1 font-medium text-[var(--gantry-text-primary)]">repo={appliedFilters.repository}</span>}
              {appliedFilters.group && <span className="ml-1 font-medium text-[var(--gantry-text-primary)]">group={appliedFilters.group}</span>}
              {appliedFilters.format && <span className="ml-1 font-medium text-[var(--gantry-text-primary)]">format={appliedFilters.format}</span>}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-8 text-center">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-[var(--gantry-danger)]" />
          <h2 className="text-lg font-semibold text-[var(--gantry-text-primary)]">Error</h2>
          <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--gantry-accent)] border-t-transparent" />
        </div>
      ) : components.length > 0 ? (
        <>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3 rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-5 py-4">
              <Package className="h-5 w-5 shrink-0 text-[var(--gantry-accent)]" />
              <div>
                <p className="text-sm font-semibold text-[var(--gantry-text-primary)]">
                  {filteredComponents.length} {filteredComponents.length === 1 ? 'component' : 'components'}
                </p>
                <p className="text-xs text-[var(--gantry-text-secondary)]">
                  {totalAssets} total {totalAssets === 1 ? 'asset' : 'assets'}
                </p>
              </div>
            </div>

            {components.length > 5 && (
              <div className="relative w-full md:max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--gantry-text-secondary)]" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter loaded components..."
                  className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] py-2 pl-9 pr-3 text-sm text-[var(--gantry-text-primary)] placeholder:text-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                />
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
            <table className="min-w-full divide-y divide-[var(--gantry-border)]">
              <thead>
                <tr className="bg-[var(--gantry-bg-secondary)]">
                  <th className="w-8 px-4 py-3" />
                  <th className={thClass} onClick={() => toggleSort('name')}>
                    Component <SortIcon column="name" sortKey={sortKey} sortDir={sortDir} />
                  </th>
                  <th className={thClass} onClick={() => toggleSort('version')}>
                    Version <SortIcon column="version" sortKey={sortKey} sortDir={sortDir} />
                  </th>
                  <th className={thClass} onClick={() => toggleSort('format')}>
                    Format <SortIcon column="format" sortKey={sortKey} sortDir={sortDir} />
                  </th>
                  <th className={thClass} onClick={() => toggleSort('repository')}>
                    Repository <SortIcon column="repository" sortKey={sortKey} sortDir={sortDir} />
                  </th>
                  <th className={thClass} onClick={() => toggleSort('assets')}>
                    Assets <SortIcon column="assets" sortKey={sortKey} sortDir={sortDir} />
                  </th>
                  <th className={thClass} onClick={() => toggleSort('modified')}>
                    Modified <SortIcon column="modified" sortKey={sortKey} sortDir={sortDir} />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--gantry-border)]">
                {filteredComponents.map((component) => (
                  <ComponentRow key={component.id || `${component.name}-${component.version}`} component={component} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : initialized ? (
        <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-10 text-center">
          <Archive className="mx-auto mb-3 h-10 w-10 text-[var(--gantry-text-secondary)]" />
          <h2 className="text-lg font-semibold text-[var(--gantry-text-primary)]">No components loaded</h2>
          <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">
            Use the filters above to browse packages in Nexus Repository Manager, or load everything in your default repository.
          </p>
        </div>
      ) : null}
    </div>
  );
}
