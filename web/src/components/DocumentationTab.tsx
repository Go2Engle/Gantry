import { ExternalLink, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Entity } from '../lib/types';
import { catalogEntityPath } from '../lib/utils';

function docType(doc: Entity): string {
  const type = doc.spec?.type as string | undefined;
  return type ? type.replace(/-/g, ' ') : 'documentation';
}

function docUrl(doc: Entity): string {
  return (doc.spec?.url as string | undefined) ?? '';
}

function docTitle(doc: Entity): string {
  return doc.metadata.title || doc.metadata.name;
}

export default function DocumentationTab({ docs }: { docs: Entity[] }) {
  if (docs.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-6 py-10 text-center">
        <FileText className="mx-auto h-7 w-7 text-[var(--gantry-text-secondary)]" />
        <p className="mt-3 text-sm text-[var(--gantry-text-secondary)]">No documentation is linked to this entity yet.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
      <div className="border-b border-[var(--gantry-border)] px-5 py-4">
        <h3 className="text-sm font-semibold text-[var(--gantry-text-primary)]">Documentation</h3>
      </div>
      <ul className="divide-y divide-[var(--gantry-border)]">
        {docs.map((doc) => {
          const url = docUrl(doc);
          return (
            <li key={`${doc.metadata.namespace || 'default'}:${doc.metadata.name}`} className="px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-md bg-[var(--gantry-bg-tertiary)] p-2 text-[var(--gantry-text-secondary)]">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to={catalogEntityPath('Documentation', doc.metadata.name, doc.metadata.namespace)}
                      className="font-medium text-[var(--gantry-text-primary)] hover:text-[var(--gantry-accent)]"
                    >
                      {docTitle(doc)}
                    </Link>
                    <span className="rounded-md bg-[var(--gantry-accent)]/10 px-2 py-0.5 text-xs capitalize text-[var(--gantry-accent)]">
                      {docType(doc)}
                    </span>
                  </div>
                  {doc.metadata.description && (
                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-[var(--gantry-text-secondary)]">
                      {doc.metadata.description}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--gantry-text-secondary)]">
                    {doc.metadata.owner && <span>Owner: {doc.metadata.owner}</span>}
                    {doc.metadata.updatedAt && <span>Updated {new Date(doc.metadata.updatedAt).toLocaleDateString()}</span>}
                    {url && (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[var(--gantry-accent)] hover:underline"
                      >
                        Open source
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
