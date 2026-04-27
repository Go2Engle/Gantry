import { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, Loader2, AlertCircle, Github, Webhook, Zap, Check, Download, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import type { Entity, ActionInputDef, GitHubWorkflow, Role } from '../lib/types';
import ActionFormBuilder from './ActionFormBuilder';

interface Props {
  existing?: Entity; // if provided, we're editing
  onSave: (entity: Entity) => void;
  onClose: () => void;
}

type ActionType = 'github-action' | 'webhook' | 'internal';

interface GitHubConfig {
  repoUrl: string;
  workflow: string;
  ref: string;
  credentialMode: 'service_account' | 'user';
}

interface WebhookConfig {
  url: string;
  method: string;
  headers: { key: string; value: string }[];
}

const ACTION_TYPES: { value: ActionType; label: string; icon: React.ReactNode; description: string }[] = [
  {
    value: 'github-action',
    label: 'GitHub Actions',
    icon: <Github className="h-5 w-5" />,
    description: 'Trigger a GitHub Actions workflow via workflow_dispatch',
  },
  {
    value: 'webhook',
    label: 'Webhook',
    icon: <Webhook className="h-5 w-5" />,
    description: 'POST inputs to an arbitrary HTTP endpoint',
  },
  {
    value: 'internal',
    label: 'Internal',
    icon: <Zap className="h-5 w-5" />,
    description: 'Gantry self-operations (placeholder / future use)',
  },
];

const STEPS = ['Basic', 'Type & Config', 'Form Builder', 'Permissions'];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '');
}

