import { useState, type Dispatch, type KeyboardEvent, type ReactNode, type SetStateAction } from 'react';
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Plus,
  Trash2,
} from 'lucide-react';
import type { PluginConfig, PluginRegistryEntry } from '../lib/types';

export const SYNCABLE_PLUGINS = new Set(['kubernetes', 'github', 'argocd']);

function isSecret(key: string): boolean {
  return ['key', 'token', 'secret', 'password', 'privatekey'].some((s) =>
    key.toLowerCase().includes(s)
  );
}

function isLongText(key: string): boolean {
  return ['privatekey', 'pem', 'certificate', 'cadata'].some((s) =>
    key.toLowerCase().includes(s)
  );
}

const PLUGIN_SECTIONS: Record<string, Array<{
  title: string;
  description?: string;
  fields: string[];
  renderBanner?: () => ReactNode;
}>> = {
  argocd: [
    {
      title: 'Instances',
      description: 'Add one or more ArgoCD instances to discover applications from. Each instance can use token or username/password auth.',
      fields: ['instances'],
    },
    {
      title: 'Global Settings',
      description: 'Applied across all instances.',
      fields: ['labelKey', 'syncInterval'],
    },
  ],
  github: [
    {
      title: 'Authentication',
      description: 'Choose how Gantry connects to the GitHub API. Use a Personal Access Token for personal accounts or GitHub App for organization-wide access.',
      fields: ['authMode', 'personalAccessToken', 'appId', 'privateKey', 'installationId'],
    },
    {
      title: 'GitHub SSO',
      description: 'Let users sign in to Gantry with their GitHub account via OAuth. Requires a GitHub OAuth App.',
      fields: ['ssoEnabled', 'oauthClientId', 'oauthClientSecret', 'defaultRole'],
      renderBanner: () => {
        const origin = window.location.origin;
        return (
          <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-800 dark:bg-blue-900/20">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 text-base leading-none text-blue-500">i</span>
              <div>
                <p className="text-sm font-medium text-blue-800 dark:text-blue-300">GitHub OAuth App required</p>
                <p className="mt-0.5 text-xs text-blue-700 dark:text-blue-400">
                  Create an OAuth App at{' '}
                  <a
                    href="https://github.com/settings/applications/new"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline"
                  >
                    github.com/settings/applications/new
                  </a>{' '}
                  and set these values:
                </p>
              </div>
            </div>
            <div className="space-y-2 pl-6">
              <div>
                <p className="mb-0.5 text-xs font-semibold text-blue-700 dark:text-blue-400">Homepage URL</p>
                <code className="block rounded bg-blue-100 px-2.5 py-1.5 font-mono text-xs text-blue-900 dark:bg-blue-900/40 dark:text-blue-200">
                  {origin}
                </code>
              </div>
              <div>
                <p className="mb-0.5 text-xs font-semibold text-blue-700 dark:text-blue-400">Authorization callback URL</p>
                <code className="block rounded bg-blue-100 px-2.5 py-1.5 font-mono text-xs text-blue-900 dark:bg-blue-900/40 dark:text-blue-200">
                  {origin}/api/v1/auth/github/callback
                </code>
              </div>
            </div>
          </div>
        );
      },
    },
  ],
  'microsoft-azure': [
    {
      title: 'Microsoft Azure SSO',
      description: 'Let users sign in to Gantry with Microsoft Entra ID / Azure AD via OAuth 2.0 and Microsoft Graph.',
      fields: ['ssoEnabled', 'tenantId', 'clientId', 'clientSecret', 'scopes', 'autoProvision', 'defaultRole'],
      renderBanner: () => {
        const origin = window.location.origin;
        return (
          <div className="space-y-3 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-tertiary)] px-4 py-3">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 text-base leading-none text-[var(--gantry-accent)]">i</span>
              <div>
                <p className="text-sm font-medium text-[var(--gantry-text-primary)]">Azure app registration required</p>
                <p className="mt-0.5 text-xs text-[var(--gantry-text-secondary)]">
                  Create an app registration in the Azure portal, add the Microsoft Graph <code>User.Read</code> delegated permission, and configure this redirect URI:
                </p>
              </div>
            </div>
            <div className="space-y-2 pl-6">
              <div>
                <p className="mb-0.5 text-xs font-semibold text-[var(--gantry-text-primary)]">Redirect URI</p>
                <code className="block rounded border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-2.5 py-1.5 font-mono text-xs text-[var(--gantry-text-primary)]">
                  {origin}/api/v1/auth/azure/callback
                </code>
              </div>
              <p className="text-xs text-[var(--gantry-text-secondary)]">
                Use <code>common</code> as the tenant ID for multi-tenant sign-in, or set a specific tenant ID / domain to restrict access.
              </p>
            </div>
          </div>
        );
      },
    },
  ],
  teams: [
    {
      title: 'Delivery',
      description: 'Configure the Teams channel webhook Gantry should post action lifecycle updates to.',
      fields: ['incomingWebhookSecret', 'gantryBaseUrl', 'titlePrefix'],
      renderBanner: () => (
        <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-tertiary)] px-4 py-3">
          <p className="text-sm font-medium text-[var(--gantry-text-primary)]">Microsoft Teams incoming webhook</p>
          <p className="mt-1 text-xs text-[var(--gantry-text-secondary)]">
            Create an incoming webhook in the target Teams channel, then paste the webhook URL here. Gantry uses it to send action start, success, and failure notifications.
          </p>
        </div>
      ),
    },
    {
      title: 'Events',
      description: 'Choose which Gantry action lifecycle events should be delivered to Teams.',
      fields: ['notifyOnStart', 'notifyOnSuccess', 'notifyOnFailure'],
    },
  ],
};

