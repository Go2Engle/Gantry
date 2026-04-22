import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Package,
  RefreshCw,
  Settings,
  Slash,
} from 'lucide-react';
import { api, PLUGINS_UPDATED_EVENT } from '../lib/api';
import { applySchemaDefaults } from '../lib/utils';
import type { PluginConfig, PluginRegistryEntry, PluginSyncResult } from '../lib/types';
import { PluginConfigForm, SYNCABLE_PLUGINS } from './PluginConfigForm';

function PluginSettingsCard({
  plugin,
  expanded,
  loadingConfig,
  config,
  values,
  syncResult,
  syncing,
  saving,
  saved,
  saveError,
  loadError,
  onToggleExpanded,
  onValuesChange,
  onSave,
  onDisable,
  onSync,
}: {
  plugin: PluginRegistryEntry;
  expanded: boolean;
  loadingConfig: boolean;
  config: PluginConfig | null;
  values: Record<string, any>;
  syncResult: PluginSyncResult | null;
  syncing: boolean;
  saving: boolean;
  saved: boolean;
  saveError: string | null;
  loadError: string | null;
  onToggleExpanded: () => void;
  onValuesChange: Dispatch<SetStateAction<Record<string, any>>>;
  onSave: () => void;
  onDisable: () => void;
  onSync: () => void;
}) {
  const categoryLabel = plugin.category.replace('-', ' ');
  const canSync = SYNCABLE_PLUGINS.has(plugin.name);
  const configHasFields = Object.keys(config?.schema?.properties ?? {}).length > 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
      <div className="border-b border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-5 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-[var(--gantry-text-primary)]">{plugin.title}</h3>
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                <CheckCircle className="h-3 w-3" />
                Enabled
              </span>
              <span className="rounded-full border border-[var(--gantry-border)] px-2 py-0.5 text-xs text-[var(--gantry-text-secondary)]">
                {categoryLabel}
              </span>
            </div>
            <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">{plugin.description}</p>
          </div>
          <div className="flex w-full flex-wrap items-stretch justify-start gap-2 sm:w-auto sm:justify-end">
            {canSync && (
              <button
                onClick={onSync}
                disabled={syncing}
                className="inline-flex min-h-[2.5rem] items-center justify-center gap-1.5 rounded-lg border border-[var(--gantry-border)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-tertiary)] disabled:opacity-50 sm:min-w-[7.5rem]"
              >
                <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
                Sync
              </button>
            )}
            <button
              onClick={onDisable}
              className="inline-flex min-h-[2.5rem] items-center justify-center gap-1.5 rounded-lg border border-[var(--gantry-border)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-tertiary)] sm:min-w-[7.5rem]"
            >
              <Slash className="h-4 w-4" />
              Disable
            </button>
            <button
              onClick={onToggleExpanded}
              className="inline-flex min-h-[2.5rem] items-center justify-center gap-1.5 rounded-lg bg-[var(--gantry-accent)] px-3 py-2 text-sm font-medium text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)] sm:min-w-[8.5rem]"
            >
              <Settings className="h-4 w-4" />
              {expanded ? 'Hide settings' : 'Configure'}
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      {syncResult && (
        <div className={`mx-5 mt-5 rounded-xl border px-4 py-3 text-xs ${
          (syncResult.errors?.length ?? 0) > 0
            ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400'
            : 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400'
        }`}>
          {syncResult.enriched != null
            ? `Enriched ${syncResult.enriched} of ${syncResult.scanned ?? 0} entities`
            : syncResult.apps != null
            ? `${syncResult.apps} app${syncResult.apps !== 1 ? 's' : ''} synced: ${syncResult.created ?? 0} created, ${syncResult.updated ?? 0} updated`
            : `Synced: ${syncResult.created ?? 0} created, ${syncResult.updated ?? 0} updated`}
          {(syncResult.errors?.length ?? 0) > 0 && ` · ${syncResult.errors!.length} error(s)`}
        </div>
      )}

      {expanded && (
        <div className="space-y-4 px-5 py-5">
          {loadingConfig ? (
            <div className="flex items-center justify-center py-12">
              <div className="spinner h-7 w-7 text-[var(--gantry-accent)]" />
            </div>
          ) : loadError ? (
            <div className="rounded-xl border border-[var(--gantry-danger)]/30 bg-[var(--gantry-danger)]/10 px-4 py-3 text-sm text-[var(--gantry-danger)]">
              {loadError}
            </div>
          ) : config ? (
            <>
              <PluginConfigForm
                plugin={plugin}
                config={config}
                values={values}
                setValues={onValuesChange}
              />
              {saveError && (
                <div className="rounded-xl border border-[var(--gantry-danger)]/30 bg-[var(--gantry-danger)]/10 px-4 py-3 text-sm text-[var(--gantry-danger)]">
                  {saveError}
                </div>
              )}
              <div className="flex flex-col gap-3 border-t border-[var(--gantry-border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-[var(--gantry-text-secondary)]">
                  {saved ? 'Saved just now.' : configHasFields ? 'Changes save only for this plugin.' : 'No editable settings for this plugin.'}
                </div>
                <button
                  onClick={onSave}
                  disabled={saving || !configHasFields}
                  className="rounded-lg bg-[var(--gantry-accent)] px-4 py-2 text-sm font-medium text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)] disabled:opacity-50"
                >
                  {saved ? 'Saved!' : saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default function AdminPluginSettings() {
  const [plugins, setPlugins] = useState<PluginRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingConfigs, setLoadingConfigs] = useState<Set<string>>(new Set());
  const [configs, setConfigs] = useState<Record<string, PluginConfig>>({});
  const [values, setValues] = useState<Record<string, Record<string, any>>>({});
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [savingPlugins, setSavingPlugins] = useState<Set<string>>(new Set());
  const [savedPlugins, setSavedPlugins] = useState<Set<string>>(new Set());
  const [syncingPlugins, setSyncingPlugins] = useState<Set<string>>(new Set());
  const [syncResults, setSyncResults] = useState<Record<string, PluginSyncResult>>({});

  const refreshPlugins = useCallback(async () => {
    try {
      const list = await api.listPlugins();
      setPlugins(list);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPlugins();
  }, [refreshPlugins]);

  useEffect(() => {
    const handlePluginsUpdated = () => {
      void refreshPlugins();
    };

    window.addEventListener(PLUGINS_UPDATED_EVENT, handlePluginsUpdated);
    return () => window.removeEventListener(PLUGINS_UPDATED_EVENT, handlePluginsUpdated);
  }, [refreshPlugins]);

  const enabledPlugins = useMemo(
    () => plugins.filter((plugin) => plugin.enabled).sort((a, b) => a.title.localeCompare(b.title)),
    [plugins],
  );

  async function loadConfig(name: string) {
    if (configs[name] || loadingConfigs.has(name)) return;

    setLoadingConfigs((prev) => new Set(prev).add(name));
    setLoadErrors((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });

    try {
      const config = await api.getPluginConfig(name);
      setConfigs((prev) => ({ ...prev, [name]: config }));
      setValues((prev) => ({ ...prev, [name]: applySchemaDefaults(config.schema, config.values) }));
    } catch (e: any) {
      setLoadErrors((prev) => ({ ...prev, [name]: e.message }));
    } finally {
      setLoadingConfigs((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    }
  }

  async function handleToggleExpanded(name: string) {
    const shouldOpen = !expanded.has(name);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

    if (shouldOpen) {
      await loadConfig(name);
    }
  }

  async function handleSave(name: string) {
    setSavingPlugins((prev) => new Set(prev).add(name));
    setSaveErrors((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });

    try {
      await api.updatePluginConfig(name, values[name] ?? {});
      setSavedPlugins((prev) => new Set(prev).add(name));
      window.setTimeout(() => {
        setSavedPlugins((prev) => {
          const next = new Set(prev);
          next.delete(name);
          return next;
        });
      }, 2000);
    } catch (e: any) {
      setSaveErrors((prev) => ({ ...prev, [name]: e.message }));
    } finally {
      setSavingPlugins((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    }
  }

  async function handleDisable(name: string) {
    try {
      await api.enablePlugin(name, false);
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleSync(name: string) {
    setSyncingPlugins((prev) => new Set(prev).add(name));
    setSyncResults((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });

    try {
      const result = await api.syncPlugin(name);
      setSyncResults((prev) => ({ ...prev, [name]: result }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSyncingPlugins((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    }
  }

  function getPluginValueSetter(name: string): Dispatch<SetStateAction<Record<string, any>>> {
    return (updater) => {
      setValues((prev) => {
        const current = prev[name] ?? {};
        const next = typeof updater === 'function'
          ? updater(current)
          : updater;
        return { ...prev, [name]: next };
      });
    };
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="spinner h-8 w-8 text-[var(--gantry-accent)]" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-[var(--gantry-text-primary)]">Enabled Plugin Settings</h3>
          <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">
            Configure active integrations and widgets without leaving the admin workspace.
          </p>
        </div>
        <Link
          to="/plugins"
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--gantry-border)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-secondary)]"
        >
          Browse all plugins
          <ExternalLink className="h-4 w-4" />
        </Link>
      </div>

      {error && (
        <div className="rounded-xl border border-[var(--gantry-danger)]/30 bg-[var(--gantry-danger)]/10 px-4 py-3 text-sm text-[var(--gantry-danger)]">
          {error}
        </div>
      )}

      {enabledPlugins.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-6 py-12 text-center">
          <Package className="mx-auto h-10 w-10 text-[var(--gantry-text-secondary)]" />
          <p className="mt-4 text-sm font-medium text-[var(--gantry-text-primary)]">No enabled plugins yet</p>
          <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">
            Turn on a plugin in the plugin library and it will appear here for centralized configuration.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {enabledPlugins.map((plugin) => (
            <PluginSettingsCard
              key={plugin.name}
              plugin={plugin}
              expanded={expanded.has(plugin.name)}
              loadingConfig={loadingConfigs.has(plugin.name)}
              config={configs[plugin.name] ?? null}
              values={values[plugin.name] ?? {}}
              syncResult={syncResults[plugin.name] ?? null}
              syncing={syncingPlugins.has(plugin.name)}
              saving={savingPlugins.has(plugin.name)}
              saved={savedPlugins.has(plugin.name)}
              saveError={saveErrors[plugin.name] ?? null}
              loadError={loadErrors[plugin.name] ?? null}
              onToggleExpanded={() => void handleToggleExpanded(plugin.name)}
              onValuesChange={getPluginValueSetter(plugin.name)}
              onSave={() => void handleSave(plugin.name)}
              onDisable={() => void handleDisable(plugin.name)}
              onSync={() => void handleSync(plugin.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
