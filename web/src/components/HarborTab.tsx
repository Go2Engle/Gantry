import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Package, Shield, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import type { Entity, HarborArtifact, HarborVulnerability, HarborRepository } from '../lib/types';

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
  if (!hasAny) {
    return <span className="text-xs text-green-600 dark:text-green-400">Clean</span>;
  }
  return (
    <div className="flex gap-1">
      {items
        .filter((i) => i.count > 0)
        .map((i) => (
          <span key={i.label} className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${i.cls}`}>
            {i.label}:{i.count}
          </span>
        ))}
    </div>
  );
}

function ArtifactRow({ artifact, project, repoName }: { artifact: HarborArtifact; project: string; repoName: string }) {
  const [expanded, setExpanded] = useState(false);
  const [vulns, setVulns] = useState<HarborVulnerability[]>([]);
  const [loadingVulns, setLoadingVulns] = useState(false);
  const [vulnError, setVulnError] = useState('');
  const [showAll, setShowAll] = useState(false);

  function loadVulns() {
    if (vulns.length > 0 || loadingVulns) return;
    setLoadingVulns(true);
    setVulnError('');
    api
      .getHarborVulnerabilities(project, repoName, artifact.digest)
      .then(setVulns)
      .catch((e) => setVulnError(e.message))
      .finally(() => setLoadingVulns(false));
  }

  const tags = artifact.tags.map((t) => t.name).join(', ') || '(untagged)';
  const shortDigest = artifact.digest.replace('sha256:', '').substring(0, 12);
  const displayVulns = showAll ? vulns : vulns.slice(0, 20);

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-[var(--gantry-bg-secondary)]"
        onClick={() => {
          setExpanded((v) => !v);
          if (!expanded) loadVulns();
        }}
      >
        <td className="px-4 py-3">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-[var(--gantry-text-secondary)]" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-[var(--gantry-text-secondary)]" />
          )}
        </td>
        <td className="px-4 py-3 text-xs font-medium text-[var(--gantry-text-primary)]">{tags}</td>
        <td className="px-4 py-3 font-mono text-xs text-[var(--gantry-text-secondary)]">{shortDigest}</td>
        <td className="px-4 py-3 text-xs text-[var(--gantry-text-secondary)]">{formatBytes(artifact.size)}</td>
        <td className="px-4 py-3 text-xs text-[var(--gantry-text-secondary)]">{relativeTime(artifact.push_time)}</td>
        <td className="px-4 py-3">
          {artifact.vulnerability_summary ? (
            <VulnBadges summary={artifact.vulnerability_summary} />
          ) : (
            <span className="text-xs text-[var(--gantry-text-secondary)]">No scan</span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} className="bg-[var(--gantry-bg-secondary)] px-8 pb-4 pt-2">
            {loadingVulns && (
              <div className="flex items-center gap-2 py-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--gantry-accent)] border-t-transparent" />
                <span className="text-xs text-[var(--gantry-text-secondary)]">Loading vulnerabilities...</span>
              </div>
            )}
            {vulnError && (
              <p className="text-xs text-red-600 dark:text-red-400">{vulnError}</p>
            )}
            {!loadingVulns && !vulnError && vulns.length === 0 && (
              <p className="py-2 text-xs text-[var(--gantry-text-secondary)]">No vulnerabilities found.</p>
            )}
            {displayVulns.length > 0 && (
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
                {vulns.length > 20 && !showAll && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowAll(true); }}
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
    </>
  );
}

export default function HarborTab({ entity }: { entity: Entity }) {
  const [artifacts, setArtifacts] = useState<HarborArtifact[]>([]);
  const [repos, setRepos] = useState<HarborRepository[]>([]);
  const [selectedRepo, setSelectedRepo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const project = entity.metadata.annotations?.['harbor.io/project'] || '';
  const repository = entity.metadata.annotations?.['harbor.io/repository'] || '';

  useEffect(() => {
    setArtifacts([]);
    setRepos([]);
    setSelectedRepo('');
    setError('');
    if (!project) {
      setLoading(false);
      return;
    }
    setLoading(true);

    if (repository) {
      // Directly fetch artifacts for the specific repository.
      setSelectedRepo(repository);
      api
        .getHarborArtifacts(project, repository)
        .then(setArtifacts)
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    } else {
      // Fetch repos in the project and let user pick.
      api
        .getHarborRepositories(project)
        .then((r) => {
          setRepos(r);
          if (r.length === 1) {
            // Auto-select single repo.
            const parts = r[0].name.split('/');
            const relName = parts.length > 1 ? parts.slice(1).join('/') : r[0].name;
            setSelectedRepo(relName);
            return api.getHarborArtifacts(project, relName).then(setArtifacts);
          }
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [project, repository]);

  function selectRepo(repoName: string) {
    const parts = repoName.split('/');
    const relName = parts.length > 1 ? parts.slice(1).join('/') : repoName;
    setSelectedRepo(relName);
    setLoading(true);
    setError('');
    api
      .getHarborArtifacts(project, relName)
      .then(setArtifacts)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  if (!project) {
    return (
      <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-6 text-center">
        <Package className="mx-auto mb-2 h-8 w-8 text-[var(--gantry-text-secondary)]" />
        <p className="text-sm text-[var(--gantry-text-secondary)]">
          No Harbor project configured. Add a <code className="rounded bg-[var(--gantry-bg-tertiary)] px-1.5 py-0.5 text-xs">harbor.io/project</code> annotation to this entity.
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
      {/* Repository selector (when multiple repos in project) */}
      {repos.length > 1 && !repository && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-[var(--gantry-text-primary)]">Repositories</h3>
          <div className="flex flex-wrap gap-2">
            {repos.map((r) => {
              const parts = r.name.split('/');
              const relName = parts.length > 1 ? parts.slice(1).join('/') : r.name;
              return (
                <button
                  key={r.name}
                  onClick={() => selectRepo(r.name)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    selectedRepo === relName
                      ? 'border-[var(--gantry-accent)] bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]'
                      : 'border-[var(--gantry-border)] text-[var(--gantry-text-secondary)] hover:border-[var(--gantry-accent)] hover:text-[var(--gantry-accent)]'
                  }`}
                >
                  {relName}
                  <span className="ml-1.5 text-[10px] opacity-60">{r.artifact_count} artifacts</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Artifacts table */}
      {selectedRepo && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-[var(--gantry-text-primary)]">
            <Package className="mr-1.5 inline h-4 w-4" />
            {selectedRepo}
            <span className="ml-2 text-xs font-normal text-[var(--gantry-text-secondary)]">
              — click a row to view vulnerabilities
            </span>
          </h3>
          {artifacts.length === 0 ? (
            <p className="text-sm text-[var(--gantry-text-secondary)]">No artifacts found.</p>
          ) : (
            <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] overflow-hidden">
              <table className="min-w-full divide-y divide-[var(--gantry-border)]">
                <thead>
                  <tr className="bg-[var(--gantry-bg-secondary)]">
                    <th className="w-8 px-4 py-3" />
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Tags</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Digest</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Size</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Pushed</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Vulnerabilities</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--gantry-border)]">
                  {artifacts.map((a) => (
                    <ArtifactRow key={a.digest} artifact={a} project={project} repoName={selectedRepo} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Vulnerability summary banner */}
      {artifacts.length > 0 && (() => {
        const totals = artifacts.reduce(
          (acc, a) => {
            if (a.vulnerability_summary) {
              acc.critical += a.vulnerability_summary.critical;
              acc.high += a.vulnerability_summary.high;
              acc.medium += a.vulnerability_summary.medium;
              acc.low += a.vulnerability_summary.low;
            }
            return acc;
          },
          { critical: 0, high: 0, medium: 0, low: 0 }
        );
        const hasIssues = totals.critical > 0 || totals.high > 0;
        if (!hasIssues && totals.medium === 0 && totals.low === 0) return null;
        return (
          <div className={`flex items-center gap-3 rounded-xl border px-5 py-4 ${
            hasIssues
              ? 'border-red-400/30 bg-red-400/10'
              : 'border-yellow-400/30 bg-yellow-400/10'
          }`}>
            {hasIssues ? (
              <AlertTriangle className="h-5 w-5 shrink-0 text-red-500" />
            ) : (
              <Shield className="h-5 w-5 shrink-0 text-yellow-500" />
            )}
            <div>
              <p className="text-sm font-semibold text-[var(--gantry-text-primary)]">
                Security Summary
              </p>
              <div className="mt-1 flex gap-2">
                <VulnBadges summary={totals} />
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
