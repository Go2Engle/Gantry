import { useCallback, useEffect, useMemo, useRef, useState, Fragment, type KeyboardEvent } from 'react';
import { Archive, ChevronDown, ChevronRight, ChevronUp, Package, RefreshCw, Search, AlertCircle, FileDown, ArrowLeft, Database } from 'lucide-react';
import { api } from '../lib/api';
import type { NexusAsset, NexusComponent, NexusRepository } from '../lib/types';

type SortKey = 'name' | 'version' | 'format' | 'repository' | 'assets' | 'modified';
type SortDir = 'asc' | 'desc';

const FORMAT_BADGE: Record<string, string> = {
  maven2: 'border border-[var(--gantry-accent)] bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]',
  npm: 'border border-[var(--gantry-danger)] bg-[var(--gantry-danger)]/10 text-[var(--gantry-danger)]',
  docker: 'border border-[var(--gantry-accent)] bg-[var(--gantry-bg-secondary)] text-[var(--gantry-text-primary)]',
  pypi: 'border border-[var(--gantry-border)] bg-[var(--gantry-bg-tertiary)] text-[var(--gantry-text-primary)]',
  nuget: 'border border-[var(--gantry-accent)] bg-[var(--gantry-accent)] text-[var(--gantry-bg-primary)]',
  raw: 'border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] text-[var(--gantry-text-secondary)]',
};

const REPO_TYPE_BADGE: Record<string, string> = {
  hosted: 'bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)] border border-[var(--gantry-accent)]',
  proxy: 'bg-[var(--gantry-bg-tertiary)] text-[var(--gantry-text-secondary)] border border-[var(--gantry-border)]',
  group: 'bg-[var(--gantry-danger)]/10 text-[var(--gantry-danger)] border border-[var(--gantry-danger)]',
};

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '—';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function isSafeExternalUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function handleInteractiveRowKeyDown(event: KeyboardEvent<HTMLElement>, onActivate: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  onActivate();
}

function formatDate(ts: string): string {
  if (!ts) return '—';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
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
    ? <ChevronUp className="ml-0.5 inline h-3 w-3" aria-hidden="true" />
    : <ChevronDown className="ml-0.5 inline h-3 w-3" aria-hidden="true" />;
}

function sortAriaValue(column: SortKey, sortKey: SortKey, sortDir: SortDir): 'none' | 'ascending' | 'descending' {
  if (column !== sortKey) return 'none';
  return sortDir === 'asc' ? 'ascending' : 'descending';
}

function SortableHeader({
  column,
  label,
  sortKey,
  sortDir,
  onToggle,
  className,
}: {
  column: SortKey;
  label: string;
  sortKey: SortKey;
  sortDir: SortDir;
  onToggle: (column: SortKey) => void;
  className: string;
}) {
  return (
    <th className={className} aria-sort={sortAriaValue(column, sortKey, sortDir)}>
      <button
        type="button"
        onClick={() => onToggle(column)}
        className="flex w-full items-center gap-1 text-left focus:outline-none focus-visible:text-[var(--gantry-text-primary)]"
      >
        <span>{label}</span>
        <SortIcon column={column} sortKey={sortKey} sortDir={sortDir} />
      </button>
    </th>
  );
}

