import { useState, useEffect, useCallback, Fragment } from 'react';
import { Package, Search, RefreshCw, ChevronRight, AlertCircle, ArrowLeft } from 'lucide-react';
import { api } from '../lib/api';
import type { HarborRepository, HarborArtifact, HarborVulnerability } from '../lib/types';

const SEVERITY_BADGE: Record<string, string> = {
  Critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  High: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  Medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  Low: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  None: 'bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400',
  Unknown: 'bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400',
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function relativeTime(ts: string): string {
  if (!ts) return '—';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function VulnBadges({ summary }: { summary: { critical: number; high: number; medium: number; low: number } }) {
  const items = [
    { label: 'C', count: summary.critical, cls: SEVERITY_BADGE.Critical },
    { label: 'H', count: summary.high, cls: SEVERITY_BADGE.High },
    { label: 'M', count: summary.medium, cls: SEVERITY_BADGE.Medium },
    { label: 'L', count: summary.low, cls: SEVERITY_BADGE.Low },
  ];
  const hasAny = items.some((i) => i.count > 0);
  if (!hasAny) return <span className="text-xs text-green-600 dark:text-green-400">Clean</span>;
  return (
    <div className="flex gap-1">
      {items.filter((i) => i.count > 0).map((i) => (
        <span key={i.label} className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${i.cls}`}>
          {i.label}:{i.count}
        </span>
      ))}
    </div>
  );
}

type View = 'repos' | 'artifacts';

export default function Harbor() {
  const [project, setProject] = useState('');
  const [projectInput, setProjectInput] = useState('');
  const [repos, setRepos] = useState<HarborRepository[]>([]);
  const [artifacts, setArtifacts] = useState<HarborArtifact[]>([]);
  const [vulns, setVulns] = useState<HarborVulnerability[]>([]);
  const [selectedRepo, setSelectedRepo] = useState('');
  const [selectedDigest, setSelectedDigest] = useState('');
  const [view, setView] = useState<View>('repos');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showAllVulns, setShowAllVulns] = useState(false);

  const fetchRepos = useCallback(async (proj: string, showRefresh = false) => {
    if (!proj) return;
    if (showRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const data = await api.getHarborRepositories(proj);
      setRepos(data);
      setProject(proj);
      setView('repos');
    } catch (err: any) {
      setError(err.message || 'Failed to fetch repositories');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchArtifacts = useCallback(async (proj: string, repoName: string) => {
    setLoading(true);
    setError('');
    setVulns([]);
    setSelectedDigest('');
    setShowAllVulns(false);
    try {
      const parts = repoName.split('/');
      const relName = parts.length > 1 ? parts.slice(1).join('/') : repoName;
      const data = await api.getHarborArtifacts(proj, relName);
      setArtifacts(data);
      setSelectedRepo(relName);
      setView('artifacts');
    } catch (err: any) {
      setError(err.message || 'Failed to fetch artifacts');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchVulns = useCallback(async (digest: string) => {
    if (selectedDigest === digest) {
      setSelectedDigest('');
      return;
    }
    setSelectedDigest(digest);
    setVulns([]);
    setShowAllVulns(false);
    try {
      const data = await api.getHarborVulnerabilities(project, selectedRepo, digest);
      setVulns(data);
    } catch {
      setVulns([]);
    }
  }, [project, selectedRepo, selectedDigest]);

  // Auto-load default project from plugin config on mount.
  useEffect(() => {
    api.getPluginConfig('harbor')
      .then((cfg) => {
        const defaultProj = (cfg.values?.defaultProject as string) || 'library';
        setProjectInput(defaultProj);
        return api.getHarborRepositories(defaultProj).then((data) => {
          setRepos(data);
          setProject(defaultProj);
        });
      })
      .catch(() => {});
  }, []);

  const filteredRepos = repos.filter((r) =>
    !search || r.name.toLowerCase().includes(search.toLowerCase())
  );

  const displayVulns = showAllVulns ? vulns : vulns.slice(0, 20);

  if (loading && repos.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--gantry-accent)] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--gantry-text-primary)]">
            <Package className="mr-2 inline h-7 w-7" />
            Harbor Registry
          </h1>
          <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">
            Browse container images and vulnerability scan results
          </p>
        </div>
        {project && (
          <button
            onClick={() => fetchRepos(project, true)}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-4 py-2 text-sm font-medium text-[var(--gantry-text-primary)] transition-colors hover:border-[var(--gantry-accent)] hover:text-[var(--gantry-accent)] disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        )}
      </div>

      {/* Project input */}
      <div className="flex gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--gantry-text-secondary)]" />
          <input
            type="text"
            value={projectInput}
            onChange={(e) => setProjectInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') fetchRepos(projectInput); }}
            placeholder="Enter Harbor project name..."
            className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] py-2 pl-9 pr-3 text-sm text-[var(--gantry-text-primary)] placeholder:text-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
          />
        </div>
        <button
          onClick={() => fetchRepos(projectInput)}
          className="rounded-lg bg-[var(--gantry-accent)] px-4 py-2 text-sm font-medium text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)]"
        >
          Load
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-8 text-center">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-[var(--gantry-danger)]" />
          <h2 className="text-lg font-semibold text-[var(--gantry-text-primary)]">Error</h2>
          <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">{error}</p>
        </div>
      )}

      {/* Breadcrumb */}
      {view === 'artifacts' && (
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => { setView('repos'); setSelectedDigest(''); }}
            className="text-[var(--gantry-accent)] hover:text-[var(--gantry-accent-hover)]"
          >
            <ArrowLeft className="mr-1 inline h-4 w-4" />
            {project}
          </button>
          <ChevronRight className="h-3.5 w-3.5 text-[var(--gantry-text-secondary)]" />
          <span className="font-medium text-[var(--gantry-text-primary)]">{selectedRepo}</span>
        </div>
      )}

      {/* Repository list */}
      {view === 'repos' && !error && repos.length > 0 && (
        <>
          {repos.length > 5 && (
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--gantry-text-secondary)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter repositories..."
                className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] py-2 pl-9 pr-3 text-sm text-[var(--gantry-text-primary)] placeholder:text-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
              />
            </div>
          )}
          <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] overflow-hidden">
            <table className="min-w-full divide-y divide-[var(--gantry-border)]">
              <thead>
                <tr className="bg-[var(--gantry-bg-secondary)]">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Repository</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Artifacts</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Pulls</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Updated</th>
                  <th className="w-8 px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--gantry-border)]">
                {filteredRepos.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer transition-colors hover:bg-[var(--gantry-bg-secondary)]"
                    onClick={() => fetchArtifacts(project, r.name)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Package className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
                        <span className="text-sm font-medium text-[var(--gantry-text-primary)]">{r.name}</span>
                      </div>
                      {r.description && (
                        <p className="mt-0.5 text-xs text-[var(--gantry-text-secondary)]">{r.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--gantry-text-secondary)]">{r.artifact_count}</td>
                    <td className="px-4 py-3 text-sm text-[var(--gantry-text-secondary)]">{r.pull_count}</td>
                    <td className="px-4 py-3 text-sm text-[var(--gantry-text-secondary)]">{relativeTime(r.update_time)}</td>
                    <td className="px-4 py-3">
                      <ChevronRight className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view === 'repos' && !error && repos.length === 0 && project && !loading && (
        <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-8 text-center">
          <Package className="mx-auto mb-3 h-8 w-8 text-[var(--gantry-text-secondary)]" />
          <p className="text-sm text-[var(--gantry-text-secondary)]">No repositories found in project "{project}".</p>
        </div>
      )}

      {/* Artifacts list */}
      {view === 'artifacts' && !error && (
        <>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-[var(--gantry-accent)] border-t-transparent" />
            </div>
          ) : artifacts.length === 0 ? (
            <p className="text-sm text-[var(--gantry-text-secondary)]">No artifacts found.</p>
          ) : (
            <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] overflow-hidden">
              <table className="min-w-full divide-y divide-[var(--gantry-border)]">
                <thead>
                  <tr className="bg-[var(--gantry-bg-secondary)]">
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Tags</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Digest</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Size</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Pushed</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Vulnerabilities</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--gantry-border)]">
                  {artifacts.map((a) => {
                    const tags = a.tags.map((t) => t.name).join(', ') || '(untagged)';
                    const shortDigest = a.digest.replace('sha256:', '').substring(0, 12);
                    const isExpanded = selectedDigest === a.digest;
                    return (
                      <Fragment key={a.digest}>
                        <tr
                          className="cursor-pointer transition-colors hover:bg-[var(--gantry-bg-secondary)]"
                          onClick={() => fetchVulns(a.digest)}
                        >
                          <td className="px-4 py-3 text-sm font-medium text-[var(--gantry-text-primary)]">{tags}</td>
                          <td className="px-4 py-3 font-mono text-xs text-[var(--gantry-text-secondary)]">{shortDigest}</td>
                          <td className="px-4 py-3 text-sm text-[var(--gantry-text-secondary)]">{formatBytes(a.size)}</td>
                          <td className="px-4 py-3 text-sm text-[var(--gantry-text-secondary)]">{relativeTime(a.push_time)}</td>
                          <td className="px-4 py-3">
                            {a.vulnerability_summary ? (
                              <VulnBadges summary={a.vulnerability_summary} />
                            ) : (
                              <span className="text-xs text-[var(--gantry-text-secondary)]">No scan</span>
                            )}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={5} className="bg-[var(--gantry-bg-secondary)] px-6 pb-4 pt-2">
                              {vulns.length === 0 ? (
                                <p className="py-2 text-xs text-[var(--gantry-text-secondary)]">No vulnerabilities found.</p>
                              ) : (
                                <div className="space-y-2">
                                  <table className="min-w-full text-xs">
                                    <thead>
                                      <tr className="text-left text-[var(--gantry-text-secondary)]">
                                        <th className="pb-1 pr-4 font-medium">CVE</th>
                                        <th className="pb-1 pr-4 font-medium">Severity</th>
                                        <th className="pb-1 pr-4 font-medium">Package</th>
                                        <th className="pb-1 pr-4 font-medium">Version</th>
                                        <th className="pb-1 pr-4 font-medium">Fix</th>
                                        <th className="pb-1 font-medium">Score</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[var(--gantry-border)]">
                                      {displayVulns.map((v, i) => (
                                        <tr key={`${v.id}-${i}`}>
                                          <td className="py-1.5 pr-4 font-mono text-[var(--gantry-text-primary)]">{v.id}</td>
                                          <td className="py-1.5 pr-4">
                                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${SEVERITY_BADGE[v.severity] || SEVERITY_BADGE.Unknown}`}>
                                              {v.severity}
                                            </span>
                                          </td>
                                          <td className="py-1.5 pr-4 text-[var(--gantry-text-primary)]">{v.package}</td>
                                          <td className="py-1.5 pr-4 font-mono text-[var(--gantry-text-secondary)]">{v.version}</td>
                                          <td className="py-1.5 pr-4 font-mono text-green-600 dark:text-green-400">{v.fix_version || '—'}</td>
                                          <td className="py-1.5 text-[var(--gantry-text-secondary)]">{v.score != null ? v.score.toFixed(1) : '—'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                  {vulns.length > 20 && !showAllVulns && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setShowAllVulns(true); }}
                                      className="text-xs font-medium text-[var(--gantry-accent)] hover:text-[var(--gantry-accent-hover)]"
                                    >
                                      Show all {vulns.length} vulnerabilities
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
