import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  Search, LayoutGrid, List, Plus, X, ArrowLeft,
  Server, Globe, Database, Users, Cloud, FileText,
} from 'lucide-react';
import { api } from '../lib/api';
import { ENTITY_KINDS } from '../lib/types';
import { pruneEmpty } from '../lib/utils';
import type { Entity, JsonSchema } from '../lib/types';
import EntityCard from '../components/EntityCard';
import EntityTable from '../components/EntityTable';
import SchemaForm from '../components/SchemaForm';

const KIND_META: Record<string, { icon: React.ReactNode; description: string; color: string }> = {
  Service: {
    icon: <Server className="h-7 w-7" />,
    description: 'A deployable unit of software — microservice, monolith, or serverless function.',
    color: 'text-blue-500',
  },
  API: {
    icon: <Globe className="h-7 w-7" />,
    description: 'An interface that services expose — REST, GraphQL, gRPC, or event stream.',
    color: 'text-purple-500',
  },
  Infrastructure: {
    icon: <Database className="h-7 w-7" />,
    description: 'Cloud resources — databases, queues, storage, and other infrastructure.',
    color: 'text-orange-500',
  },
  Team: {
    icon: <Users className="h-7 w-7" />,
    description: 'A group of people who own and maintain services and resources.',
    color: 'text-green-500',
  },
  Environment: {
    icon: <Cloud className="h-7 w-7" />,
    description: 'A deployment target — production, staging, development, or preview.',
    color: 'text-cyan-500',
  },
  Documentation: {
    icon: <FileText className="h-7 w-7" />,
    description: 'Technical docs, runbooks, ADRs, and knowledge base articles.',
    color: 'text-yellow-500',
  },
};

