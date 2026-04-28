import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Server, Globe, Database, Users, Cloud, FileText, Box, Workflow } from 'lucide-react';
import { api } from '../lib/api';
import type { SearchResult } from '../lib/types';
import { catalogEntityPath } from '../lib/utils';

const kindIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  Service: Server,
  API: Globe,
  Infrastructure: Database,
  Team: Users,
  Environment: Cloud,
  Documentation: FileText,
  Flow: Workflow,
};

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  // Refs so document-level keydown handler always sees current state
  const displayedResultsRef = useRef<SearchResult[]>([]);
  const selectedIndexRef = useRef(0);
  selectedIndexRef.current = selectedIndex;

  const groupedEntries = useMemo(() => {
    const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
      if (!acc[r.kind]) acc[r.kind] = [];
      acc[r.kind].push(r);
      return acc;
    }, {});

    return Object.entries(grouped);
  }, [results]);

  const displayedResults = useMemo(
    () => groupedEntries.flatMap(([, items]) => items),
    [groupedEntries],
  );
  displayedResultsRef.current = displayedResults;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
        return;
      }
    }
    function handleOpenSearch() {
      setOpen(true);
    }
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('gantry:open-search', handleOpenSearch);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('gantry:open-search', handleOpenSearch);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      return;
    }
    setTimeout(() => inputRef.current?.focus(), 50);

    function handleNavKeyDown(e: KeyboardEvent) {
      const len = displayedResultsRef.current.length;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (len === 0) return;
        setSelectedIndex((prev) => Math.min(prev + 1, len - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (len === 0) return;
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const result = displayedResultsRef.current[selectedIndexRef.current];
        if (result) {
          setOpen(false);
          navigate(catalogEntityPath(result.kind, result.name, result.namespace));
        }
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', handleNavKeyDown);
    return () => document.removeEventListener('keydown', handleNavKeyDown);
  }, [open, navigate]);

  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector('[data-selected="true"]');
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const doSearch = useCallback((q: string) => {
    if (!q.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .search(q)
      .then((data) => {
        setResults(data || []);
        setSelectedIndex(0);
      })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, []);

  const handleInputChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 250);
  };

  const selectResult = (result: SearchResult) => {
    setOpen(false);
    navigate(catalogEntityPath(result.kind, result.name, result.namespace));
  };

  let flatIndex = -1;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      <div className="fixed inset-0 bg-black/50" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-lg rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] shadow-2xl">
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-[var(--gantry-border)] px-4 py-3">
          <Search className="h-5 w-5 shrink-0 text-[var(--gantry-text-secondary)]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder="Search entities..."
            className="flex-1 bg-transparent text-sm text-[var(--gantry-text-primary)] outline-none placeholder:text-[var(--gantry-text-secondary)]"
          />
          <kbd className="hidden rounded border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-1.5 py-0.5 text-xs text-[var(--gantry-text-secondary)] sm:inline-block">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto p-2">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="spinner text-[var(--gantry-accent)]" />
            </div>
          )}

          {!loading && query && results.length === 0 && (
            <div className="py-8 text-center text-sm text-[var(--gantry-text-secondary)]">
              No results found for &quot;{query}&quot;
            </div>
          )}

          {!loading && !query && (
            <div className="py-8 text-center text-sm text-[var(--gantry-text-secondary)]">
              Start typing to search entities...
            </div>
          )}

          {!loading &&
            groupedEntries.map(([kind, items]) => {
              const KindIcon = kindIcons[kind] || Box;
              return (
                <div key={kind}>
                  <div className="flex items-center gap-2 px-3 py-1.5">
                    <KindIcon className="h-3.5 w-3.5 text-[var(--gantry-text-secondary)]" />
                    <span className="text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">
                      {kind}
                    </span>
                  </div>
                  {items.map((result) => {
                    flatIndex++;
                    const idx = flatIndex;
                    return (
                      <button
                        key={`${result.kind}-${result.namespace}-${result.name}`}
                        data-selected={idx === selectedIndex ? 'true' : 'false'}
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                          idx === selectedIndex
                            ? 'bg-[var(--gantry-accent)] text-[var(--gantry-bg-primary)]'
                            : 'text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-tertiary)]'
                        }`}
                        onClick={() => selectResult(result)}
                        onMouseEnter={() => setSelectedIndex(idx)}
                      >
                        <span className="font-medium">{result.name}</span>
                        {result.title && result.title !== result.name && (
                          <span className={`truncate ${idx === selectedIndex ? 'opacity-70' : 'text-[var(--gantry-text-secondary)]'}`}>
                            {result.title}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 border-t border-[var(--gantry-border)] px-4 py-2 text-xs text-[var(--gantry-text-secondary)]">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-1 py-0.5">
              &uarr;&darr;
            </kbd>
            Navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-1 py-0.5">
              &crarr;
            </kbd>
            Select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-1 py-0.5">
              Esc
            </kbd>
            Close
          </span>
        </div>
      </div>
    </div>
  );
}
