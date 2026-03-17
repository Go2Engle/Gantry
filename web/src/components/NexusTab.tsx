import { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, Package, FileDown, Archive } from 'lucide-react';
import { api } from '../lib/api';
import type { Entity, NexusComponent, NexusAsset } from '../lib/types';

const FORMAT_BADGE: Record<string, string> = {
  maven2: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  npm: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  docker: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  pypi: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  nuget: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  raw: 'bg-gray-100 text-gray-700 dark:bg-gray-800/50 dark:text-gray-400',
};

type SortKey = 'name' | 'version' | 'format' | 'repository' | 'assets' | 'modified';
type SortDir = 'asc' | 'desc';

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '—';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDate(ts: string): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Return the most recent lastModified from a component's assets, or '' if none. */
function latestModified(component: NexusComponent): string {
  let latest = '';
  for (const a of component.assets) {
    if (a.lastModified && a.lastModified > latest) latest = a.lastModified;
  }
  return latest;
}

function SortIcon({ column, sortKey, sortDir }: { column: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (column !== sortKey) return null;
  return sortDir === 'asc'
    ? <ChevronUp className="inline h-3 w-3 ml-0.5" />
    : <ChevronDown className="inline h-3 w-3 ml-0.5" />;
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
        <td className="px-4 py-3 text-xs font-medium text-[var(--gantry-text-primary)]">
          {component.group ? `${component.group}/${component.name}` : component.name}
        </td>
        <td className="px-4 py-3 font-mono text-xs text-[var(--gantry-text-primary)]">{component.version || '—'}</td>
        <td className="px-4 py-3">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${formatCls}`}>
            {component.format}
          </span>
        </td>
        <td className="px-4 py-3 text-xs text-[var(--gantry-text-secondary)]">{component.repository}</td>
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
                {component.assets.map((a) => (
                  <AssetRow key={a.id || a.path} asset={a} />
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
    </>
  );
}

export default function NexusTab({ entity }: { entity: Entity }) {
  const [components, setComponents] = useState<NexusComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('modified');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const nexusName = entity.metadata.annotations?.['nexus-repository-manager/name'] || '';
  const nexusRepository = entity.metadata.annotations?.['nexus-repository-manager/repository'] || '';
  const nexusGroup = entity.metadata.annotations?.['nexus-repository-manager/group'] || '';

  useEffect(() => {
    setComponents([]);
    setError('');
    if (!nexusName) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .getNexusComponents(nexusName, nexusRepository || undefined, nexusGroup || undefined)
      .then(setComponents)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [nexusName, nexusRepository, nexusGroup]);

  const sorted = useMemo(() => {
    const copy = [...components];
    copy.sort((a, b) => {
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
    return copy;
  }, [components, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'modified' ? 'desc' : 'asc');
    }
  }

  const thClass = 'px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)] cursor-pointer select-none hover:text-[var(--gantry-text-primary)] transition-colors';

  if (!nexusName) {
    return (
      <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-6 text-center">
        <Archive className="mx-auto mb-2 h-8 w-8 text-[var(--gantry-text-secondary)]" />
        <p className="text-sm text-[var(--gantry-text-secondary)]">
          No Nexus component configured. Add a <code className="rounded bg-[var(--gantry-bg-tertiary)] px-1.5 py-0.5 text-xs">nexus-repository-manager/name</code> annotation to this entity.
        </p>
      </div>
    );
  }

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

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 text-sm font-semibold text-[var(--gantry-text-primary)]">
          <Package className="mr-1.5 inline h-4 w-4" />
          {nexusName}
          {nexusRepository && (
            <span className="ml-2 text-xs font-normal text-[var(--gantry-text-secondary)]">
              in {nexusRepository}
            </span>
          )}
          <span className="ml-2 text-xs font-normal text-[var(--gantry-text-secondary)]">
            — click a row to view assets
          </span>
        </h3>
        {sorted.length === 0 ? (
          <p className="text-sm text-[var(--gantry-text-secondary)]">No components found.</p>
        ) : (
          <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] overflow-hidden">
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
                {sorted.map((c) => (
                  <ComponentRow key={c.id || `${c.name}-${c.version}`} component={c} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Summary banner */}
      {components.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-5 py-4">
          <Archive className="h-5 w-5 shrink-0 text-[var(--gantry-accent)]" />
          <div>
            <p className="text-sm font-semibold text-[var(--gantry-text-primary)]">
              {components.length} {components.length === 1 ? 'component' : 'components'}
            </p>
            <p className="text-xs text-[var(--gantry-text-secondary)]">
              {components.reduce((sum, c) => sum + c.assets.length, 0)} total assets
              {nexusRepository && <> in <span className="font-medium">{nexusRepository}</span></>}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
