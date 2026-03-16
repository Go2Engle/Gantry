import type { Entity, User, SearchResult, ActionRun, AuditEntry, APIKey, GraphData, PluginRegistryEntry, PluginDetail, PluginConfig, PluginSyncResult, K8sWorkloadInfo, GitHubRepoInfo, ArgoCDAppStatus, ArgoCDAppWithInstance, GitHubWorkflow, ActionInputDef, DashboardConfig, HistoryEntry, StatusMonitorResult, GitOpsStatus, GitOpsSyncEntry, GitOpsFileEntry, Group, GroupDetail, PermissionRule, EffectivePermissions, RBACConfig, Role, VersionResponse } from './types';

let authToken: string | null = localStorage.getItem('gantry_token');

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) h['Authorization'] = `Bearer ${authToken}`;
  return h;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function setToken(token: string | null) {
  authToken = token;
  if (token) {
    localStorage.setItem('gantry_token', token);
  } else {
    localStorage.removeItem('gantry_token');
  }
}

export function getToken(): string | null {
  return authToken;
}

export const api = {
  getVersion: () => request<VersionResponse>('GET', '/version'),

  login: (username: string, password: string) =>
    request<{ token: string; user: User }>('POST', '/auth/login', { username, password }),

  getMe: () => request<User>('GET', '/auth/me'),

  logout: () => request<void>('POST', '/auth/logout'),

  listEntities: (kind?: string) =>
    request<Entity[]>('GET', kind ? `/entities/${kind}` : '/entities'),

  getEntity: (kind: string, name: string, namespace?: string) =>
    request<Entity>('GET', `/entities/${kind}/${name}${namespace && namespace !== 'default' ? `?namespace=${encodeURIComponent(namespace)}` : ''}`),

  createEntity: (entity: Entity) =>
    request<Entity>('POST', '/entities', entity),

  updateEntity: (kind: string, name: string, entity: Entity, namespace?: string) =>
    request<Entity>('PUT', `/entities/${kind}/${name}${namespace && namespace !== 'default' ? `?namespace=${encodeURIComponent(namespace)}` : ''}`, entity),

  deleteEntity: (kind: string, name: string, namespace?: string) =>
    request<void>('DELETE', `/entities/${kind}/${name}${namespace && namespace !== 'default' ? `?namespace=${encodeURIComponent(namespace)}` : ''}`),

  search: (q: string) =>
    request<SearchResult[]>('GET', `/search?q=${encodeURIComponent(q)}`),

  listSchemas: () => request<Record<string, any>>('GET', '/schemas'),

  getSchema: (kind: string) => request<any>('GET', `/schemas/${kind}`),

  listActions: () => request<Entity[]>('GET', '/actions'),

  listAllActionRuns: (limit = 10) =>
    request<ActionRun[]>('GET', `/actions/runs?limit=${limit}`),

  listActionRuns: (actionName: string) =>
    request<ActionRun[]>('GET', `/actions/${encodeURIComponent(actionName)}/runs`),

  executeAction: (name: string, inputs: Record<string, any>) =>
    request<ActionRun>('POST', `/actions/${name}/execute`, { inputs }),

  getActionRun: (actionName: string, runId: string) =>
    request<ActionRun>('GET', `/actions/${actionName}/runs/${runId}`),

  getGitHubWorkflows: (repoUrl: string) =>
    request<GitHubWorkflow[]>('GET', `/actions/github-workflows?repo=${encodeURIComponent(repoUrl)}`),

  getGitHubWorkflowInputs: (repoUrl: string, workflow: string) =>
    request<ActionInputDef[]>('GET', `/actions/github-workflow-inputs?repo=${encodeURIComponent(repoUrl)}&workflow=${encodeURIComponent(workflow)}`),

  listAuditEntries: (limit = 50, offset = 0) =>
    request<AuditEntry[]>('GET', `/audit?limit=${limit}&offset=${offset}`),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ message: string }>('PUT', '/auth/me/password', { currentPassword, newPassword }),

  listUsers: () => request<User[]>('GET', '/auth/users'),

  createUser: (username: string, password: string, displayName?: string, email?: string, role?: string) =>
    request<User>('POST', '/auth/register', { username, password, displayName, email, role }),

  updateUser: (id: string, data: { displayName?: string; email?: string; role?: string }) =>
    request<User>('PUT', `/auth/users/${id}`, data),

  deleteUser: (id: string) => request<void>('DELETE', `/auth/users/${id}`),

  listAPIKeys: () => request<APIKey[]>('GET', '/auth/apikeys'),

  createAPIKey: (name: string) =>
    request<APIKey>('POST', '/auth/apikeys', { name }),

  revokeAPIKey: (id: string) =>
    request<void>('DELETE', `/auth/apikeys/${id}`),

  getEntityGraph: (kind: string, name: string, namespace?: string) =>
    request<GraphData>('GET', `/graph/${kind}/${name}${namespace && namespace !== 'default' ? `?namespace=${encodeURIComponent(namespace)}` : ''}`),

  // Plugin marketplace
  listPlugins: () => request<PluginRegistryEntry[]>('GET', '/plugins'),
  getPlugin: (name: string) => request<PluginDetail>('GET', `/plugins/${name}`),
  enablePlugin: (name: string, enabled: boolean) =>
    request<void>('PUT', `/plugins/${name}/enable`, { enabled }),
  getPluginConfig: (name: string) => request<PluginConfig>('GET', `/plugins/${name}/config`),
  updatePluginConfig: (name: string, values: Record<string, any>) =>
    request<void>('PUT', `/plugins/${name}/config`, values),

  syncPlugin: (name: string) => request<PluginSyncResult>('POST', `/plugins/${name}/sync`, {}),

  getKubernetesWorkload: (appName: string, namespaces: string[]) =>
    request<K8sWorkloadInfo>('GET', `/plugins/kubernetes/workload/${encodeURIComponent(appName)}?namespaces=${namespaces.join(',')}`),

  getGitHubSSOConfig: () =>
    request<{ ssoEnabled: boolean }>('GET', '/auth/github/config'),

  getGitHubRepo: (url: string) =>
    request<GitHubRepoInfo>('GET', `/plugins/github/repo?url=${encodeURIComponent(url)}`),

  getArgoCDEntityApps: (appNames: string[]) =>
    request<ArgoCDAppWithInstance[]>('GET', `/plugins/argocd/entity-apps?appNames=${encodeURIComponent(appNames.join(','))}`),

  getArgoCDApp: (appName: string, instance?: string) =>
    request<ArgoCDAppStatus>('GET', `/plugins/argocd/apps/${encodeURIComponent(appName)}${instance ? `?instance=${encodeURIComponent(instance)}` : ''}`),

  syncArgoCDApp: (appName: string, hard = false, instance?: string) =>
    request<ArgoCDAppStatus>('POST', `/plugins/argocd/apps/${encodeURIComponent(appName)}/sync${instance ? `?instance=${encodeURIComponent(instance)}` : ''}`, { hard }),

  refreshArgoCDApp: (appName: string, instance?: string) =>
    request<ArgoCDAppStatus>('POST', `/plugins/argocd/apps/${encodeURIComponent(appName)}/refresh${instance ? `?instance=${encodeURIComponent(instance)}` : ''}`, {}),

  // Status Monitor
  getStatusMonitorStatuses: () =>
    request<StatusMonitorResult[]>('GET', '/plugins/status-monitor/statuses'),

  // Health check proxy
  checkHealth: (url: string) =>
    request<{ reachable: boolean; statusCode?: number; latencyMs: number; body?: string; error?: string }>('GET', `/health-check?url=${encodeURIComponent(url)}`),

  // Dashboard config
  getDashboardConfig: () => request<DashboardConfig>('GET', '/dashboard/config'),
  setDashboardConfig: (config: DashboardConfig) => request<DashboardConfig>('PUT', '/dashboard/config', config),

  // User browsing history
  getHistory: (limit = 5) => request<HistoryEntry[]>('GET', `/history?limit=${limit}`),
  recordView: (kind: string, name: string, namespace?: string) =>
    request<void>('POST', '/history', { kind, name, namespace: namespace || 'default' }),

  // GitOps
  getGitOpsStatus: () => request<GitOpsStatus>('GET', '/plugins/gitops/status'),
  getGitOpsHistory: () => request<GitOpsSyncEntry[]>('GET', '/plugins/gitops/history'),
  getGitOpsFiles: () => request<GitOpsFileEntry[]>('GET', '/plugins/gitops/files'),
  triggerGitOpsSync: () => request<{ message: string }>('POST', '/plugins/gitops/sync'),
  triggerGitOpsPull: () => request<{ message: string }>('POST', '/plugins/gitops/pull'),

  // Groups
  listGroups: () => request<Group[]>('GET', '/groups'),
  createGroup: (data: { name: string; displayName?: string; description?: string; role?: string }) =>
    request<Group>('POST', '/groups', data),
  getGroup: (id: string) => request<GroupDetail>('GET', `/groups/${id}`),
  updateGroup: (id: string, data: { displayName?: string; description?: string; role?: string }) =>
    request<Group>('PUT', `/groups/${id}`, data),
  deleteGroup: (id: string) => request<void>('DELETE', `/groups/${id}`),
  listGroupMembers: (id: string) => request<User[]>('GET', `/groups/${id}/members`),
  addGroupMember: (groupId: string, userId: string) =>
    request<void>('POST', `/groups/${groupId}/members`, { userId }),
  removeGroupMember: (groupId: string, userId: string) =>
    request<void>('DELETE', `/groups/${groupId}/members/${userId}`),

  // Roles
  listRoles: () => request<Role[]>('GET', '/rbac/roles'),
  createRole: (data: { name: string; displayName?: string; description?: string; level: number; permissions: Record<string, boolean> }) =>
    request<Role>('POST', '/rbac/roles', data),
  updateRole: (id: string, data: { displayName?: string; description?: string; level?: number; permissions?: Record<string, boolean> }) =>
    request<Role>('PUT', `/rbac/roles/${id}`, data),
  deleteRole: (id: string) => request<void>('DELETE', `/rbac/roles/${id}`),

  // RBAC
  listPermissionRules: () => request<PermissionRule[]>('GET', '/rbac/rules'),
  createPermissionRule: (rule: Omit<PermissionRule, 'id' | 'createdAt' | 'updatedAt' | 'subjectName'>) =>
    request<PermissionRule>('POST', '/rbac/rules', rule),
  deletePermissionRule: (id: string) => request<void>('DELETE', `/rbac/rules/${id}`),
  getEffectivePermissions: (userId: string) =>
    request<EffectivePermissions>('GET', `/rbac/effective/${userId}`),
  exportRBACConfig: () => request<RBACConfig>('GET', '/rbac/export'),
  importRBACConfig: (config: RBACConfig) => request<{ groupsCreated: number; groupsUpdated: number; rulesImported: number }>('POST', '/rbac/import', config),
};