export default function Catalog() {
  const { kind } = useParams<{ kind?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canWrite = user?.permissions?.write ?? false;
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [view, setView] = useState<'grid' | 'table'>('table');
  const [showCreate, setShowCreate] = useState(false);
  const [createStep, setCreateStep] = useState<'kind' | 'form'>('kind');
  const [createKind, setCreateKind] = useState('Service');
  const [schemas, setSchemas] = useState<Record<string, JsonSchema>>({});
  const [error, setError] = useState('');
  const [enabledPlugins, setEnabledPlugins] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    setError('');
    api.listEntities(kind).then((data) => setEntities(data || [])).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [kind]);

  useEffect(() => {
    api.listSchemas().then((data) => setSchemas(data || {})).catch(() => {});
    api.listPlugins().then((plugins) => setEnabledPlugins(new Set(plugins.filter((p) => p.enabled).map((p) => p.name)))).catch(() => {});
  }, []);

  const allOwners = useMemo(() => {
    const owners = new Set(entities.map((e) => e.metadata.owner).filter(Boolean) as string[]);
    return Array.from(owners).sort();
  }, [entities]);

  const allTags = useMemo(() => {
    const tags = new Set(entities.flatMap((e) => e.metadata.tags || []));
    return Array.from(tags).sort();
  }, [entities]);

  const filtered = useMemo(() => {
    return entities.filter((e) => {
      if (ownerFilter && e.metadata.owner !== ownerFilter) return false;
      if (tagFilter && !(e.metadata.tags || []).includes(tagFilter)) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          e.metadata.name.toLowerCase().includes(q) ||
          (e.metadata.title || '').toLowerCase().includes(q) ||
          (e.metadata.owner || '').toLowerCase().includes(q) ||
          (e.metadata.tags || []).some((t) => t.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [entities, searchQuery, ownerFilter, tagFilter]);

  const hasFilters = searchQuery || ownerFilter || tagFilter;

  const openCreate = () => {
    setCreateStep('kind');
    setShowCreate(true);
  };

  const closeCreate = () => {
    setShowCreate(false);
    setCreateStep('kind');
  };

  const handleCreate = async (raw: Record<string, any>) => {
    try {
      const name = (raw._name as string) || '';
      const title = (raw._title as string) || '';
      const owner = (raw._owner as string) || '';
      const description = (raw._description as string) || '';

      // Strip metadata-prefixed keys, then deep-prune empty values
      // so the backend doesn't see "" for optional enum fields.
      const rawSpec: Record<string, any> = {};
      for (const [key, value] of Object.entries(raw)) {
        if (!key.startsWith('_')) rawSpec[key] = value;
      }
      const spec = pruneEmpty(rawSpec);

      // Build annotations from plugin-specific fields.
      const annotations: Record<string, string> = {};
      const harborProject = (raw._harbor_project as string) || '';
      const harborRepo = (raw._harbor_repository as string) || '';
      if (harborProject) annotations['harbor.io/project'] = harborProject;
      if (harborRepo) annotations['harbor.io/repository'] = harborRepo;

      const newEntity: Entity = {
        kind: createKind,
        apiVersion: 'gantry.io/v1',
        metadata: { name, title, owner, description, ...(Object.keys(annotations).length > 0 ? { annotations } : {}) },
        spec,
      };
      const created = await api.createEntity(newEntity);
      setEntities((prev) => [...prev, created]);
      closeCreate();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const createSchema: JsonSchema = useMemo(() => {
    const kindSchema = schemas[createKind.toLowerCase()] || { type: 'object', properties: {} };
    const kindRequired: string[] = (kindSchema as any).required || [];
    const showHarbor = enabledPlugins.has('harbor') && (createKind === 'Service' || createKind === 'Infrastructure');
    return {
      type: 'object',
      properties: {
        _name: { type: 'string', title: 'Name', description: 'Unique identifier' },
        _title: { type: 'string', title: 'Title', description: 'Display name' },
        _owner: { type: 'string', title: 'Owner', description: 'Team or user that owns this entity', 'x-entity-ref': 'Team' },
        _description: { type: 'string', title: 'Description' },
        ...(kindSchema as any).properties,
        ...(showHarbor ? {
          _harbor_project: { type: 'string', title: 'Harbor Project', description: 'Harbor registry project name (e.g. my-project)' },
          _harbor_repository: { type: 'string', title: 'Harbor Repository', description: 'Harbor repository path within the project (e.g. my-app)' },
        } : {}),
      },
      required: ['_name', ...kindRequired],
    };
  }, [schemas, createKind, enabledPlugins]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--gantry-text-primary)]">
            {kind ? `${kind}s` : 'Catalog'}
          </h1>
          <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">
            {kind ? `All ${kind} entities` : 'Browse all entities in the catalog'}
          </p>
        </div>
        {canWrite && (
          <button
            onClick={() => openCreate()}
            className="flex items-center gap-2 rounded-lg bg-[var(--gantry-accent)] px-4 py-2 text-sm font-medium text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)]"
          >
            <Plus className="h-4 w-4" />
            Create Entity
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--gantry-text-secondary)]" />
          <input
            type="text"
            placeholder="Search entities..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] py-2 pl-10 pr-4 text-sm text-[var(--gantry-text-primary)] placeholder:text-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--gantry-accent)]"
          />
        </div>
        {allOwners.length > 0 && (
          <select
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className={`rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--gantry-accent)] ${
              ownerFilter
                ? 'border-[var(--gantry-accent)] bg-[var(--gantry-accent)]/5 text-[var(--gantry-accent)]'
                : 'border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] text-[var(--gantry-text-primary)]'
            }`}
          >
            <option value="">All owners</option>
            {allOwners.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
        {allTags.length > 0 && (
          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className={`rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--gantry-accent)] ${
              tagFilter
                ? 'border-[var(--gantry-accent)] bg-[var(--gantry-accent)]/5 text-[var(--gantry-accent)]'
                : 'border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] text-[var(--gantry-text-primary)]'
            }`}
          >
            <option value="">All tags</option>
            {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {hasFilters && (
          <button
            onClick={() => { setSearchQuery(''); setOwnerFilter(''); setTagFilter(''); }}
            className="flex items-center gap-1 rounded-lg border border-[var(--gantry-border)] px-3 py-2 text-sm text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)]"
          >
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
        <div className="flex items-center rounded-lg border border-[var(--gantry-border)]">
          <button
            onClick={() => setView('table')}
            className={`rounded-l-lg p-2 ${view === 'table' ? 'bg-[var(--gantry-bg-tertiary)] text-[var(--gantry-accent)]' : 'text-[var(--gantry-text-secondary)]'}`}
          >
            <List className="h-4 w-4" />
          </button>
          <button
            onClick={() => setView('grid')}
            className={`rounded-r-lg p-2 ${view === 'grid' ? 'bg-[var(--gantry-bg-tertiary)] text-[var(--gantry-accent)]' : 'text-[var(--gantry-text-secondary)]'}`}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Kind tabs */}
      <div className="mt-4 flex gap-1 overflow-x-auto border-b border-[var(--gantry-border)]">
        <button
          onClick={() => navigate('/catalog')}
          className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            !kind
              ? 'border-[var(--gantry-accent)] text-[var(--gantry-accent)]'
              : 'border-transparent text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)]'
          }`}
        >
          All
        </button>
        {ENTITY_KINDS.map((k) => (
          <button
            key={k.name}
            onClick={() => navigate(`/catalog/${k.name}`)}
            className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              kind === k.name
                ? 'border-[var(--gantry-accent)] text-[var(--gantry-accent)]'
                : 'border-transparent text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)]'
            }`}
          >
            {k.name}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="mt-6">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--gantry-accent)] border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--gantry-border)] py-16">
            <p className="text-sm text-[var(--gantry-text-secondary)]">
              {hasFilters ? 'No entities match your filters.' : 'No entities yet.'}
            </p>
            {!hasFilters && canWrite && (
              <button
                onClick={() => openCreate()}
                className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--gantry-border)] px-4 py-2 text-sm text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-tertiary)]"
              >
                <Plus className="h-4 w-4" />
                Create your first entity
              </button>
            )}
          </div>
        ) : view === 'table' ? (
          <EntityTable entities={filtered} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((e) => (
              <EntityCard key={`${e.kind}-${e.metadata.name}`} entity={e} />
            ))}
          </div>
        )}
      </div>

      {/* Create Panel */}
      {showCreate && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={closeCreate}
          />
          {/* Slide-over panel */}
          <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col bg-[var(--gantry-bg-primary)] shadow-2xl">
            {/* Panel header */}
            <div className="flex items-center justify-between border-b border-[var(--gantry-border)] px-6 py-4">
              <div className="flex items-center gap-3">
                {createStep === 'form' && (
                  <button
                    onClick={() => setCreateStep('kind')}
                    className="flex items-center gap-1 text-sm text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)]"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </button>
                )}
                <div>
                  <h2 className="text-lg font-semibold text-[var(--gantry-text-primary)]">
                    {createStep === 'kind' ? 'Create Entity' : `New ${createKind}`}
                  </h2>
                  <p className="text-xs text-[var(--gantry-text-secondary)]">
                    {createStep === 'kind' ? 'Choose a kind to get started' : 'Fill in the details below'}
                  </p>
                </div>
              </div>
              <button
                onClick={closeCreate}
                className="rounded-lg p-1.5 text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)] hover:text-[var(--gantry-text-primary)]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Step 1: Kind picker */}
            {createStep === 'kind' && (
              <div className="flex-1 overflow-y-auto p-6">
                <p className="mb-6 text-sm text-[var(--gantry-text-secondary)]">
                  Select the type of entity you want to add to the catalog.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {ENTITY_KINDS.map((k) => {
                    const meta = KIND_META[k.name];
                    return (
                      <button
                        key={k.name}
                        onClick={() => { setCreateKind(k.name); setCreateStep('form'); }}
                        className="group flex items-start gap-4 rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] p-4 text-left transition-all hover:border-[var(--gantry-accent)] hover:shadow-md"
                      >
                        <div className={`mt-0.5 shrink-0 ${meta?.color ?? 'text-[var(--gantry-accent)]'}`}>
                          {meta?.icon}
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-[var(--gantry-text-primary)] group-hover:text-[var(--gantry-accent)]">
                            {k.name}
                          </div>
                          <div className="mt-1 text-xs leading-relaxed text-[var(--gantry-text-secondary)]">
                            {meta?.description}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Step 2: Form */}
            {createStep === 'form' && (
              <div className="flex-1 overflow-y-auto p-6">
                {/* Kind badge */}
                <div className="mb-6 flex items-center gap-3 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-4 py-3">
                  <div className={`shrink-0 ${KIND_META[createKind]?.color ?? 'text-[var(--gantry-accent)]'}`}>
                    {KIND_META[createKind]?.icon}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-[var(--gantry-text-primary)]">{createKind}</div>
                    <div className="text-xs text-[var(--gantry-text-secondary)]">{KIND_META[createKind]?.description}</div>
                  </div>
                </div>
                <SchemaForm
                  schema={createSchema}
                  onSubmit={handleCreate}
                  onCancel={closeCreate}
                  submitLabel={`Create ${createKind}`}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
