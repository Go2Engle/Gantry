import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import type { Entity } from '../lib/types';
import { catalogEntityPath } from '../lib/utils';

interface EntityTableProps {
  entities: Entity[];
}

type SortField = 'name' | 'kind' | 'owner' | 'updatedAt';
type SortDir = 'asc' | 'desc';

export default function EntityTable({ entities }: EntityTableProps) {
  const navigate = useNavigate();
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sorted = useMemo(() => {
    return [...entities].sort((a, b) => {
      let aVal = '';
      let bVal = '';
      switch (sortField) {
        case 'name':
          aVal = a.metadata.name;
          bVal = b.metadata.name;
          break;
        case 'kind':
          aVal = a.kind;
          bVal = b.kind;
          break;
        case 'owner':
          aVal = a.metadata.owner || '';
          bVal = b.metadata.owner || '';
          break;
        case 'updatedAt':
          aVal = a.metadata.updatedAt || '';
          bVal = b.metadata.updatedAt || '';
          break;
      }
      const cmp = aVal.localeCompare(bVal);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [entities, sortField, sortDir]);

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field)
      return <ArrowUpDown className="ml-1 inline h-3.5 w-3.5 text-[var(--gantry-text-secondary)]" />;
    return sortDir === 'asc' ? (
      <ArrowUp className="ml-1 inline h-3.5 w-3.5 text-[var(--gantry-accent)]" />
    ) : (
      <ArrowDown className="ml-1 inline h-3.5 w-3.5 text-[var(--gantry-accent)]" />
    );
  }

  function formatDate(dateStr?: string): string {
    if (!dateStr) return '-';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--gantry-border)]">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--gantry-border)] bg-[var(--gantry-bg-tertiary)]">
            <th
              className="cursor-pointer px-4 py-3 font-medium text-[var(--gantry-text-secondary)]"
              onClick={() => handleSort('name')}
            >
              Name <SortIcon field="name" />
            </th>
            <th
              className="cursor-pointer px-4 py-3 font-medium text-[var(--gantry-text-secondary)]"
              onClick={() => handleSort('kind')}
            >
              Kind <SortIcon field="kind" />
            </th>
            <th
              className="cursor-pointer px-4 py-3 font-medium text-[var(--gantry-text-secondary)]"
              onClick={() => handleSort('owner')}
            >
              Owner <SortIcon field="owner" />
            </th>
            <th className="px-4 py-3 font-medium text-[var(--gantry-text-secondary)]">Tags</th>
            <th
              className="cursor-pointer px-4 py-3 font-medium text-[var(--gantry-text-secondary)]"
              onClick={() => handleSort('updatedAt')}
            >
              Updated <SortIcon field="updatedAt" />
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((entity, i) => (
            <tr
              key={`${entity.kind}-${entity.metadata.name}`}
              className={`cursor-pointer border-b border-[var(--gantry-border)] transition-colors hover:bg-[var(--gantry-bg-tertiary)] ${
                i % 2 === 0 ? 'bg-[var(--gantry-bg-primary)]' : 'bg-[var(--gantry-bg-secondary)]'
              }`}
              onClick={() => navigate(catalogEntityPath(entity.kind, entity.metadata.name, entity.metadata.namespace))}
            >
              <td className="px-4 py-3">
                <div>
                  <span className="font-medium text-[var(--gantry-text-primary)]">
                    {entity.metadata.name}
                  </span>
                  {entity.metadata.title && entity.metadata.title !== entity.metadata.name && (
                    <p className="text-xs text-[var(--gantry-text-secondary)]">
                      {entity.metadata.title}
                    </p>
                  )}
                </div>
              </td>
              <td className="px-4 py-3">
                <span className="rounded-md bg-[var(--gantry-bg-tertiary)] px-2 py-0.5 text-xs font-medium text-[var(--gantry-text-secondary)]">
                  {entity.kind}
                </span>
              </td>
              <td className="px-4 py-3 text-[var(--gantry-text-secondary)]">
                {entity.metadata.owner || '-'}
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {entity.metadata.tags?.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-[var(--gantry-bg-tertiary)] px-2 py-0.5 text-xs text-[var(--gantry-text-secondary)]"
                    >
                      {tag}
                    </span>
                  ))}
                  {(entity.metadata.tags?.length || 0) > 3 && (
                    <span className="text-xs text-[var(--gantry-text-secondary)]">
                      +{entity.metadata.tags!.length - 3}
                    </span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 text-[var(--gantry-text-secondary)]">
                {formatDate(entity.metadata.updatedAt)}
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td
                colSpan={5}
                className="px-4 py-8 text-center text-sm text-[var(--gantry-text-secondary)]"
              >
                No entities found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