type VisibilityFn = (values: Record<string, any>) => boolean;

const FIELD_VISIBILITY: Record<string, Record<string, VisibilityFn>> = {
  github: {
    personalAccessToken: (v) => !v.authMode || v.authMode === 'pat',
    appId: (v) => v.authMode === 'app',
    privateKey: (v) => v.authMode === 'app',
    installationId: (v) => v.authMode === 'app',
    oauthClientId: (v) => !!v.ssoEnabled,
    oauthClientSecret: (v) => !!v.ssoEnabled,
    defaultRole: (v) => !!v.ssoEnabled,
  },
  'microsoft-azure': {
    tenantId: (v) => !!v.ssoEnabled,
    clientId: (v) => !!v.ssoEnabled,
    clientSecret: (v) => !!v.ssoEnabled,
    scopes: (v) => !!v.ssoEnabled,
    autoProvision: (v) => !!v.ssoEnabled,
    defaultRole: (v) => !!v.ssoEnabled,
  },
};

function StringArraySortField({
  value,
  onChange,
  title,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  title: string;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [newItem, setNewItem] = useState('');

  function moveItem(from: number, to: number) {
    if (from === to) return;
    const next = [...value];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  }

  function removeItem(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  function addItem() {
    const trimmed = newItem.trim();
    if (!trimmed || value.includes(trimmed)) return;
    onChange([...value, trimmed]);
    setNewItem('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addItem();
    }
  }

  return (
    <div className="space-y-2">
      {value.length > 0 ? (
        <div className="divide-y divide-[var(--gantry-border)] overflow-hidden rounded-lg border border-[var(--gantry-border)]">
          {value.map((item, idx) => (
            <div
              key={`${item}-${idx}`}
              draggable
              onDragStart={() => setDragIdx(idx)}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverIdx(idx);
              }}
              onDrop={() => {
                if (dragIdx !== null && dragIdx !== idx) moveItem(dragIdx, idx);
                setDragIdx(null);
                setDragOverIdx(null);
              }}
              onDragEnd={() => {
                setDragIdx(null);
                setDragOverIdx(null);
              }}
              className={`flex items-center gap-2 bg-[var(--gantry-bg-primary)] px-3 py-2 transition-colors ${
                dragIdx === idx ? 'opacity-40' : ''
              } ${
                dragOverIdx === idx && dragIdx !== idx
                  ? 'border-t-2 border-t-[var(--gantry-accent)]'
                  : ''
              }`}
            >
              <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-[var(--gantry-text-secondary)] opacity-40 hover:opacity-100 active:cursor-grabbing" />
              <span className="flex-1 select-none text-sm text-[var(--gantry-text-primary)]">{item}</span>
              <span className="tabular-nums text-[10px] text-[var(--gantry-text-secondary)]">{idx + 1}</span>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  disabled={idx === 0}
                  onClick={() => moveItem(idx, idx - 1)}
                  className="rounded p-0.5 text-[var(--gantry-text-secondary)] transition-colors hover:text-[var(--gantry-text-primary)] disabled:cursor-default disabled:opacity-20"
                  title="Move up"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  type="button"
                  disabled={idx === value.length - 1}
                  onClick={() => moveItem(idx, idx + 1)}
                  className="rounded p-0.5 text-[var(--gantry-text-secondary)] transition-colors hover:text-[var(--gantry-text-primary)] disabled:cursor-default disabled:opacity-20"
                  title="Move down"
                >
                  <ChevronDown size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  className="ml-1 rounded p-0.5 text-[var(--gantry-text-secondary)] transition-colors hover:text-red-500"
                  title="Remove"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--gantry-border)] px-4 py-3 text-center">
          <p className="text-xs text-[var(--gantry-text-secondary)]">
            No items configured. Add {title.toLowerCase()} below.
          </p>
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Add ${title.toLowerCase().replace(/s$/, '')}...`}
          className="flex-1 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-3 py-1.5 text-sm text-[var(--gantry-text-primary)] placeholder:text-[var(--gantry-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--gantry-accent)]"
        />
        <button
          type="button"
          onClick={addItem}
          disabled={!newItem.trim() || value.includes(newItem.trim())}
          className="flex items-center gap-1 rounded-lg border border-[var(--gantry-border)] px-3 py-1.5 text-xs font-medium text-[var(--gantry-accent)] transition-colors hover:bg-[var(--gantry-accent)]/10 disabled:cursor-default disabled:opacity-40"
        >
          <Plus size={13} />
          Add
        </button>
      </div>
    </div>
  );
}

function ConfigField({
  fieldKey,
  fieldSchema,
  value,
  required,
  onChange,
}: {
  fieldKey: string;
  fieldSchema: any;
  value: any;
  required: boolean;
  onChange: (v: any) => void;
}) {
  const isBool = fieldSchema.type === 'boolean';
  const isEnum = Array.isArray(fieldSchema.enum);
  const isArr = fieldSchema.type === 'array' && fieldSchema.items?.type === 'object';
  const isStringArr = fieldSchema.type === 'array' && fieldSchema.items?.type === 'string';
  const isLong = isLongText(fieldKey);

  if (isStringArr) {
    return (
      <div>
        <label className="mb-1 block text-sm font-medium text-[var(--gantry-text-primary)]">
          {fieldSchema.title ?? fieldKey}
          {required && <span className="ml-1 text-red-500">*</span>}
        </label>
        {fieldSchema.description && (
          <p className="mb-2 text-xs text-[var(--gantry-text-secondary)]">{fieldSchema.description}</p>
        )}
        <StringArraySortField
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
          title={fieldSchema.title ?? fieldKey}
        />
      </div>
    );
  }

  if (isArr) {
    return (
      <div>
        <label className="mb-1 block text-sm font-medium text-[var(--gantry-text-primary)]">
          {fieldSchema.title ?? fieldKey}
          {required && <span className="ml-1 text-red-500">*</span>}
        </label>
        {fieldSchema.description && (
          <p className="mb-2 text-xs text-[var(--gantry-text-secondary)]">{fieldSchema.description}</p>
        )}
        <ArrayObjectField
          fieldKey={fieldKey}
          schema={fieldSchema}
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
        />
      </div>
    );
  }

  if (isBool) {
    const effectiveValue = value ?? fieldSchema.default ?? false;
    return (
      <div className="flex items-start justify-between gap-6 py-1">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--gantry-text-primary)]">
            {fieldSchema.title ?? fieldKey}
          </p>
          {fieldSchema.description && (
            <p className="mt-0.5 text-xs text-[var(--gantry-text-secondary)]">{fieldSchema.description}</p>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!!effectiveValue}
          onClick={() => onChange(!effectiveValue)}
          className={`relative mt-0.5 inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--gantry-accent)] focus:ring-offset-2 ${
            effectiveValue ? 'bg-[var(--gantry-accent)]' : 'bg-[var(--gantry-border)]'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${
              effectiveValue ? 'translate-x-[19px]' : 'translate-x-[3px]'
            }`}
          />
        </button>
      </div>
    );
  }

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-[var(--gantry-text-primary)]">
        {fieldSchema.title ?? fieldKey}
        {required && <span className="ml-1 text-red-500">*</span>}
      </label>
      {fieldSchema.description && (
        <p className="mb-2 text-xs text-[var(--gantry-text-secondary)]">{fieldSchema.description}</p>
      )}
      {isEnum ? (
        <select
          className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gantry-accent)]"
          value={value ?? fieldSchema.default ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          {!value && !fieldSchema.default && <option value="" disabled>Select...</option>}
          {fieldSchema.enum.map((opt: string) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : isLong ? (
        <textarea
          rows={6}
          className="w-full resize-y rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-3 py-2 font-mono text-sm text-[var(--gantry-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gantry-accent)]"
          value={typeof value === 'string' ? value : ''}
          placeholder={fieldSchema.description ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          type={isSecret(fieldKey) ? 'password' : 'text'}
          className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gantry-accent)]"
          value={typeof value === 'string' ? value : (value ?? '')}
          placeholder={typeof fieldSchema.default === 'string' ? fieldSchema.default : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

function ArrayObjectField({
  fieldKey,
  schema,
  value,
  onChange,
}: {
  fieldKey: string;
  schema: any;
  value: Record<string, any>[];
  onChange: (v: Record<string, any>[]) => void;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set([0]));
  const itemSchema = schema.items ?? {};
  const itemProps: Record<string, any> = itemSchema.properties ?? {};
  const itemRequired: string[] = itemSchema.required ?? [];

  function addRow() {
    const next = [...value, {}];
    onChange(next);
    setExpanded((s) => new Set(s).add(next.length - 1));
  }

  function removeRow(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
    setExpanded((s) => {
      const next = new Set<number>();
      s.forEach((entry) => {
        if (entry < i) next.add(entry);
        if (entry > i) next.add(entry - 1);
      });
      return next;
    });
  }

  function updateField(i: number, key: string, val: any) {
    onChange(value.map((row, idx) => idx === i ? { ...row, [key]: val } : row));
  }

  function toggleExpand(i: number) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  const nameKey = Object.keys(itemProps).find((k) => k === 'name' || k === 'title') ?? null;
  const bodyProps = Object.entries(itemProps).filter(([k]) => k !== nameKey);

  return (
    <div className="space-y-2">
      {value.map((row, i) => {
        const open = expanded.has(i);
        const namePropSchema = nameKey ? itemProps[nameKey] : null;
        return (
          <div key={i} className="overflow-hidden rounded-lg border border-[var(--gantry-border)]">
            <div className="flex items-center gap-2 bg-[var(--gantry-bg-tertiary)] px-3 py-2">
              {nameKey ? (
                <input
                  type="text"
                  className="min-w-0 flex-1 bg-transparent text-sm font-medium text-[var(--gantry-text-primary)] placeholder:text-[var(--gantry-text-secondary)] outline-none"
                  value={row[nameKey] ?? ''}
                  placeholder={namePropSchema?.description ? 'e.g. prod-us-east' : `${schema.title ?? fieldKey} ${i + 1}`}
                  onChange={(e) => updateField(i, nameKey, e.target.value)}
                />
              ) : (
                <span className="flex-1 text-sm font-medium text-[var(--gantry-text-primary)]">
                  {`${schema.title ?? fieldKey} ${i + 1}`}
                </span>
              )}
              <div className="flex flex-shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => toggleExpand(i)}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[var(--gantry-text-secondary)] transition-colors hover:text-[var(--gantry-text-primary)]"
                >
                  {open ? <><ChevronUp size={13} /> Less</> : <><ChevronDown size={13} /> More</>}
                </button>
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="p-0.5 text-[var(--gantry-text-secondary)] transition-colors hover:text-red-500"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
            {open && (
              <div className="space-y-3 border-t border-[var(--gantry-border)] px-3 py-3">
                {bodyProps.map(([key, propSchema]: [string, any]) => (
                  <div key={key}>
                    <label className="mb-0.5 block text-xs font-medium text-[var(--gantry-text-primary)]">
                      {propSchema.title ?? key}
                      {itemRequired.includes(key) && <span className="ml-1 text-red-500">*</span>}
                    </label>
                    {propSchema.description && (
                      <p className="mb-1 text-xs text-[var(--gantry-text-secondary)]">{propSchema.description}</p>
                    )}
                    {Array.isArray(propSchema.enum) ? (
                      <select
                        className="w-full rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-2.5 py-1.5 text-xs text-[var(--gantry-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gantry-accent)]"
                        value={row[key] ?? propSchema.default ?? ''}
                        onChange={(e) => updateField(i, key, e.target.value)}
                      >
                        {propSchema.enum.map((opt: string) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : isLongText(key) ? (
                      <textarea
                        rows={4}
                        className="w-full resize-y rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-2.5 py-1.5 font-mono text-xs text-[var(--gantry-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gantry-accent)]"
                        value={row[key] ?? ''}
                        onChange={(e) => updateField(i, key, e.target.value)}
                      />
                    ) : (
                      <input
                        type={isSecret(key) ? 'password' : 'text'}
                        className="w-full rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-2.5 py-1.5 text-xs text-[var(--gantry-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gantry-accent)]"
                        value={row[key] ?? ''}
                        placeholder={propSchema.default ?? ''}
                        onChange={(e) => updateField(i, key, e.target.value)}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={addRow}
        className="flex items-center gap-1.5 py-1 text-xs font-medium text-[var(--gantry-accent)] transition-opacity hover:opacity-80"
      >
        <Plus size={13} />
        Add {schema.title ? schema.title.replace(/s$/, '') : 'item'}
      </button>
    </div>
  );
}

export function PluginConfigForm({
  plugin,
  config,
  values,
  setValues,
}: {
  plugin: PluginRegistryEntry;
  config: PluginConfig | null;
  values: Record<string, any>;
  setValues: Dispatch<SetStateAction<Record<string, any>>>;
}) {
  const allFields: Record<string, any> = config?.schema?.properties ?? {};
  const required: string[] = config?.schema?.required ?? [];
  const sections = PLUGIN_SECTIONS[plugin.name];
  const visibility = FIELD_VISIBILITY[plugin.name] ?? {};

  const sectionedKeys = sections ? new Set(sections.flatMap((section) => section.fields)) : null;
  const ungroupedKeys = sections
    ? Object.keys(allFields).filter((key) => !sectionedKeys?.has(key))
    : Object.keys(allFields);

  function isVisible(key: string): boolean {
    const fn = visibility[key];
    return !fn || fn(values);
  }

  function renderField(key: string) {
    const fieldSchema = allFields[key];
    if (!fieldSchema || !isVisible(key)) return null;
    return (
      <ConfigField
        key={key}
        fieldKey={key}
        fieldSchema={fieldSchema}
        value={values[key]}
        required={required.includes(key)}
        onChange={(nextValue) => setValues((prev) => ({ ...prev, [key]: nextValue }))}
      />
    );
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-[var(--gantry-text-secondary)]">
        Loading...
      </div>
    );
  }

  if (Object.keys(allFields).length === 0) {
    return (
      <p className="text-sm text-[var(--gantry-text-secondary)]">
        This plugin has no configuration options.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {sections ? (
        <>
          {sections.map((section) => {
            const anyVisible = section.fields.some((key) => allFields[key] && isVisible(key));
            if (!anyVisible) return null;
            return (
              <div
                key={section.title}
                className="overflow-hidden rounded-lg border border-[var(--gantry-border)]"
              >
                <div className="border-b border-[var(--gantry-border)] bg-[var(--gantry-bg-tertiary)] px-5 py-3.5">
                  <h3 className="text-sm font-semibold text-[var(--gantry-text-primary)]">
                    {section.title}
                  </h3>
                  {section.description && (
                    <p className="mt-0.5 text-xs text-[var(--gantry-text-secondary)]">
                      {section.description}
                    </p>
                  )}
                </div>
                <div className="space-y-4 bg-[var(--gantry-bg-primary)] px-5 py-4">
                  {section.renderBanner?.()}
                  {section.fields.map((key) => renderField(key))}
                </div>
              </div>
            );
          })}
          {ungroupedKeys.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-[var(--gantry-border)]">
              <div className="border-b border-[var(--gantry-border)] bg-[var(--gantry-bg-tertiary)] px-5 py-3.5">
                <h3 className="text-sm font-semibold text-[var(--gantry-text-primary)]">Other</h3>
              </div>
              <div className="space-y-4 bg-[var(--gantry-bg-primary)] px-5 py-4">
                {ungroupedKeys.map((key) => renderField(key))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="space-y-4">
          {ungroupedKeys.map((key) => renderField(key))}
        </div>
      )}
    </div>
  );
}
