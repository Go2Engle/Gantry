import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, ExternalLink, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { renderMarkdown } from '../lib/markdown';
import type { Entity, GitHubWikiInfo } from '../lib/types';

function repoURLFromEntity(entity: Entity): string {
  const repoUrl = entity.spec?.repoUrl as string | undefined;
  if (repoUrl?.includes('github.com')) return repoUrl;
  const owner = entity.metadata.annotations?.['github.com/owner'];
  const repo = entity.metadata.annotations?.['github.com/repo'];
  return owner && repo ? `https://github.com/${owner}/${repo}` : '';
}

export default function GitHubWikiTab({ entity }: { entity: Entity }) {
  const repoUrl = repoURLFromEntity(entity);
  const defaultPage = entity.metadata.annotations?.['github.com/wiki-page'];
  const [data, setData] = useState<GitHubWikiInfo | null>(null);
  const [selectedPage, setSelectedPage] = useState(defaultPage ?? '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback((page: string) => {
    if (!repoUrl) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    api
      .getGitHubWiki(repoUrl, page || undefined)
      .then((wiki) => {
        setData(wiki);
        if (wiki.currentPage) {
          setSelectedPage(wiki.currentPage.slug);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [repoUrl]);

  useEffect(() => {
    const initialPage = defaultPage ?? '';
    setSelectedPage(initialPage);
    load(initialPage);
  }, [repoUrl, defaultPage, load]);

  const pageHtml = useMemo(() => {
    if (!data?.currentPage?.markdown) return '';
    return renderMarkdown(data.currentPage.markdown, data.currentPage.rawBaseUrl);
  }, [data?.currentPage?.markdown, data?.currentPage?.rawBaseUrl]);

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
        <button onClick={() => load(selectedPage)} className="ml-3 underline">Retry</button>
      </div>
    );
  }

  if (!data?.available || !data.currentPage) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
        <div className="flex items-center justify-between border-b border-[var(--gantry-border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
            <h3 className="text-sm font-semibold text-[var(--gantry-text-primary)]">Wiki</h3>
          </div>
          <button
            onClick={() => load(selectedPage)}
            title="Refresh"
            className="rounded p-1 text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        <nav className="max-h-[70vh] overflow-y-auto p-2">
          {data.pages.map((page) => (
            <button
              key={page.slug}
              onClick={() => load(page.slug)}
              className={`block w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                page.slug === data.currentPage?.slug
                  ? 'bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]'
                  : 'text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-secondary)] hover:text-[var(--gantry-text-primary)]'
              }`}
            >
              <span className="line-clamp-2">{page.title}</span>
            </button>
          ))}
        </nav>
      </div>

      <div className="min-w-0 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--gantry-border)] px-5 py-3">
          <h3 className="min-w-0 truncate text-sm font-semibold text-[var(--gantry-text-primary)]">
            {data.currentPage.title}
          </h3>
          <a
            href={data.currentPage.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--gantry-border)] px-3 py-1.5 text-sm text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)]"
          >
            <ExternalLink className="h-4 w-4" /> Open
          </a>
        </div>
        <div
          className="px-6 py-5 gantry-markdown"
          // Wiki markdown is fetched from GitHub and sanitized before render.
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: pageHtml }}
        />
      </div>
    </div>
  );
}
