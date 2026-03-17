export interface VersionResponse {
  version: string;
}

export interface Entity {
  kind: string;
  apiVersion: string;
  metadata: EntityMetadata;
  spec?: Record<string, any>;
}

export interface EntityMetadata {
  name: string;
  namespace?: string;
  title?: string;
  description?: string;
  owner?: string;
  tags?: string[];
  annotations?: Record<string, string>;
  labels?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
}

export interface User {
  id: string;
  username: string;
  displayName?: string;
  email?: string;
  role: string;
  ssoOnly?: boolean;
  effectiveRole?: string;
  groups?: string[];
  permissions?: Record<string, boolean>;
}

export interface SearchResult {
  kind: string;
  name: string;
  namespace: string;
  title: string;
  rank: number;
}

export interface ActionDef {
  kind: string;
  apiVersion: string;
  metadata: EntityMetadata;
  spec?: {
    type?: string;
    description?: string;
    inputs?: Record<string, any>;
    steps?: any[];
  };
}

export interface ActionRun {
  id: string;
  actionName: string;
  status: string;
  inputs?: string;
  outputs?: string;
  triggeredBy: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  userId?: string;
  userName?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  resourceName?: string;
  beforeState?: string;
  afterState?: string;
  source?: string;
  ipAddress?: string;
}

export interface APIKey {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  role: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
  key?: string; // only present on creation response
}

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: any[];
  description?: string;
  title?: string;
  default?: any;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  /** Custom extension: entity kind this field references (e.g. "API", "Team"). */
  'x-entity-ref'?: string;
}

export interface GraphNode {
  id: string;
  kind: string;
  namespace?: string;
  name: string;
  title?: string;
  isRoot: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  relation: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface PluginRegistryEntry {
  name: string;
  title: string;
  description: string;
  longDescription?: string;
  features?: string[];
  version: string;
  author: string;
  category: 'integration' | 'widget' | 'entity-kind' | 'action-type' | 'auth-provider';
  iconUrl?: string;
  homepage?: string;
  entityPanels?: string[];
  actionTypes?: string[];
  enabled: boolean;
}

export interface PluginDetail {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  config?: Record<string, any>;
  manifest?: {
    name: string;
    title: string;
    description: string;
    version: string;
    author: string;
    category: string;
    configSchema?: Record<string, any>;
    entityPanels?: string[];
    actionTypes?: string[];
  };
  installedAt: string;
  updatedAt: string;
}

export interface PluginConfig {
  schema?: Record<string, any>;
  values?: Record<string, any>;
}

export interface PluginSyncResult {
  // Kubernetes sync fields
  namespaces?: number;
  deployments?: number;
  services?: number;
  created?: number;
  updated?: number;
  // GitHub enrichment fields
  scanned?: number;
  enriched?: number;
  // ArgoCD sync fields
  apps?: number;
  errors?: string[];
}

export interface ArgoCDAppWithInstance extends ArgoCDAppStatus {
  instance: string;
}

export interface ArgoCDResourceStatus {
  group?: string;
  version?: string;
  kind?: string;
  namespace?: string;
  name?: string;
  status?: string;
  health?: { status: string; message?: string };
}

export interface ArgoCDAppStatus {
  appName: string;
  syncStatus: 'Synced' | 'OutOfSync' | 'Unknown' | string;
  healthStatus: 'Healthy' | 'Degraded' | 'Progressing' | 'Missing' | 'Unknown' | 'Suspended' | string;
  healthMessage?: string;
  syncRevision?: string;
  operationPhase?: string;
  operationMsg?: string;
  repoURL?: string;
  targetRevision?: string;
  path?: string;
  chart?: string;
  project?: string;
  destServer?: string;
  destNamespace?: string;
  images?: string[];
  resources?: ArgoCDResourceStatus[];
}

export interface K8sContainerInfo {
  name: string;
  image: string;
  ready: boolean;
  restarts: number;
  state: 'running' | 'waiting' | 'terminated' | 'unknown';
  reason?: string;
}

export interface K8sPodInfo {
  name: string;
  namespace: string;
  phase: string;
  ready: boolean;
  totalRestarts: number;
  nodeName?: string;
  startTime?: string;
  clusterName?: string;
  containers: K8sContainerInfo[];
}

export interface K8sDeploymentInfo {
  name: string;
  namespace: string;
  desiredReplicas: number;
  readyReplicas: number;
  availableReplicas: number;
}

export interface K8sWorkloadInfo {
  appName: string;
  deployments: K8sDeploymentInfo[];
  pods: K8sPodInfo[];
}

export interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; email: string; date: string };
  };
  html_url: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  html_url: string;
  user: { login: string };
  created_at: string;
  labels: { name: string; color: string }[];
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string;
  private: boolean;
  html_url: string;
  language: string;
  default_branch: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  topics: string[];
  pushed_at: string;
  created_at: string;
  archived: boolean;
  visibility: string;
}

export interface GitHubRelease {
  tag_name: string;
  name: string;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
  published_at: string;
}