function AssetRow({ asset }: { asset: NexusAsset }) {
  const fileName = asset.path?.split('/').pop() || asset.path || '—';
  const safeDownloadUrl = isSafeExternalUrl(asset.downloadUrl) ? asset.downloadUrl : '';

  return (
    <tr className="text-xs">
      <td className="py-1.5 pr-4 text-[var(--gantry-text-primary)]">
        <div className="flex items-center gap-1.5">
          <FileDown className="h-3 w-3 text-[var(--gantry-text-secondary)]" />
          {safeDownloadUrl ? (
            <a
              href={safeDownloadUrl}
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

  const toggleExpanded = () => setExpanded((value) => !value);

  return (
    <Fragment>
      <tr
        className="cursor-pointer hover:bg-[var(--gantry-bg-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--gantry-accent)]"
        onClick={toggleExpanded}
        onKeyDown={(event) => handleInteractiveRowKeyDown(event, toggleExpanded)}
        tabIndex={0}
        role="button"
        aria-expanded={expanded}
      >
        <td className="px-4 py-3">
          {expanded
            ? <ChevronDown className="h-3.5 w-3.5 text-[var(--gantry-text-secondary)]" />
            : <ChevronRight className="h-3.5 w-3.5 text-[var(--gantry-text-secondary)]" />}
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
  // Repository browse state
  const [repositories, setRepositories] = useState<NexusRepository[]>([]);
  const [repoLoading, setRepoLoading] = useState(true);
  const [repoError, setRepoError] = useState('');
  const [repoSearch, setRepoSearch] = useState('');

  // Component browse state
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [components, setComponents] = useState<NexusComponent[]>([]);
  const [compLoading, setCompLoading] = useState(false);
  const [compRefreshing, setCompRefreshing] = useState(false);
  const [compError, setCompError] = useState('');
  const [compSearch, setCompSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('modified');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const latestFetchIdRef = useRef(0);

  const inComponentView = selectedRepo !== null;

  useEffect(() => {
    api.getNexusRepositories()
      .then((data) => setRepositories(data))
      .catch((err) => setRepoError(err.message || 'Failed to fetch repositories'))
      .finally(() => setRepoLoading(false));
  }, []);

  const fetchComponents = useCallback(async (repository: string, showRefresh = false) => {
    const requestId = latestFetchIdRef.current + 1;
    latestFetchIdRef.current = requestId;

    if (showRefresh) setCompRefreshing(true);
    else setCompLoading(true);
    setCompError('');

    try {
      const data = await api.getNexusComponents('', repository);
      if (requestId !== latestFetchIdRef.current) return;
      setComponents(data);
    } catch (err: any) {
      if (requestId !== latestFetchIdRef.current) return;
      setCompError(err.message || 'Failed to fetch components');
      setComponents([]);
    } finally {
      if (requestId !== latestFetchIdRef.current) return;
      setCompLoading(false);
      setCompRefreshing(false);
    }
  }, []);

  function handleRepoClick(repo: NexusRepository) {
    setSelectedRepo(repo.name);
    setCompSearch('');
    void fetchComponents(repo.name);
  }

  function handleRepoKeyDown(event: KeyboardEvent<HTMLTableRowElement>, repo: NexusRepository) {
    handleInteractiveRowKeyDown(event, () => handleRepoClick(repo));
  }

  function handleBackToRepos() {
    latestFetchIdRef.current += 1;
    setSelectedRepo(null);
    setComponents([]);
    setCompError('');
    setCompLoading(false);
    setCompRefreshing(false);
    setCompSearch('');
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(key === 'modified' ? 'desc' : 'asc');
  }

  const filteredRepos = useMemo(() => {
    const q = repoSearch.trim().toLowerCase();
    return q
      ? repositories.filter((r) =>
          r.name.toLowerCase().includes(q) ||
          r.format.toLowerCase().includes(q) ||
          r.type.toLowerCase().includes(q)
        )
      : repositories;
  }, [repositories, repoSearch]);

  const filteredComponents = useMemo(() => {
    const q = compSearch.trim().toLowerCase();
    const base = q
      ? components.filter((c) => {
          const haystack = [
            c.name, c.group, c.version, c.repository, c.format,
            ...c.assets.map((a) => a.path),
          ].filter(Boolean).join(' ').toLowerCase();
          return haystack.includes(q);
        })
      : components;

    return [...base].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':       cmp = (a.name || '').localeCompare(b.name || ''); break;
        case 'version':    cmp = (a.version || '').localeCompare(b.version || ''); break;
        case 'format':     cmp = (a.format || '').localeCompare(b.format || ''); break;
        case 'repository': cmp = (a.repository || '').localeCompare(b.repository || ''); break;
        case 'assets':     cmp = a.assets.length - b.assets.length; break;
        case 'modified':   cmp = (latestModified(a) || '').localeCompare(latestModified(b) || ''); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [components, compSearch, sortKey, sortDir]);

  const thClass = 'px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]';
  const totalAssets = filteredComponents.reduce((sum, c) => sum + c.assets.length, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {inComponentView && (
            <button
              onClick={handleBackToRepos}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--gantry-border)] px-3 py-1.5 text-sm text-[var(--gantry-text-secondary)] hover:border-[var(--gantry-accent)] hover:text-[var(--gantry-accent)]"
            >
              <ArrowLeft className="h-4 w-4" />
              Repositories
            </button>
          )}
          <div>
            <h1 className="text-2xl font-bold text-[var(--gantry-text-primary)]">
              <Archive className="mr-2 inline h-7 w-7" />
              Nexus Repository Manager
              {inComponentView && (
                <span className="ml-3 text-lg font-normal text-[var(--gantry-text-secondary)]">
                  / {selectedRepo}
                </span>
              )}
            </h1>
            <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">
              {inComponentView
                ? 'Browse components and downloadable assets in this repository.'
                : 'Browse repositories and components across your Nexus instance.'}
            </p>
          </div>
        </div>
        {inComponentView && (
          <button
            onClick={() => void fetchComponents(selectedRepo!, true)}
            disabled={compRefreshing}
            className="flex items-center gap-2 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-4 py-2 text-sm font-medium text-[var(--gantry-text-primary)] transition-colors hover:border-[var(--gantry-accent)] hover:text-[var(--gantry-accent)] disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${compRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        )}
      </div>

      {/* ── Repository browser ── */}
      {!inComponentView && (
        <>
          {repoError && (
            <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-8 text-center">
              <AlertCircle className="mx-auto mb-3 h-10 w-10 text-[var(--gantry-danger)]" />
              <h2 className="text-lg font-semibold text-[var(--gantry-text-primary)]">Error</h2>
              <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">{repoError}</p>
            </div>
          )}

          {repoLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--gantry-accent)] border-t-transparent" />
            </div>
          ) : !repoError && (
            <>
              {repositories.length > 6 && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--gantry-text-secondary)]" />
                  <input
                    type="text"
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    placeholder="Filter repositories..."
                    className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] py-2 pl-9 pr-3 text-sm text-[var(--gantry-text-primary)] placeholder:text-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none md:max-w-sm"
                  />
                </div>
              )}
              <div className="overflow-hidden rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
                <table className="min-w-full divide-y divide-[var(--gantry-border)]">
                  <thead>
                    <tr className="bg-[var(--gantry-bg-secondary)]">
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Name</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Type</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Format</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--gantry-border)]">
                    {filteredRepos.map((repo) => {
                      const typeCls = REPO_TYPE_BADGE[repo.type] || REPO_TYPE_BADGE.proxy;
                      const formatCls = FORMAT_BADGE[repo.format] || FORMAT_BADGE.raw;
                      return (
                        <tr
                          key={repo.name}
                          className="cursor-pointer hover:bg-[var(--gantry-bg-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--gantry-accent)]"
                          onClick={() => handleRepoClick(repo)}
                          onKeyDown={(event) => handleRepoKeyDown(event, repo)}
                          tabIndex={0}
                          role="button"
                          aria-label={`Open repository ${repo.name}`}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <Database className="h-4 w-4 shrink-0 text-[var(--gantry-text-secondary)]" />
                              <span className="text-sm font-medium text-[var(--gantry-accent)]">{repo.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${typeCls}`}>{repo.type}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${formatCls}`}>{repo.format}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredRepos.length === 0 && (
                  <p className="py-10 text-center text-sm text-[var(--gantry-text-secondary)]">No repositories found.</p>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Component browser ── */}
      {inComponentView && (
        <>
          {compError && (
            <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-8 text-center">
              <AlertCircle className="mx-auto mb-3 h-10 w-10 text-[var(--gantry-danger)]" />
              <h2 className="text-lg font-semibold text-[var(--gantry-text-primary)]">Error</h2>
              <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">{compError}</p>
            </div>
          )}

          {compLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--gantry-accent)] border-t-transparent" />
            </div>
          ) : !compError && (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3 rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-5 py-4">
                  <Package className="h-5 w-5 shrink-0 text-[var(--gantry-accent)]" />
                  <div>
                    <p className="text-sm font-semibold text-[var(--gantry-text-primary)]">
                      {filteredComponents.length}{components.length !== filteredComponents.length && ` of ${components.length}`} {filteredComponents.length === 1 ? 'component' : 'components'}
                    </p>
                    <p className="text-xs text-[var(--gantry-text-secondary)]">
                      {totalAssets} total {totalAssets === 1 ? 'asset' : 'assets'}
                    </p>
                  </div>
                </div>
                <div className="relative w-full sm:max-w-sm">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--gantry-text-secondary)]" />
                  <input
                    type="text"
                    value={compSearch}
                    onChange={(e) => setCompSearch(e.target.value)}
                    placeholder="Search by name, group, version, format..."
                    className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] py-2 pl-9 pr-3 text-sm text-[var(--gantry-text-primary)] placeholder:text-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                  />
                </div>
              </div>

              {components.length > 0 ? (
                <div className="overflow-hidden rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
                  <table className="min-w-full divide-y divide-[var(--gantry-border)]">
                    <thead>
                      <tr className="bg-[var(--gantry-bg-secondary)]">
                        <th className="w-8 px-4 py-3" />
                        <SortableHeader column="name" label="Component" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} className={thClass} />
                        <SortableHeader column="version" label="Version" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} className={thClass} />
                        <SortableHeader column="format" label="Format" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} className={thClass} />
                        <SortableHeader column="repository" label="Repository" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} className={thClass} />
                        <SortableHeader column="assets" label="Assets" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} className={thClass} />
                        <SortableHeader column="modified" label="Modified" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} className={thClass} />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--gantry-border)]">
                      {filteredComponents.map((component) => (
                        <ComponentRow key={component.id || `${component.name}-${component.version}`} component={component} />
                      ))}
                    </tbody>
                  </table>
                  {filteredComponents.length === 0 && (
                    <p className="py-10 text-center text-sm text-[var(--gantry-text-secondary)]">No components match your search.</p>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-10 text-center">
                  <Archive className="mx-auto mb-3 h-10 w-10 text-[var(--gantry-text-secondary)]" />
                  <h2 className="text-lg font-semibold text-[var(--gantry-text-primary)]">No components found</h2>
                  <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">This repository appears to be empty.</p>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
