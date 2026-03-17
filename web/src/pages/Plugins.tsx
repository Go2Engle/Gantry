import React, { useState, useEffect } from 'react';
import {
  Package, CheckCircle, Circle, Settings, ExternalLink, Search, Puzzle,
  RefreshCw, Plus, Trash2, ChevronDown, ChevronUp, X,
  BookOpen, Zap, Layers, CheckSquare,
} from 'lucide-react';
import { api } from '../lib/api';
import type { PluginRegistryEntry, PluginConfig, PluginSyncResult } from '../lib/types';

// Plugins that expose a server-side sync operation.
const SYNCABLE_PLUGINS = new Set(['kubernetes', 'github', 'argocd']);

// Plugins with full backend + frontend implementations.
// Anything not in this set is shown as "Coming Soon" and cannot be enabled.
const IMPLEMENTED_PLUGINS = new Set(['github', 'kubernetes', 'argocd', 'status-monitor', 'gitops', 'teams', 'harbor', 'nexus-repository-manager']);

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'integration', label: 'Integrations' },
  { id: 'widget', label: 'Widgets' },
  { id: 'action-type', label: 'Action Types' },
  { id: 'entity-kind', label: 'Entity Kinds' },
  { id: 'auth-provider', label: 'Auth Providers' },
];