export interface GitHubRepoInfo {
  repo: GitHubRepo;
  commits: GitHubCommit[];
  pullRequests: GitHubPullRequest[];
  readme?: string;
  latestRelease?: GitHubRelease;
}

export interface EntityLink {
  title: string;
  url: string;
  icon?: 'dashboard' | 'docs' | 'runbook' | 'github' | 'slack' | 'alert' | 'monitor' | 'ci' | 'other';
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export type ActionInputType = 'string' | 'textarea' | 'number' | 'boolean' | 'select';

export interface ActionInputDef {
  name: string;
  title?: string;
  type: ActionInputType;
  description?: string;
  required?: boolean;
  default?: string | number | boolean;
  options?: string[];
}

export interface GitHubWorkflow {
  id: number;
  name: string;
  path: string;
  state: string;
}

export const ENTITY_KINDS = [
  { name: 'Service', plural: 'services', icon: 'Server' },
  { name: 'API', plural: 'apis', icon: 'Globe' },
  { name: 'Infrastructure', plural: 'infrastructure', icon: 'Database' },
  { name: 'Team', plural: 'teams', icon: 'Users' },
  { name: 'Environment', plural: 'environments', icon: 'Cloud' },
  { name: 'Documentation', plural: 'documentation', icon: 'FileText' },
] as const;

export type EntityKindName = (typeof ENTITY_KINDS)[number]['name'];

// ─── Dashboard Config ──────────────────────────────────────────────────────

export type DashboardSeverity = 'info' | 'warning' | 'danger';

export type DashboardLinkIcon =
  | 'dashboard' | 'docs' | 'runbook' | 'github'
  | 'slack' | 'alert' | 'monitor' | 'ci' | 'other';

export interface DashboardAnnouncement {
  id: string;
  title: string;
  body: string;
  severity: DashboardSeverity;
}

export interface DashboardQuickLink {
  id: string;
  title: string;
  url: string;
  icon: DashboardLinkIcon;
}

export interface DashboardPinnedEntity {
  id: string;
  kind: string;
  name: string;
}

export interface DashboardWidgetConfig {
  id: string;
  visible: boolean;
  order: number;
  width?: 'full' | 'half';
}

export interface HistoryEntry {
  kind: string;
  name: string;
  namespace: string;
  viewedAt: string;
}

// ─── Status Monitor ──────────────────────────────────────────────────────

export interface StatusMonitorResult {
  name: string;
  title: string;
  category: string;
  status: 'operational' | 'degraded' | 'partial' | 'major' | 'maintenance' | 'unknown' | string;
  description: string;
  statusUrl: string;
  homepage: string;
  updatedAt?: string;
  custom?: boolean;
}

export interface DashboardConfig {
  announcements: DashboardAnnouncement[];
  quickLinks: DashboardQuickLink[];
  pinnedEntities: DashboardPinnedEntity[];
  widgets: DashboardWidgetConfig[];
  updatedAt?: string;
  updatedBy?: string;
}

// ─── GitOps ──────────────────────────────────────────────────────────────

export interface GitOpsStatus {
  connected: boolean;
  repoUrl?: string;
  branch?: string;
  lastCommit?: string;
  lastCommitAt?: string;
  lastPushAt?: string;
  lastPullAt?: string;
  lastError?: string;
  pendingFiles: number;
}

export interface GitOpsSyncEntry {
  id: string;
  timestamp: string;
  direction: 'push' | 'pull';
  commit?: string;
  message: string;
  files: number;
  error?: string;
}

export interface GitOpsFileEntry {
  path: string;
  kind: string;
  namespace: string;
  name: string;
  error?: string;
}

// ─── Groups & RBAC ────────────────────────────────────────────────────────

export interface Group {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  source: 'local' | 'github' | string;
  sourceId?: string;
  role: string;
  memberCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface GroupDetail {
  group: Group;
  members: User[];
}

export interface PermissionRule {
  id: string;
  subjectType: 'user' | 'group';
  subjectId: string;
  subjectName?: string;
  resourceType: 'entity' | 'action' | 'plugin' | '*';
  resourceFilter?: string;
  action: 'read' | 'write' | 'delete' | 'execute' | 'admin' | '*';
  effect: 'allow' | 'deny';
  createdAt: string;
  updatedAt: string;
}

export interface EffectivePermissions {
  userId: string;
  username: string;
  directRole: string;
  effectiveRole: string;
  groups: string[];
  rules: PermissionRule[];
}

export interface Role {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  level: number;
  builtIn: boolean;
  permissions: Record<string, boolean>;
  createdAt: string;
  updatedAt: string;
}

export interface RBACConfig {
  groups: { name: string; displayName?: string; description?: string; role: string }[];
  groupMemberships: { group: string; users: string[] }[];
  permissionRules: {
    subjectType: string;
    subjectName: string;
    resourceType: string;
    resourceFilter?: string;
    action: string;
    effect: string;
  }[];
}
