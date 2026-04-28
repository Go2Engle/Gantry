import { useState, useEffect, useMemo } from 'react';
import {
  Star, GitFork, CircleDot, GitBranch, GitPullRequest,
  GitCommit, ExternalLink, Archive, Lock, Globe, RefreshCw, BookOpen, ChevronDown, ChevronUp, Tag,
} from 'lucide-react';
import { api } from '../lib/api';
import { renderMarkdown } from '../lib/markdown';
import type { Entity, GitHubRepoInfo, GitHubPullRequest } from '../lib/types';

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function firstLine(msg: string): string {
  return msg.split('\n')[0].trim();
}

function PRLabel({ label }: { label: { name: string; color: string } }) {
  // GitHub colors are hex without #; ensure readable text via brightness check.
  const hex = label.color.startsWith('#') ? label.color.slice(1) : label.color;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const bright = (r * 299 + g * 587 + b * 114) / 1000;
  const fg = bright > 128 ? '#000000' : '#ffffff';
  return (
    <span
      style={{ backgroundColor: `#${hex}`, color: fg }}
      className="rounded-full px-2 py-0.5 text-xs font-medium"
    >
      {label.name}
    </span>
  );
}

export default function GitHubTab({ entity }: { entity: Entity }) {
  const [data, setData] = useState<GitHubRepoInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [readmeExpanded, setReadmeExpanded] = useState(true);

  // Derive repo URL from spec.repoUrl or the github.com/repo annotation.
  const repoUrl: string =
    (entity.spec?.repoUrl as string | undefined) ||
    (() => {
      const owner = entity.metadata.annotations?.['github.com/owner'];
      const repo = entity.metadata.annotations?.['github.com/repo'];
      return owner && repo ? `https://github.com/${owner}/${repo}` : '';
    })();

  function load() {
    if (!repoUrl) return;
    setLoading(true);
    setError('');
    api
      .getGitHubRepo(repoUrl)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [repoUrl]);

  const readmeHtml = useMemo(() => {
    if (!data?.readme) return '';
    if (data.repo) {
      const branch = data.repo.default_branch;
      const rawBase = `https://raw.githubusercontent.com/${data.repo.full_name}/${branch}/`;
      return renderMarkdown(data.readme, rawBase);
    }
    return renderMarkdown(data.readme);
  }, [data?.readme, data?.repo?.full_name, data?.repo?.default_branch]);

  if (!repoUrl) {
    return (
      <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-6 py-10 text-center">
        <p className="text-sm text-[var(--gantry-text-secondary)]">
          No repository URL set. Add a <code className="text-xs bg-[var(--gantry-bg-tertiary)] px-1 rounded">repoUrl</code> in the entity spec to see GitHub info here.
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
        <button onClick={load} className="ml-3 underline">Retry</button>
      </div>
    );
  }

  if (!data?.repo) return null;

  const { repo, commits, pullRequests, latestRelease } = data;
  const openPRs = pullRequests.filter((pr: GitHubPullRequest) => !pr.draft);
  const draftPRs = pullRequests.filter((pr: GitHubPullRequest) => pr.draft);

  return (
    <div className="space-y-6">
      {/* Repo info card */}
      <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <a
                href={repo.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-lg font-semibold text-[var(--gantry-accent)] hover:underline truncate"
              >
                {repo.full_name}
              </a>
              {latestRelease && (
                <a
                  href={latestRelease.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 rounded-full border border-[var(--gantry-border)] px-2 py-0.5 text-xs text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)] hover:border-[var(--gantry-accent)]"
                >
                  <Tag className="h-3 w-3" />
                  {latestRelease.tag_name}
                  {latestRelease.prerelease && (
                    <span className="ml-0.5 text-[10px] text-yellow-600 dark:text-yellow-400">pre</span>
                  )}
                </a>
              )}
              {repo.archived && (
                <span className="flex items-center gap-1 rounded-full border border-yellow-400 px-2 py-0.5 text-xs text-yellow-600 dark:text-yellow-400">
                  <Archive className="h-3 w-3" /> Archived
                </span>
              )}
              {repo.private ? (
                <span className="flex items-center gap-1 rounded-full border border-[var(--gantry-border)] px-2 py-0.5 text-xs text-[var(--gantry-text-secondary)]">
                  <Lock className="h-3 w-3" /> Private
                </span>
              ) : (
                <span className="flex items-center gap-1 rounded-full border border-[var(--gantry-border)] px-2 py-0.5 text-xs text-[var(--gantry-text-secondary)]">
                  <Globe className="h-3 w-3" /> Public
                </span>
              )}
            </div>
            {repo.description && (
              <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">{repo.description}</p>
            )}
            {repo.topics && repo.topics.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {repo.topics.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-[var(--gantry-accent)]/10 px-2.5 py-0.5 text-xs text-[var(--gantry-accent)]"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={load}
              title="Refresh"
              className="rounded-lg border border-[var(--gantry-border)] p-1.5 text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)]"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <a
              href={repo.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-[var(--gantry-border)] px-3 py-1.5 text-sm text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)]"
            >
              <ExternalLink className="h-4 w-4" /> Open
            </a>
          </div>
        </div>

        {/* Stats row */}
        <div className="mt-4 flex flex-wrap gap-5 text-sm text-[var(--gantry-text-secondary)]">
          {repo.language && (
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-[var(--gantry-accent)]" />
              {repo.language}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Star className="h-4 w-4" />
            {repo.stargazers_count.toLocaleString()}
          </span>
          <span className="flex items-center gap-1.5">
            <GitFork className="h-4 w-4" />
            {repo.forks_count.toLocaleString()}
          </span>
          <span className="flex items-center gap-1.5">
            <CircleDot className="h-4 w-4" />
            {repo.open_issues_count.toLocaleString()} open issues
          </span>
          <span className="flex items-center gap-1.5">
            <GitBranch className="h-4 w-4" />
            {repo.default_branch}
          </span>
          {repo.pushed_at && (
            <span className="text-[var(--gantry-text-secondary)]">
              Last push: {formatRelativeTime(repo.pushed_at)}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent commits */}
        <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
          <div className="flex items-center gap-2 border-b border-[var(--gantry-border)] px-4 py-3">
            <GitCommit className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
            <h3 className="text-sm font-semibold text-[var(--gantry-text-primary)]">Recent Commits</h3>
          </div>
          {commits.length === 0 ? (
            <p className="px-4 py-6 text-sm text-center text-[var(--gantry-text-secondary)]">No commits found.</p>
          ) : (
            <ul className="divide-y divide-[var(--gantry-border)]">
              {commits.map((c) => (
                <li key={c.sha} className="px-4 py-3">
                  <a
                    href={c.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[var(--gantry-text-primary)] hover:text-[var(--gantry-accent)] line-clamp-1"
                  >
                    {firstLine(c.commit.message)}
                  </a>
                  <div className="mt-1 flex items-center gap-2 text-xs text-[var(--gantry-text-secondary)]">
                    <span className="font-mono">{c.sha.slice(0, 7)}</span>
                    <span>·</span>
                    <span>{c.commit.author.name}</span>
                    <span>·</span>
                    <span>{formatRelativeTime(c.commit.author.date)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Open pull requests */}
        <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
          <div className="flex items-center justify-between border-b border-[var(--gantry-border)] px-4 py-3">
            <div className="flex items-center gap-2">
              <GitPullRequest className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
              <h3 className="text-sm font-semibold text-[var(--gantry-text-primary)]">Pull Requests</h3>
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--gantry-text-secondary)]">
              {openPRs.length > 0 && (
                <span className="rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                  {openPRs.length} open
                </span>
              )}
              {draftPRs.length > 0 && (
                <span className="rounded-full bg-[var(--gantry-bg-tertiary)] px-2 py-0.5 font-medium text-[var(--gantry-text-secondary)]">
                  {draftPRs.length} draft
                </span>
              )}
            </div>
          </div>
          {pullRequests.length === 0 ? (
            <p className="px-4 py-6 text-sm text-center text-[var(--gantry-text-secondary)]">No open pull requests.</p>
          ) : (
            <ul className="divide-y divide-[var(--gantry-border)]">
              {pullRequests.map((pr) => (
                <li key={pr.number} className="px-4 py-3">
                  <div className="flex items-start gap-2">
                    <GitPullRequest
                      className={`mt-0.5 h-4 w-4 shrink-0 ${
                        pr.draft
                          ? 'text-[var(--gantry-text-secondary)]'
                          : 'text-green-600 dark:text-green-400'
                      }`}
                    />
                    <div className="min-w-0">
                      <a
                        href={pr.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-[var(--gantry-text-primary)] hover:text-[var(--gantry-accent)] line-clamp-1"
                      >
                        {pr.title}
                      </a>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[var(--gantry-text-secondary)]">
                        <span>#{pr.number}</span>
                        <span>·</span>
                        <span>{pr.user.login}</span>
                        <span>·</span>
                        <span>{formatRelativeTime(pr.created_at)}</span>
                        {pr.draft && (
                          <span className="rounded bg-[var(--gantry-bg-tertiary)] px-1.5 py-0.5 text-[var(--gantry-text-secondary)]">
                            Draft
                          </span>
                        )}
                        {pr.labels?.map((l) => <PRLabel key={l.name} label={l} />)}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* README */}
      {readmeHtml && (
        <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
          <button
            onClick={() => setReadmeExpanded((e) => !e)}
            className="flex w-full items-center justify-between px-4 py-3 border-b border-[var(--gantry-border)] hover:bg-[var(--gantry-bg-secondary)] transition-colors"
          >
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
              <h3 className="text-sm font-semibold text-[var(--gantry-text-primary)]">README</h3>
            </div>
            {readmeExpanded
              ? <ChevronUp className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
              : <ChevronDown className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
            }
          </button>
          {readmeExpanded && (
            <div
              className="px-6 py-5 gantry-markdown"
              // README content is fetched from GitHub and sanitized before render.
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: readmeHtml }}
            />
          )}
        </div>
      )}
    </div>
  );
}