export default function ActionWizard({ existing, onSave, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Step 1: Basic
  // For new actions: name is auto-derived from title. For edits: name is fixed.
  const [name, setName] = useState(existing?.metadata.name ?? '');
  const [title, setTitle] = useState(existing?.metadata.title ?? existing?.metadata.name ?? '');
  const [description, setDescription] = useState(existing?.metadata.description ?? '');
  const [owner, setOwner] = useState(existing?.metadata.owner ?? '');
  const [category, setCategory] = useState(existing?.spec?.category ?? '');
  const isNew = !existing;

  // Step 2: Type & Config
  const [actionType, setActionType] = useState<ActionType>(
    (existing?.spec?.type as ActionType) ?? 'github-action'
  );
  const [ghConfig, setGhConfig] = useState<GitHubConfig>({
    repoUrl: existing?.spec?.config?.repoUrl ?? '',
    workflow: existing?.spec?.config?.workflow ?? '',
    ref: existing?.spec?.config?.ref ?? 'main',
    credentialMode: existing?.spec?.config?.credentialMode === 'user' ? 'user' : 'service_account',
  });
  const [webhookConfig, setWebhookConfig] = useState<WebhookConfig>({
    url: existing?.spec?.config?.url ?? '',
    method: existing?.spec?.config?.method ?? 'POST',
    headers: Object.entries(existing?.spec?.config?.headers ?? {}).map(([key, value]) => ({
      key,
      value: value as string,
    })),
  });

  // GitHub workflow browsing
  const [workflows, setWorkflows] = useState<GitHubWorkflow[]>([]);
  const [loadingWorkflows, setLoadingWorkflows] = useState(false);
  const [workflowError, setWorkflowError] = useState('');
  const [importingInputs, setImportingInputs] = useState(false);
  const [gitHubUserDispatchEnabled, setGitHubUserDispatchEnabled] = useState(false);

  // Step 3: Inputs
  const [inputs, setInputs] = useState<ActionInputDef[]>(
    (existing?.spec?.inputs as ActionInputDef[]) ?? []
  );

  // Step 4: Permissions
  // minRole: empty = any authenticated user; otherwise = minimum role required to execute
  const [minRole, setMinRole] = useState<string>('');
  const [availableRoles, setAvailableRoles] = useState<Role[]>([]);
  const [requireApproval, setRequireApproval] = useState<boolean>(
    existing?.spec?.permissions?.requireApproval ?? false
  );

  // Load roles for permissions dropdown
  useEffect(() => {
    const fallback: Role[] = [
      { id: 'viewer', name: 'viewer', displayName: 'Viewer', level: 1, builtIn: true, permissions: {}, createdAt: '', updatedAt: '' },
      { id: 'developer', name: 'developer', displayName: 'Developer', level: 2, builtIn: true, permissions: {}, createdAt: '', updatedAt: '' },
      { id: 'platform-engineer', name: 'platform-engineer', displayName: 'Platform Engineer', level: 3, builtIn: true, permissions: {}, createdAt: '', updatedAt: '' },
      { id: 'admin', name: 'admin', displayName: 'Admin', level: 4, builtIn: true, permissions: {}, createdAt: '', updatedAt: '' },
    ];
    api.listRoles().then((roles) => {
      const sorted = [...roles].sort((a, b) => a.level - b.level);
      setAvailableRoles(sorted.length > 0 ? sorted : fallback);
      // Derive min role from existing entity
      const existingRoles = (existing?.spec?.permissions?.allowedRoles as string[] | undefined) ?? [];
      if (existingRoles.length > 0) {
        let minLevel = Infinity;
        let minRoleName = '';
        for (const rName of existingRoles) {
          const found = (sorted.length > 0 ? sorted : fallback).find((r) => r.name === rName);
          if (found && found.level < minLevel) {
            minLevel = found.level;
            minRoleName = rName;
          }
        }
        if (minRoleName) setMinRole(minRoleName);
      }
    }).catch(() => {
      setAvailableRoles(fallback);
      const existingRoles = (existing?.spec?.permissions?.allowedRoles as string[] | undefined) ?? [];
      if (existingRoles.length > 0) {
        const sorted = [...fallback].sort((a, b) => a.level - b.level);
        let minLevel = Infinity;
        let minRoleName = '';
        for (const rName of existingRoles) {
          const found = sorted.find((r) => r.name === rName);
          if (found && found.level < minLevel) {
            minLevel = found.level;
            minRoleName = rName;
          }
        }
        if (minRoleName) setMinRole(minRoleName);
      }
    });
  }, []);

  useEffect(() => {
    api.getGitHubSSOConfig()
      .then((cfg) => setGitHubUserDispatchEnabled(!!cfg.dispatchAsUser))
      .catch(() => setGitHubUserDispatchEnabled(false));
  }, []);

  useEffect(() => {
    if (!gitHubUserDispatchEnabled && ghConfig.credentialMode === 'user') {
      setGhConfig((c) => ({ ...c, credentialMode: 'service_account' }));
    }
  }, [gitHubUserDispatchEnabled, ghConfig.credentialMode]);

  // Load workflows when repo URL changes
  useEffect(() => {
    if (actionType !== 'github-action' || !ghConfig.repoUrl) {
      setWorkflows([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoadingWorkflows(true);
      setWorkflowError('');
      try {
        const wfs = await api.getGitHubWorkflows(ghConfig.repoUrl);
        setWorkflows(wfs);
      } catch (e: any) {
        setWorkflowError(e.message);
        setWorkflows([]);
      } finally {
        setLoadingWorkflows(false);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [ghConfig.repoUrl, actionType]);

  const importWorkflowInputs = async () => {
    if (!ghConfig.repoUrl || !ghConfig.workflow) return;
    setImportingInputs(true);
    try {
      const defs = await api.getGitHubWorkflowInputs(ghConfig.repoUrl, ghConfig.workflow);
      setInputs(defs);
      setStep(2); // jump to form builder
    } catch (e: any) {
      setError(`Failed to import workflow inputs: ${e.message}`);
    } finally {
      setImportingInputs(false);
    }
  };

  const buildEntity = (): Entity => {
    let config: Record<string, any> = {};
    if (actionType === 'github-action') {
      config = {
        repoUrl: ghConfig.repoUrl,
        workflow: ghConfig.workflow,
        ref: ghConfig.ref,
        credentialMode: ghConfig.credentialMode,
      };
    } else if (actionType === 'webhook') {
      const headers: Record<string, string> = {};
      webhookConfig.headers.forEach(({ key, value }) => { if (key) headers[key] = value; });
      config = { url: webhookConfig.url, method: webhookConfig.method, ...(Object.keys(headers).length > 0 ? { headers } : {}) };
    }

    // Expand minRole to all roles at or above the selected level
    let allowedRolesArr: string[] = [];
    if (minRole) {
      const minRoleObj = availableRoles.find((r) => r.name === minRole);
      if (minRoleObj) {
        allowedRolesArr = availableRoles
          .filter((r) => r.level >= minRoleObj.level)
          .map((r) => r.name);
      }
    }

    const cleanInputs = inputs.map((inp) => {
      const clean: ActionInputDef = { name: inp.name, type: inp.type };
      if (inp.title) clean.title = inp.title;
      if (inp.description) clean.description = inp.description;
      if (inp.required) clean.required = true;
      if (inp.default !== undefined && inp.default !== '') clean.default = inp.default;
      if (inp.type === 'select' && inp.entityKind) clean.entityKind = inp.entityKind;
      else if (inp.type === 'select' && inp.options) clean.options = inp.options.filter(Boolean);
      return clean;
    });

    return {
      kind: 'Action',
      apiVersion: 'gantry.io/v1',
      metadata: {
        name,
        title: title || undefined,
        description: description || undefined,
        owner: owner || undefined,
      },
      spec: {
        type: actionType,
        ...(category ? { category } : {}),
        ...(Object.keys(config).length > 0 ? { config } : {}),
        ...(cleanInputs.length > 0 ? { inputs: cleanInputs } : {}),
        ...((allowedRolesArr.length > 0 || requireApproval) ? {
          permissions: {
            ...(allowedRolesArr.length > 0 ? { allowedRoles: allowedRolesArr } : {}),
            ...(requireApproval ? { requireApproval: true } : {}),
          },
        } : {}),
      },
    };
  };

  const handleSave = async () => {
    setError('');
    if (!title) { setError('Title is required'); setStep(0); return; }

    setSaving(true);
    try {
      const entityData = buildEntity();
      let saved: Entity;
      if (existing) {
        saved = await api.updateEntity('Action', existing.metadata.name, entityData, existing.metadata.namespace);
      } else {
        saved = await api.createEntity(entityData);
      }
      onSave(saved);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const canAdvance = () => {
    if (step === 0) return title.trim().length > 0;
    if (step === 1) {
      if (actionType === 'github-action') return ghConfig.repoUrl.length > 0 && ghConfig.workflow.length > 0;
      if (actionType === 'webhook') return webhookConfig.url.length > 0;
      return true;
    }
    return true;
  };

  const maxRoleLevel = availableRoles.length > 0 ? Math.max(...availableRoles.map((x) => x.level)) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-[var(--gantry-bg-primary)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--gantry-border)] px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--gantry-text-primary)]">
              {existing ? 'Edit Action' : 'Create Action'}
            </h2>
            <p className="text-sm text-[var(--gantry-text-secondary)]">
              {existing?.metadata.name ?? 'New self-service workflow'}
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex border-b border-[var(--gantry-border)] px-6 py-3">
          {STEPS.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { if (i < step || (i === step + 1 && canAdvance())) setStep(i); }}
              className={`flex items-center gap-1.5 text-sm ${i === step
                ? 'font-semibold text-[var(--gantry-accent)]'
                : i < step
                  ? 'cursor-pointer text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)]'
                  : 'cursor-default text-[var(--gantry-text-secondary)] opacity-50'
                }`}
            >
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${i === step
                ? 'bg-[var(--gantry-accent)] text-[var(--gantry-bg-primary)]'
                : i < step
                  ? 'bg-[var(--gantry-accent)]/20 text-[var(--gantry-accent)]'
                  : 'bg-[var(--gantry-bg-tertiary)] text-[var(--gantry-text-secondary)]'
                }`}>
                {i < step ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              {s}
              {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-[var(--gantry-border)] ml-1.5" />}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-6 mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Step content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* ── Step 0: Basic ── */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--gantry-text-primary)]">
                  Title <span className="text-[var(--gantry-danger)]">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    if (isNew) setName(slugify(e.target.value));
                  }}
                  placeholder="e.g. Deploy Service"
                  className="w-full rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] placeholder-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                />
                {isNew && name && (
                  <p className="mt-0.5 text-xs text-[var(--gantry-text-secondary)]">
                    Slug: <span className="font-mono">{name}</span>
                  </p>
                )}
                {!isNew && (
                  <p className="mt-0.5 text-xs text-[var(--gantry-text-secondary)]">
                    Slug: <span className="font-mono">{name}</span> (cannot be changed after creation)
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--gantry-text-primary)]">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="What does this action do?"
                  className="w-full rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] placeholder-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-[var(--gantry-text-primary)]">
                    Owner
                  </label>
                  <input
                    type="text"
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                    placeholder="e.g. platform-team"
                    className="w-full rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] placeholder-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-[var(--gantry-text-primary)]">
                    Category
                  </label>
                  <input
                    type="text"
                    list="action-categories"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="e.g. Deployment"
                    className="w-full rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] placeholder-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                  />
                  <datalist id="action-categories">
                    {['Deployment', 'Infrastructure', 'Database', 'Security', 'Testing', 'Notifications', 'Operations', 'GitOps'].map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                  <p className="mt-0.5 text-xs text-[var(--gantry-text-secondary)]">Groups this action on the Actions page</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 1: Type & Config ── */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <p className="mb-2 text-sm font-medium text-[var(--gantry-text-primary)]">Action Type</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {ACTION_TYPES.map((at) => (
                    <button
                      key={at.value}
                      type="button"
                      onClick={() => setActionType(at.value)}
                      className={`flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors ${actionType === at.value
                        ? 'border-[var(--gantry-accent)] bg-[var(--gantry-accent)]/10'
                        : 'border-[var(--gantry-border)] hover:border-[var(--gantry-accent)]/50'
                        }`}
                    >
                      <div className={`${actionType === at.value ? 'text-[var(--gantry-accent)]' : 'text-[var(--gantry-text-secondary)]'}`}>
                        {at.icon}
                      </div>
                      <span className={`text-sm font-medium ${actionType === at.value ? 'text-[var(--gantry-accent)]' : 'text-[var(--gantry-text-primary)]'}`}>
                        {at.label}
                      </span>
                      <span className="text-xs text-[var(--gantry-text-secondary)]">{at.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* GitHub Actions config */}
              {actionType === 'github-action' && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-[var(--gantry-text-primary)]">GitHub Configuration</p>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--gantry-text-secondary)]">
                      Repository URL <span className="text-[var(--gantry-danger)]">*</span>
                    </label>
                    <input
                      type="url"
                      value={ghConfig.repoUrl}
                      onChange={(e) => setGhConfig((c) => ({ ...c, repoUrl: e.target.value, workflow: '' }))}
                      placeholder="https://github.com/org/repo"
                      className="w-full rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] placeholder-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--gantry-text-secondary)]">
                      Workflow <span className="text-[var(--gantry-danger)]">*</span>
                    </label>
                    <div className="flex gap-2">
                      {workflows.length > 0 ? (
                        <select
                          value={ghConfig.workflow}
                          onChange={(e) => setGhConfig((c) => ({ ...c, workflow: e.target.value }))}
                          className="flex-1 rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                        >
                          <option value="">Select a workflow…</option>
                          {workflows.map((wf) => (
                            <option key={wf.id} value={wf.path}>{wf.name} ({wf.path})</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={ghConfig.workflow}
                          onChange={(e) => setGhConfig((c) => ({ ...c, workflow: e.target.value }))}
                          placeholder="e.g. deploy.yml"
                          className="flex-1 rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] placeholder-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                        />
                      )}
                      {loadingWorkflows && <Loader2 className="h-5 w-5 animate-spin self-center text-[var(--gantry-text-secondary)]" />}
                    </div>
                    {workflowError && (
                      <p className="mt-1 text-xs text-[var(--gantry-danger)]">
                        Could not load workflows: {workflowError}. Enter the filename manually.
                      </p>
                    )}
                    {workflows.length > 0 && (
                      <p className="mt-0.5 text-xs text-[var(--gantry-text-secondary)]">
                        {workflows.length} active workflow{workflows.length !== 1 ? 's' : ''} found in this repo.
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--gantry-text-secondary)]">
                      Branch / Ref
                    </label>
                    <input
                      type="text"
                      value={ghConfig.ref}
                      onChange={(e) => setGhConfig((c) => ({ ...c, ref: e.target.value }))}
                      placeholder="main"
                      className="w-full rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] placeholder-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--gantry-text-secondary)]">
                      GitHub Credentials
                    </label>
                    <select
                      value={ghConfig.credentialMode}
                      onChange={(e) => setGhConfig((c) => ({ ...c, credentialMode: e.target.value === 'user' ? 'user' : 'service_account' }))}
                      className="w-full rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                    >
                      <option value="service_account">Service account</option>
                      <option value="user" disabled={!gitHubUserDispatchEnabled}>Prompt triggering user</option>
                    </select>
                    <p className={`mt-0.5 text-xs ${gitHubUserDispatchEnabled ? 'text-[var(--gantry-text-secondary)]' : 'text-[var(--gantry-danger)]'}`}>
                      {gitHubUserDispatchEnabled
                        ? 'User mode requests a one-time GitHub token when the action runs.'
                        : 'Enable Run Actions as GitHub User in the GitHub plugin settings to use user credentials.'}
                    </p>
                  </div>

                  {ghConfig.workflow && (
                    <button
                      type="button"
                      onClick={importWorkflowInputs}
                      disabled={importingInputs}
                      className="flex items-center gap-2 rounded-lg border border-[var(--gantry-accent)] px-4 py-2 text-sm font-medium text-[var(--gantry-accent)] hover:bg-[var(--gantry-accent)]/10 disabled:opacity-50"
                    >
                      {importingInputs ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      Import inputs from GitHub workflow
                    </button>
                  )}
                </div>
              )}

              {/* Webhook config */}
              {actionType === 'webhook' && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-[var(--gantry-text-primary)]">Webhook Configuration</p>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--gantry-text-secondary)]">
                      URL <span className="text-[var(--gantry-danger)]">*</span>
                    </label>
                    <input
                      type="url"
                      value={webhookConfig.url}
                      onChange={(e) => setWebhookConfig((c) => ({ ...c, url: e.target.value }))}
                      placeholder="https://your-service.example.com/webhook"
                      className="w-full rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] placeholder-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--gantry-text-secondary)]">Method</label>
                    <select
                      value={webhookConfig.method}
                      onChange={(e) => setWebhookConfig((c) => ({ ...c, method: e.target.value }))}
                      className="w-full rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                    >
                      {['POST', 'PUT', 'PATCH', 'GET', 'DELETE'].map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--gantry-text-secondary)]">
                      Custom Headers
                    </label>
                    <div className="space-y-1.5">
                      {webhookConfig.headers.map((h, hi) => (
                        <div key={hi} className="flex gap-2">
                          <input
                            type="text"
                            value={h.key}
                            onChange={(e) => {
                              const hs = [...webhookConfig.headers];
                              hs[hi] = { ...hs[hi], key: e.target.value };
                              setWebhookConfig((c) => ({ ...c, headers: hs }));
                            }}
                            placeholder="Header name"
                            className="flex-1 rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-1.5 text-sm text-[var(--gantry-text-primary)] placeholder-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                          />
                          <input
                            type="text"
                            value={h.value}
                            onChange={(e) => {
                              const hs = [...webhookConfig.headers];
                              hs[hi] = { ...hs[hi], value: e.target.value };
                              setWebhookConfig((c) => ({ ...c, headers: hs }));
                            }}
                            placeholder="Value"
                            className="flex-1 rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-1.5 text-sm text-[var(--gantry-text-primary)] placeholder-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => setWebhookConfig((c) => ({ ...c, headers: c.headers.filter((_, i) => i !== hi) }))}
                            className="rounded px-2 text-[var(--gantry-danger)] hover:bg-[var(--gantry-bg-tertiary)]"
                          >×</button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => setWebhookConfig((c) => ({ ...c, headers: [...c.headers, { key: '', value: '' }] }))}
                        className="text-xs text-[var(--gantry-accent)] hover:underline"
                      >
                        + Add header
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Internal */}
              {actionType === 'internal' && (
                <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] p-4 text-sm text-[var(--gantry-text-secondary)]">
                  Internal actions run within Gantry itself. No additional configuration required yet —
                  this type is reserved for future built-in operations like triggering syncs or creating entities.
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Form Builder ── */}
          {step === 2 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[var(--gantry-text-primary)]">Input Fields</p>
                  <p className="text-xs text-[var(--gantry-text-secondary)]">
                    Define what users must provide before running this action.
                  </p>
                </div>
                {actionType === 'github-action' && ghConfig.workflow && (
                  <button
                    type="button"
                    onClick={importWorkflowInputs}
                    disabled={importingInputs}
                    className="flex items-center gap-1.5 rounded-md border border-[var(--gantry-border)] px-3 py-1.5 text-xs text-[var(--gantry-text-secondary)] hover:border-[var(--gantry-accent)] hover:text-[var(--gantry-accent)] disabled:opacity-50"
                  >
                    {importingInputs ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Re-import from GitHub
                  </button>
                )}
              </div>
              <ActionFormBuilder inputs={inputs} onChange={setInputs} />
            </div>
          )}

          {/* ── Step 3: Permissions ── */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--gantry-text-primary)]">
                  Minimum Role Required
                </label>
                <select
                  value={minRole}
                  onChange={(e) => setMinRole(e.target.value)}
                  className="w-full rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                >
                  <option value="">Any authenticated user</option>
                  {availableRoles.map((r) => (
                    <option key={r.name} value={r.name}>
                      {r.displayName || r.name}{r.level < maxRoleLevel ? ' and above' : ' only'}
                    </option>
                  ))}
                </select>
                <p className="mt-0.5 text-xs text-[var(--gantry-text-secondary)]">
                  Users with the selected role or a higher role can execute this action.
                </p>
              </div>

              <label className="flex cursor-pointer items-center gap-3">
                <div
                  onClick={() => setRequireApproval((v) => !v)}
                  className={`relative h-5 w-9 rounded-full transition-colors ${requireApproval ? 'bg-[var(--gantry-accent)]' : 'bg-[var(--gantry-border)]'}`}
                >
                  <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-[var(--gantry-bg-primary)] shadow transition-transform ${requireApproval ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </div>
                <div>
                  <span className="text-sm font-medium text-[var(--gantry-text-primary)]">Require approval</span>
                  <p className="text-xs text-[var(--gantry-text-secondary)]">
                    Execution will be held in pending-approval state until an approver confirms it.
                  </p>
                </div>
              </label>

              {/* Summary */}
              <div className="mt-4 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] p-4 text-sm space-y-1.5">
                <p className="font-medium text-[var(--gantry-text-primary)]">Summary</p>
                <p className="text-[var(--gantry-text-secondary)]"><span className="font-medium text-[var(--gantry-text-primary)]">Name:</span> {name}</p>
                {category && <p className="text-[var(--gantry-text-secondary)]"><span className="font-medium text-[var(--gantry-text-primary)]">Category:</span> {category}</p>}
                <p className="text-[var(--gantry-text-secondary)]"><span className="font-medium text-[var(--gantry-text-primary)]">Type:</span> {ACTION_TYPES.find((t) => t.value === actionType)?.label}</p>
                {actionType === 'github-action' && (
                  <>
                    <p className="text-[var(--gantry-text-secondary)]"><span className="font-medium text-[var(--gantry-text-primary)]">Workflow:</span> {ghConfig.workflow} on {ghConfig.ref}</p>
                    <p className="text-[var(--gantry-text-secondary)]"><span className="font-medium text-[var(--gantry-text-primary)]">Credentials:</span> {ghConfig.credentialMode === 'user' ? 'Prompt triggering user' : 'Service account'}</p>
                  </>
                )}
                {actionType === 'webhook' && (
                  <p className="text-[var(--gantry-text-secondary)]"><span className="font-medium text-[var(--gantry-text-primary)]">Endpoint:</span> {webhookConfig.method} {webhookConfig.url}</p>
                )}
                <p className="text-[var(--gantry-text-secondary)]"><span className="font-medium text-[var(--gantry-text-primary)]">Inputs:</span> {inputs.length} field{inputs.length !== 1 ? 's' : ''}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--gantry-border)] px-6 py-4">
          <button
            type="button"
            onClick={() => (step === 0 ? onClose() : setStep((s) => s - 1))}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--gantry-border)] px-4 py-2 text-sm text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-secondary)]"
          >
            {step === 0 ? 'Cancel' : <><ChevronLeft className="h-4 w-4" /> Back</>}
          </button>

          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              disabled={!canAdvance()}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--gantry-accent)] px-4 py-2 text-sm font-medium text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)] disabled:opacity-50"
            >
              Next <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-[var(--gantry-accent)] px-4 py-2 text-sm font-medium text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)] disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {existing ? 'Save Changes' : 'Create Action'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
