import { Link } from 'react-router-dom';
import { Server, Globe, Database, Users, Cloud, FileText, Box, Workflow } from 'lucide-react';
import type { Entity } from '../lib/types';
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

const kindColors: Record<string, string> = {
  Service: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  API: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  Infrastructure: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  Team: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  Environment: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  Documentation: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  Flow: 'bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]',
};

interface EntityCardProps {
  entity: Entity;
}

export default function EntityCard({ entity }: EntityCardProps) {
  const Icon = kindIcons[entity.kind] || Box;
  const colorClass = kindColors[entity.kind] || 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400';

  return (
    <Link
      to={catalogEntityPath(entity.kind, entity.metadata.name, entity.metadata.namespace)}
      className="group block rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-5 transition-all hover:shadow-md"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${colorClass}`}>
            <Icon className="h-3.5 w-3.5" />
            {entity.kind}
          </span>
        </div>
      </div>

      <h3 className="mt-3 text-sm font-semibold text-[var(--gantry-text-primary)] group-hover:text-[var(--gantry-accent)]">
        {entity.metadata.name}
      </h3>

      {entity.metadata.title && entity.metadata.title !== entity.metadata.name && (
        <p className="mt-0.5 text-sm text-[var(--gantry-text-secondary)]">{entity.metadata.title}</p>
      )}

      {entity.metadata.description && (
        <p className="mt-2 line-clamp-2 text-xs text-[var(--gantry-text-secondary)]">
          {entity.metadata.description}
        </p>
      )}

      <div className="mt-4 flex items-center justify-between">
        {entity.metadata.owner && (
          <span className="text-xs text-[var(--gantry-text-secondary)]">
            Owner: {entity.metadata.owner}
          </span>
        )}
      </div>

      {entity.metadata.tags && entity.metadata.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {entity.metadata.tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-[var(--gantry-bg-tertiary)] px-2 py-0.5 text-xs text-[var(--gantry-text-secondary)]"
            >
              {tag}
            </span>
          ))}
          {entity.metadata.tags.length > 4 && (
            <span className="rounded-full bg-[var(--gantry-bg-tertiary)] px-2 py-0.5 text-xs text-[var(--gantry-text-secondary)]">
              +{entity.metadata.tags.length - 4}
            </span>
          )}
        </div>
      )}
    </Link>
  );
}