const CATEGORY_COLORS: Record<string, string> = {
  integration: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  widget: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  'action-type': 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  'entity-kind': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  'auth-provider': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

// Subtle background accent per category for the icon area in the detail modal.
const CATEGORY_ICON_BG: Record<string, string> = {
  integration: 'bg-blue-500/10 text-blue-500',
  widget: 'bg-purple-500/10 text-purple-500',
  'action-type': 'bg-orange-500/10 text-orange-500',
  'entity-kind': 'bg-green-500/10 text-green-500',
  'auth-provider': 'bg-red-500/10 text-red-500',
};

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

// ── Per-plugin section definitions ─────────────────────────────────────────
const PLUGIN_SECTIONS: Record<string, Array<{
  title: string;
  description?: string;
  fields: string[];
  renderBanner?: () => React.ReactNode;
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
          <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20 px-4 py-3 space-y-3">
            <div className="flex items-start gap-2">
              <span className="text-blue-500 text-base leading-none mt-0.5">ℹ</span>
              <div>
                <p className="text-sm font-medium text-blue-800 dark:text-blue-300">GitHub OAuth App required</p>
                <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">
                  Create an OAuth App at{' '}
                  <a
                    href="https://github.com/settings/applications/new"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-medium"
                  >
                    github.com/settings/applications/new
                  </a>{' '}
                  and set these values:
                </p>
              </div>
            </div>
            <div className="space-y-2 pl-6">
              <div>
                <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-0.5">Homepage URL</p>
                <code className="block text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-900 dark:text-blue-200 font-mono px-2.5 py-1.5 rounded">
                  {origin}
                </code>
              </div>
              <div>
                <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-0.5">Authorization callback URL</p>
                <code className="block text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-900 dark:text-blue-200 font-mono px-2.5 py-1.5 rounded">
                  {origin}/api/v1/auth/github/callback
                </code>
              </div>
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

// Conditional field visibility
type VisibilityFn = (values: Record<string, any>) => boolean;
const FIELD_VISIBILITY: Record<string, Record<string, VisibilityFn>> = {
  github: {
    personalAccessToken: (v) => !v.authMode || v.authMode === 'pat',
    appId:              (v) => v.authMode === 'app',
    privateKey:         (v) => v.authMode === 'app',
    installationId:     (v) => v.authMode === 'app',
    oauthClientId:      (v) => !!v.ssoEnabled,
    oauthClientSecret:  (v) => !!v.ssoEnabled,
    defaultRole:        (v) => !!v.ssoEnabled,
  },
};

// ── ConfigField ──────────────────────────────────────────────────────────────
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
  const isArr  = fieldSchema.type === 'array' && fieldSchema.items?.type === 'object';
  const isLong = isLongText(fieldKey);

  if (isArr) {
    return (
      <div>
        <label className="block text-sm font-medium text-[var(--gantry-text-primary)] mb-1">
          {fieldSchema.title ?? fieldKey}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
        {fieldSchema.description && (
          <p className="text-xs text-[var(--gantry-text-secondary)] mb-2">{fieldSchema.description}</p>
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
    return (
      <div className="flex items-start justify-between gap-6 py-1">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--gantry-text-primary)]">
            {fieldSchema.title ?? fieldKey}
          </p>
          {fieldSchema.description && (
            <p className="text-xs text-[var(--gantry-text-secondary)] mt-0.5">{fieldSchema.description}</p>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!!value}
          onClick={() => onChange(!value)}
          className={`relative flex-shrink-0 mt-0.5 inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--gantry-accent)] focus:ring-offset-2 ${
            value ? 'bg-[var(--gantry-accent)]' : 'bg-[var(--gantry-border)]'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${
              value ? 'translate-x-[19px]' : 'translate-x-[3px]'
            }`}
          />
        </button>
      </div>
    );
  }

  return (
    <div>
      <label className="block text-sm font-medium text-[var(--gantry-text-primary)] mb-1">
        {fieldSchema.title ?? fieldKey}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {fieldSchema.description && (
        <p className="text-xs text-[var(--gantry-text-secondary)] mb-2">{fieldSchema.description}</p>
      )}
      {isEnum ? (
        <select
          className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gantry-accent)]"
          value={value ?? fieldSchema.default ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          {!value && !fieldSchema.default && (
            <option value="" disabled>Select…</option>
          )}
          {fieldSchema.enum.map((opt: string) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : isLong ? (
        <textarea
          rows={6}
          className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] font-mono focus:outline-none focus:ring-2 focus:ring-[var(--gantry-accent)] resize-y"
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

// ── ArrayObjectField ─────────────────────────────────────────────────────────
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
      const n = new Set<number>();
      s.forEach((v) => { if (v < i) n.add(v); else if (v > i) n.add(v - 1); });
      return n;
    });
  }

  function updateField(i: number, key: string, val: any) {
    onChange(value.map((row, idx) => idx === i ? { ...row, [key]: val } : row));
  }

  function toggleExpand(i: number) {
    setExpanded((s) => {
      const n = new Set(s);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
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
          <div key={i} className="rounded-lg border border-[var(--gantry-border)] overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-[var(--gantry-bg-tertiary)]">
              {nameKey ? (
                <input
                  type="text"
                  className="flex-1 bg-transparent text-sm font-medium text-[var(--gantry-text-primary)] placeholder:text-[var(--gantry-text-secondary)] outline-none min-w-0"
                  value={row[nameKey] ?? ''}
                  placeholder={namePropSchema?.description ? 'e.g. prod-us-east' : `${schema.title ?? fieldKey} ${i + 1}`}
                  onChange={(e) => updateField(i, nameKey, e.target.value)}
                />
              ) : (
                <span className="flex-1 text-sm font-medium text-[var(--gantry-text-primary)]">
                  {`${schema.title ?? fieldKey} ${i + 1}`}
                </span>
              )}
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => toggleExpand(i)}
                  className="flex items-center gap-1 text-xs text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)] transition-colors px-1.5 py-0.5 rounded"
                >
                  {open ? <><ChevronUp size={13} /> Less</> : <><ChevronDown size={13} /> More</>}
                </button>
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="text-[var(--gantry-text-secondary)] hover:text-red-500 transition-colors p-0.5"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
            {open && (
              <div className="px-3 py-3 space-y-3 border-t border-[var(--gantry-border)]">
                {bodyProps.map(([key, propSchema]: [string, any]) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-[var(--gantry-text-primary)] mb-0.5">
                      {propSchema.title ?? key}
                      {itemRequired.includes(key) && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    {propSchema.description && (
                      <p className="text-xs text-[var(--gantry-text-secondary)] mb-1">{propSchema.description}</p>
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
                        className="w-full rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-2.5 py-1.5 text-xs text-[var(--gantry-text-primary)] font-mono focus:outline-none focus:ring-2 focus:ring-[var(--gantry-accent)] resize-y"
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
        className="flex items-center gap-1.5 text-xs font-medium text-[var(--gantry-accent)] hover:opacity-80 transition-opacity py-1"
      >
        <Plus size={13} />
        Add {schema.title ? schema.title.replace(/s$/, '') : 'item'}
      </button>
    </div>
  );
}

// ── ConfigFormBody ────────────────────────────────────────────────────────────
// The scrollable form content shared by the config tab in the detail modal.
function ConfigFormBody({
  plugin,
  config,
  values,
  setValues,
}: {
  plugin: PluginRegistryEntry;
  config: PluginConfig | null;
  values: Record<string, any>;
  setValues: React.Dispatch<React.SetStateAction<Record<string, any>>>;
}) {
  const allFields: Record<string, any> = config?.schema?.properties ?? {};
  const required: string[] = config?.schema?.required ?? [];
  const sections = PLUGIN_SECTIONS[plugin.name];
  const visibility = FIELD_VISIBILITY[plugin.name] ?? {};

  const sectionedKeys = sections ? new Set(sections.flatMap((s) => s.fields)) : null;
  const ungroupedKeys = sections
    ? Object.keys(allFields).filter((k) => !sectionedKeys!.has(k))
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
        onChange={(v) => setValues((prev) => ({ ...prev, [key]: v }))}
      />
    );
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center py-16 text-[var(--gantry-text-secondary)] text-sm">
        Loading…
      </div>
    );
  }

  const hasFields = Object.keys(allFields).length > 0;
  if (!hasFields) {
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
            const anyVisible = section.fields.some((k) => allFields[k] && isVisible(k));
            if (!anyVisible) return null;
            return (
              <div
                key={section.title}
                className="rounded-lg border border-[var(--gantry-border)] overflow-hidden"
              >
                <div className="px-5 py-3.5 bg-[var(--gantry-bg-tertiary)] border-b border-[var(--gantry-border)]">
                  <h3 className="text-sm font-semibold text-[var(--gantry-text-primary)]">
                    {section.title}
                  </h3>
                  {section.description && (
                    <p className="text-xs text-[var(--gantry-text-secondary)] mt-0.5">
                      {section.description}
                    </p>
                  )}
                </div>
                <div className="px-5 py-4 space-y-4 bg-[var(--gantry-bg-primary)]">
                  {section.renderBanner?.()}
                  {section.fields.map((key) => renderField(key))}
                </div>
              </div>
            );
          })}
          {ungroupedKeys.length > 0 && (
            <div className="rounded-lg border border-[var(--gantry-border)] overflow-hidden">
              <div className="px-5 py-3.5 bg-[var(--gantry-bg-tertiary)] border-b border-[var(--gantry-border)]">
                <h3 className="text-sm font-semibold text-[var(--gantry-text-primary)]">Other</h3>
              </div>
              <div className="px-5 py-4 space-y-4 bg-[var(--gantry-bg-primary)]">
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

// ── PluginDetailModal ─────────────────────────────────────────────────────────
// Full-screen overlay with Overview and Configuration tabs.
function PluginDetailModal({
  plugin,
  initialTab,
  syncing,
  syncResult,
  onClose,
  onAction,
  onSync,
}: {
  plugin: PluginRegistryEntry;
  initialTab: 'overview' | 'config';
  syncing: boolean;
  syncResult: PluginSyncResult | null;
  onClose: () => void;
  onAction: (action: 'enable' | 'disable') => void;
  onSync: () => void;
}) {
  const [tab, setTab] = useState<'overview' | 'config'>(initialTab);
  const [config, setConfig] = useState<PluginConfig | null>(null);
  const [values, setValues] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync initialTab if it changes (e.g. when parent reopens with different tab)
  useEffect(() => { setTab(initialTab); }, [initialTab]);

  // Load config whenever we switch to config tab
  useEffect(() => {
    if (tab !== 'config') return;
    if (config) return; // already loaded
    api.getPluginConfig(plugin.name).then((c) => {
      setConfig(c);
      setValues(c.values ?? {});
    }).catch(() => {});
  }, [tab, plugin.name]);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      await api.updatePluginConfig(plugin.name, values);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const comingSoon = !IMPLEMENTED_PLUGINS.has(plugin.name);
  const categoryColor = CATEGORY_COLORS[plugin.category] ?? 'bg-gray-100 text-gray-700';
  const iconBg = CATEGORY_ICON_BG[plugin.category] ?? 'bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]';
  const canSync = !comingSoon && plugin.enabled && SYNCABLE_PLUGINS.has(plugin.name);
  const configHasFields = config && Object.keys(config.schema?.properties ?? {}).length > 0;

  // Parse longDescription paragraphs
  const paragraphs = (plugin.longDescription ?? plugin.description).split('\n\n').filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className="bg-[var(--gantry-bg-secondary)] rounded-xl shadow-2xl w-full flex flex-col overflow-hidden"
        style={{ maxWidth: '860px', maxHeight: '92vh' }}
      >
        {/* ── Header ── */}
        <div className="flex items-start gap-4 px-6 py-5 border-b border-[var(--gantry-border)] flex-shrink-0">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
            <Puzzle size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-[var(--gantry-text-primary)] leading-tight">{plugin.title}</h2>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${categoryColor}`}>
                {CATEGORIES.find((c) => c.id === plugin.category)?.label ?? plugin.category}
              </span>
              <span className={`flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                comingSoon
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                  : plugin.enabled
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-800/30 dark:text-gray-400'
              }`}>
                {comingSoon ? 'Coming Soon' : plugin.enabled ? <><CheckCircle size={10} /> Active</> : <><Circle size={10} /> Disabled</>}
              </span>
            </div>
            <p className="text-xs text-[var(--gantry-text-secondary)] mt-0.5">
              v{plugin.version} · by {plugin.author}
            </p>
          </div>
          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {canSync && (
              <button
                onClick={onSync}
                disabled={syncing}
                title="Sync now"
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-[var(--gantry-border)] text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-tertiary)] transition-colors disabled:opacity-50"
              >
                <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
                Sync
              </button>
            )}
            {!comingSoon && (
              <button
                onClick={() => onAction(plugin.enabled ? 'disable' : 'enable')}
                className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors flex items-center gap-1.5 ${
                  plugin.enabled
                    ? 'border-[var(--gantry-border)] text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-tertiary)]'
                    : 'border-[var(--gantry-accent)] text-[var(--gantry-accent)] hover:bg-[var(--gantry-accent)]/10'
                }`}
              >
                {plugin.enabled ? <><Circle size={12} /> Disable</> : <><CheckCircle size={12} /> Enable</>}
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-tertiary)] transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── Tab bar ── */}
        <div className="flex gap-1 px-6 pt-3 border-b border-[var(--gantry-border)] flex-shrink-0">
          <button
            onClick={() => setTab('overview')}
            className={`flex items-center gap-1.5 px-3 pb-3 text-sm font-medium border-b-2 transition-colors ${
              tab === 'overview'
                ? 'border-[var(--gantry-accent)] text-[var(--gantry-accent)]'
                : 'border-transparent text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)]'
            }`}
          >
            <BookOpen size={14} />
            Overview
          </button>
          {!comingSoon && (
            <button
              onClick={() => setTab('config')}
              className={`flex items-center gap-1.5 px-3 pb-3 text-sm font-medium border-b-2 transition-colors ${
                tab === 'config'
                  ? 'border-[var(--gantry-accent)] text-[var(--gantry-accent)]'
                  : 'border-transparent text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)]'
              }`}
            >
              <Settings size={14} />
              Configuration
            </button>
          )}
        </div>

        {/* ── Body ── */}
        <div className="overflow-y-auto flex-1 px-6 py-6">
          {tab === 'overview' && (
            <div className="space-y-6">
              {comingSoon && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 px-4 py-3">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">This plugin is not yet available.</p>
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">It will be included in a future release of Gantry.</p>
                </div>
              )}
              {/* Description */}
              <div className="space-y-3">
                {paragraphs.map((p, i) => (
                  <p key={i} className="text-sm text-[var(--gantry-text-primary)] leading-relaxed">{p}</p>
                ))}
              </div>

              {/* Features */}
              {plugin.features && plugin.features.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--gantry-text-secondary)] mb-3">
                    What this plugin does
                  </h3>
                  <ul className="space-y-2">
                    {plugin.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm text-[var(--gantry-text-primary)]">
                        <CheckSquare size={15} className="text-[var(--gantry-accent)] flex-shrink-0 mt-0.5" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Metadata grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Entity panels */}
                {plugin.entityPanels && plugin.entityPanels.length > 0 && (
                  <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Layers size={14} className="text-[var(--gantry-text-secondary)]" />
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--gantry-text-secondary)]">
                        Adds panels to
                      </h4>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {plugin.entityPanels.map((kind) => (
                        <span
                          key={kind}
                          className="px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--gantry-bg-tertiary)] text-[var(--gantry-text-primary)] border border-[var(--gantry-border)]"
                        >
                          {kind}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action types */}
                {plugin.actionTypes && plugin.actionTypes.length > 0 && (
                  <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Zap size={14} className="text-[var(--gantry-text-secondary)]" />
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--gantry-text-secondary)]">
                        Action types
                      </h4>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {plugin.actionTypes.map((t) => (
                        <span
                          key={t}
                          className="px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--gantry-bg-tertiary)] text-[var(--gantry-text-primary)] border border-[var(--gantry-border)] font-mono"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Sync result */}
              {syncResult && (
                <div className={`text-xs rounded-lg border px-3 py-2 space-y-1 ${
                  (syncResult.errors?.length ?? 0) > 0
                    ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400'
                    : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
                }`}>
                  <div>
                    {syncResult.enriched != null
                      ? `Enriched ${syncResult.enriched} of ${syncResult.scanned ?? 0} entities`
                      : syncResult.apps != null
                      ? `${syncResult.apps} app${syncResult.apps !== 1 ? 's' : ''} synced: ${syncResult.created ?? 0} created, ${syncResult.updated ?? 0} updated`
                      : `Synced: ${syncResult.created ?? 0} created, ${syncResult.updated ?? 0} updated`}
                    {(syncResult.errors?.length ?? 0) > 0 && ` · ${syncResult.errors!.length} error(s)`}
                  </div>
                  {syncResult.errors?.map((e, i) => (
                    <div key={i} className="text-red-600 dark:text-red-400 font-mono break-all">{e}</div>
                  ))}
                </div>
              )}

              {/* Footer links */}
              <div className="flex items-center gap-4 pt-2 border-t border-[var(--gantry-border)]">
                {plugin.homepage && (
                  <a
                    href={plugin.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-accent)] transition-colors"
                  >
                    <ExternalLink size={12} />
                    View source & docs
                  </a>
                )}
              </div>
            </div>
          )}

          {tab === 'config' && (
            <ConfigFormBody
              plugin={plugin}
              config={config}
              values={values}
              setValues={setValues}
            />
          )}

          {tab === 'config' && saveError && (
            <p className="mt-4 text-sm text-[var(--gantry-danger)]">{saveError}</p>
          )}
        </div>

        {/* ── Footer (config tab only) ── */}
        {tab === 'config' && (
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--gantry-border)] flex-shrink-0 bg-[var(--gantry-bg-secondary)]">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-[var(--gantry-border)] text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-tertiary)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !configHasFields}
              className="px-4 py-2 text-sm rounded-lg bg-[var(--gantry-accent)] text-[var(--gantry-bg-primary)] hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saved ? 'Saved!' : saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── PluginCard ────────────────────────────────────────────────────────────────
function PluginCard({
  plugin,
  syncing,
  syncResult,
  onAction,
  onSync,
  onOpenDetail,
}: {
  plugin: PluginRegistryEntry;
  syncing: boolean;
  syncResult: PluginSyncResult | null;
  onAction: (action: 'enable' | 'disable') => void;
  onSync: () => void;
  onOpenDetail: (tab: 'overview' | 'config') => void;
}) {
  const comingSoon = !IMPLEMENTED_PLUGINS.has(plugin.name);
  const categoryColor = CATEGORY_COLORS[plugin.category] ?? 'bg-gray-100 text-gray-700';
  const iconBg = CATEGORY_ICON_BG[plugin.category] ?? 'bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]';
  const canSync = !comingSoon && plugin.enabled && SYNCABLE_PLUGINS.has(plugin.name);

  return (
    <div className={`group flex flex-col rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] transition-shadow ${comingSoon ? 'opacity-50' : 'hover:shadow-md'}`}>
      {/* Card top accent strip */}
      <div className="h-1 w-full rounded-t-xl bg-[var(--gantry-accent)]/20" />

      {/* Clickable top area → opens detail overlay */}
      <button
        type="button"
        onClick={() => onOpenDetail('overview')}
        className="flex flex-col gap-3 p-5 text-left flex-1 min-h-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gantry-accent)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${iconBg}`}>
              <Puzzle size={19} />
            </div>
            <div>
              <h3 className="font-semibold text-[var(--gantry-text-primary)] text-sm leading-tight">{plugin.title}</h3>
              <p className="text-xs text-[var(--gantry-text-secondary)]">by {plugin.author} · v{plugin.version}</p>
            </div>
          </div>
          {comingSoon ? (
            <span className="flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800/30 dark:text-gray-400">
              Coming Soon
            </span>
          ) : plugin.enabled ? (
            <span className="flex-shrink-0 flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
              <CheckCircle size={10} />
              Active
            </span>
          ) : null}
        </div>

        <p className="text-sm text-[var(--gantry-text-secondary)] line-clamp-2">{plugin.description}</p>

        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${categoryColor}`}>
            {CATEGORIES.find((c) => c.id === plugin.category)?.label ?? plugin.category}
          </span>
        </div>
      </button>

      {/* Sync result inline summary */}
      {syncResult && (
        <div className={`mx-5 mb-3 text-xs rounded-lg border px-3 py-2 space-y-1 ${
          (syncResult.errors?.length ?? 0) > 0
            ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400'
            : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
        }`}>
          <div>
            {syncResult.enriched != null
              ? `Enriched ${syncResult.enriched} of ${syncResult.scanned ?? 0} entities`
              : syncResult.apps != null
              ? `${syncResult.apps} app${syncResult.apps !== 1 ? 's' : ''} synced: ${syncResult.created ?? 0} created, ${syncResult.updated ?? 0} updated`
              : `Synced: ${syncResult.created ?? 0} created, ${syncResult.updated ?? 0} updated`}
            {(syncResult.errors?.length ?? 0) > 0 && ` · ${syncResult.errors!.length} error(s)`}
          </div>
          {syncResult.errors?.map((e, i) => (
            <div key={i} className="text-red-600 dark:text-red-400 font-mono break-all">{e}</div>
          ))}
        </div>
      )}

      {/* Action row */}
      <div className="flex items-center gap-2 px-5 pb-5 pt-1 border-t border-[var(--gantry-border)]">
        <button
          onClick={() => !comingSoon && onAction(plugin.enabled ? 'disable' : 'enable')}
          disabled={comingSoon}
          className={`flex-1 py-1.5 text-xs font-medium rounded-lg border transition-colors flex items-center justify-center gap-1 ${
            comingSoon
              ? 'border-[var(--gantry-border)] text-[var(--gantry-text-secondary)] cursor-not-allowed'
              : plugin.enabled
              ? 'border-[var(--gantry-border)] text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-tertiary)]'
              : 'border-[var(--gantry-accent)] text-[var(--gantry-accent)] hover:bg-[var(--gantry-accent)]/10'
          }`}
        >
          {plugin.enabled ? (
            <><Circle size={10} /> Disable</>
          ) : (
            <><CheckCircle size={10} /> Enable</>
          )}
        </button>
        {canSync && (
          <button
            onClick={onSync}
            disabled={syncing}
            title="Sync now"
            className="py-1.5 px-3 text-xs font-medium rounded-lg border border-[var(--gantry-border)] text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-tertiary)] transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
          </button>
        )}
        {!comingSoon && (
          <button
            onClick={() => onOpenDetail('config')}
            title="Configure"
            className="py-1.5 px-3 text-xs font-medium rounded-lg border border-[var(--gantry-border)] text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-tertiary)] transition-colors"
          >
            <Settings size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Plugins page ─────────────────────────────────────────────────────────
export default function Plugins() {
  const [plugins, setPlugins] = useState<PluginRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [tab, setTab] = useState<'browse' | 'installed'>('browse');
  const [detail, setDetail] = useState<{ plugin: PluginRegistryEntry; tab: 'overview' | 'config' } | null>(null);
  const [syncingPlugins, setSyncingPlugins] = useState<Set<string>>(new Set());
  const [syncResults, setSyncResults] = useState<Record<string, PluginSyncResult>>({});

  useEffect(() => {
    api.listPlugins()
      .then(setPlugins)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleAction(plugin: PluginRegistryEntry, action: 'enable' | 'disable') {
    try {
      if (action === 'enable') {
        try {
          await api.enablePlugin(plugin.name, true);
          setPlugins((prev) => prev.map((p) => p.name === plugin.name ? { ...p, enabled: true } : p));
          if (detail?.plugin.name === plugin.name) {
            setDetail((d) => d ? { ...d, plugin: { ...d.plugin, enabled: true } } : null);
          }
        } catch (e: any) {
          // If enabling fails due to missing config, open the config modal
          if (e.message?.includes('required configuration fields')) {
            setDetail({ plugin, tab: 'config' });
            return;
          }
          throw e;
        }
      } else if (action === 'disable') {
        await api.enablePlugin(plugin.name, false);
        setPlugins((prev) => prev.map((p) => p.name === plugin.name ? { ...p, enabled: false } : p));
        if (detail?.plugin.name === plugin.name) {
          setDetail((d) => d ? { ...d, plugin: { ...d.plugin, enabled: false } } : null);
        }
      }
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleSync(pluginName: string) {
    setSyncingPlugins((s) => new Set(s).add(pluginName));
    setSyncResults((r) => { const n = { ...r }; delete n[pluginName]; return n; });
    try {
      const result = await api.syncPlugin(pluginName);
      setSyncResults((r) => ({ ...r, [pluginName]: result }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSyncingPlugins((s) => { const n = new Set(s); n.delete(pluginName); return n; });
    }
  }

  const filtered = plugins.filter((p) => {
    const matchSearch =
      !search ||
      p.title.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase());
    const matchCategory = category === 'all' || p.category === category;
    const matchTab = tab === 'browse' || p.enabled;
    return matchSearch && matchCategory && matchTab;
  }).sort((a, b) => {
    const aImpl = IMPLEMENTED_PLUGINS.has(a.name) ? 0 : 1;
    const bImpl = IMPLEMENTED_PLUGINS.has(b.name) ? 0 : 1;
    return aImpl - bImpl;
  });

  const enabledCount = plugins.filter((p) => p.enabled).length;

  // Keep detail plugin state in sync with the canonical plugins list
  const detailPlugin = detail
    ? (plugins.find((p) => p.name === detail.plugin.name) ?? detail.plugin)
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--gantry-text-primary)]">Plugins</h1>
          <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">
            Browse and manage plugins to extend Gantry with integrations, widgets, and more.
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm text-[var(--gantry-text-secondary)]">
          <span>{plugins.length} available</span>
          <span>{enabledCount} enabled</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-[var(--gantry-border)]">
        <div className="flex gap-6">
          {(['browse', 'installed'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t
                  ? 'border-[var(--gantry-accent)] text-[var(--gantry-accent)]'
                  : 'border-transparent text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)]'
              }`}
            >
              {t === 'browse' ? 'Browse' : `Enabled${enabledCount > 0 ? ` (${enabledCount})` : ''}`}
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-shrink-0">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--gantry-text-secondary)]" />
          <input
            type="text"
            placeholder="Search plugins…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] pl-8 pr-4 py-2 text-sm text-[var(--gantry-text-primary)] placeholder-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none sm:w-52"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${
                category === cat.id
                  ? 'bg-[var(--gantry-accent)] text-[var(--gantry-bg-primary)]'
                  : 'bg-[var(--gantry-bg-secondary)] text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)] hover:text-[var(--gantry-text-primary)]'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--gantry-accent)] border-t-transparent" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--gantry-border)] py-20">
          <div className="rounded-xl bg-[var(--gantry-bg-primary)] p-4">
            <Package size={32} className="text-[var(--gantry-text-secondary)]" />
          </div>
          <p className="mt-4 text-sm font-medium text-[var(--gantry-text-primary)]">No plugins found</p>
          <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">Try adjusting your search or filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((plugin) => (
            <PluginCard
              key={plugin.name}
              plugin={plugin}
              syncing={syncingPlugins.has(plugin.name)}
              syncResult={syncResults[plugin.name] ?? null}
              onAction={(action) => handleAction(plugin, action)}
              onSync={() => handleSync(plugin.name)}
              onOpenDetail={(t) => setDetail({ plugin, tab: t })}
            />
          ))}
        </div>
      )}

      {/* Detail modal */}
      {detail && detailPlugin && (
        <PluginDetailModal
          plugin={detailPlugin}
          initialTab={detail.tab}
          syncing={syncingPlugins.has(detailPlugin.name)}
          syncResult={syncResults[detailPlugin.name] ?? null}
          onClose={() => setDetail(null)}
          onAction={(action) => handleAction(detailPlugin, action)}
          onSync={() => handleSync(detailPlugin.name)}
        />
      )}
    </div>
  );
}
