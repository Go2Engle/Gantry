import { useState, useEffect, useCallback } from 'react';
import { Shield, Lock, Plus, Trash2, Users, ChevronDown, ChevronRight, Download, Upload, Github, Check } from 'lucide-react';
import { api } from '../lib/api';
import type { Group, PermissionRule, EffectivePermissions, User, RBACConfig, Role } from '../lib/types';

const RESOURCE_TYPES = ['entity', 'action', 'plugin', '*'] as const;
const ACTIONS = ['read', 'write', 'delete', 'execute', 'admin', '*'] as const;
const PERMISSION_COLUMNS = ['read', 'write', 'execute', 'delete', 'admin'] as const;

type Tab = 'roles' | 'groups' | 'rules' | 'overview' | 'import-export';

export default function RBAC({ embedded = false }: { embedded?: boolean }) {
  const [tab, setTab] = useState<Tab>('roles');
  const [groups, setGroups] = useState<Group[]>([]);
  const [rules, setRules] = useState<PermissionRule[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [g, r, u, ro] = await Promise.all([
        api.listGroups(),
        api.listPermissionRules(),
        api.listUsers(),
        api.listRoles().catch(() => [] as Role[]),
      ]);
      setGroups(g);
      setRules(r);
      setUsers(u);
      setRoles(ro);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const roleNames = roles.length > 0 ? roles.sort((a, b) => a.level - b.level).map((r) => r.name) : ['viewer', 'developer', 'platform-engineer', 'admin'];

  const tabs: { id: Tab; label: string }[] = [
    { id: 'roles', label: 'Roles' },
    { id: 'groups', label: 'Groups' },
    { id: 'rules', label: 'Permission Rules' },
    { id: 'overview', label: 'Overview' },
    { id: 'import-export', label: 'Import / Export' },
  ];

  return (
    <div>
      {!embedded && (
        <div className="mb-6 flex items-center gap-3">
          <Shield className="h-7 w-7 text-[var(--gantry-accent)]" />
          <div>
            <h1 className="text-2xl font-bold text-[var(--gantry-text-primary)]">Access Control</h1>
            <p className="text-sm text-[var(--gantry-text-secondary)]">
              Manage groups, permissions, and role-based access
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-lg bg-[var(--gantry-bg-primary)] p-1 border border-[var(--gantry-border)]">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'bg-[var(--gantry-accent)] text-[var(--gantry-bg-primary)]'
                : 'text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="spinner h-8 w-8 text-[var(--gantry-accent)]" />
        </div>
      ) : (
        <>
          {tab === 'roles' && <RolesTab roles={roles} onRefresh={refresh} />}
          {tab === 'groups' && <GroupsTab groups={groups} users={users} roleNames={roleNames} onRefresh={refresh} />}
          {tab === 'rules' && <RulesTab rules={rules} groups={groups} users={users} onRefresh={refresh} />}
          {tab === 'overview' && <OverviewTab users={users} />}
          {tab === 'import-export' && <ImportExportTab onRefresh={refresh} />}
        </>
      )}
    </div>
  );
}

// ─── Roles Tab ───────────────────────────────────────────────────────────────

function RolesTab({ roles, onRefresh }: { roles: Role[]; onRefresh: () => void }) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [level, setLevel] = useState(2);
  const [perms, setPerms] = useState<Record<string, boolean>>({ read: true, write: false, execute: false, delete: false, admin: false });
  const [error, setError] = useState('');

  const sorted = [...roles].sort((a, b) => a.level - b.level);

  const handleToggle = async (role: Role, perm: string) => {
    // Admin role must always keep admin permission.
    if (role.name === 'admin' && perm === 'admin') return;
    const updated = { ...role.permissions, [perm]: !role.permissions[perm] };
    try {
      await api.updateRole(role.id, { permissions: updated });
      onRefresh();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleCreate = async () => {
    setError('');
    try {
      await api.createRole({ name, displayName, description, level, permissions: perms });
      setName(''); setDisplayName(''); setDescription(''); setLevel(2);
      setPerms({ read: true, write: false, execute: false, delete: false, admin: false });
      setShowCreate(false);
      onRefresh();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteRole(id);
      onRefresh();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--gantry-text-primary)]">
          Roles
          <span className="ml-2 rounded-full bg-[var(--gantry-accent)]/10 px-2 py-0.5 text-xs font-medium text-[var(--gantry-accent)]">
            {roles.length}
          </span>
        </h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 rounded-lg bg-[var(--gantry-accent)] px-3 py-2 text-sm font-medium text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)]"
        >
          <Plus className="h-4 w-4" /> Create Role
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-[var(--gantry-danger)]/30 bg-[var(--gantry-danger)]/10 px-4 py-2 text-sm text-[var(--gantry-danger)]">
          {error}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Role name (e.g. qa-tester)"
              className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)]"
            />
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Display name (optional)"
              className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)]"
            />
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--gantry-text-secondary)]">Level</label>
              <input
                type="number"
                min={1}
                value={level}
                onChange={(e) => setLevel(parseInt(e.target.value) || 1)}
                className="w-20 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)]"
              />
            </div>
          </div>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)]"
          />
          <div className="flex items-center gap-4">
            <span className="text-xs font-medium text-[var(--gantry-text-secondary)]">Permissions:</span>
            {PERMISSION_COLUMNS.map((p) => (
              <label key={p} className="flex items-center gap-1.5 text-sm text-[var(--gantry-text-primary)]">
                <input
                  type="checkbox"
                  checked={perms[p] || false}
                  onChange={() => setPerms((prev) => ({ ...prev, [p]: !prev[p] }))}
                  className="rounded border-[var(--gantry-border)]"
                />
                {p}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!name}
              className="rounded-lg bg-[var(--gantry-accent)] px-4 py-2 text-sm font-medium text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)] disabled:opacity-50"
            >
              Create
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="rounded-lg border border-[var(--gantry-border)] px-4 py-2 text-sm text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Permissions matrix */}
      <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] overflow-hidden">
        {sorted.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-[var(--gantry-text-secondary)]">
            No roles configured.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)]">
                <th className="px-4 py-3 font-medium text-[var(--gantry-text-secondary)]">Role</th>
                <th className="px-4 py-3 font-medium text-[var(--gantry-text-secondary)] text-center w-16">Level</th>
                {PERMISSION_COLUMNS.map((p) => (
                  <th key={p} className="px-4 py-3 font-medium text-[var(--gantry-text-secondary)] text-center w-20">{p}</th>
                ))}
                <th className="px-4 py-3 w-12" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((role) => (
                <tr key={role.id} className="border-b border-[var(--gantry-border)] hover:bg-[var(--gantry-bg-secondary)]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {role.builtIn && <span title="Built-in role"><Lock className="h-3.5 w-3.5 text-[var(--gantry-text-secondary)]" /></span>}
                      <div>
                        <span className="font-medium text-[var(--gantry-text-primary)]">{role.displayName || role.name}</span>
                        {role.displayName && <span className="ml-2 text-xs text-[var(--gantry-text-secondary)]">{role.name}</span>}
                        {role.description && <p className="text-xs text-[var(--gantry-text-secondary)]">{role.description}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--gantry-bg-tertiary)] text-xs font-medium text-[var(--gantry-text-primary)]">
                      {role.level}
                    </span>
                  </td>
                  {PERMISSION_COLUMNS.map((p) => {
                    const isOn = role.permissions[p] || false;
                    const isLocked = role.name === 'admin' && p === 'admin';
                    return (
                      <td key={p} className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleToggle(role, p)}
                          disabled={isLocked}
                          className={`inline-flex h-6 w-6 items-center justify-center rounded transition-colors ${
                            isOn
                              ? 'bg-[var(--gantry-accent)] text-[var(--gantry-bg-primary)]'
                              : 'border border-[var(--gantry-border)] text-transparent hover:border-[var(--gantry-accent)]'
                          } ${isLocked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                          title={isLocked ? 'Admin must retain admin permission' : `Toggle ${p}`}
                        >
                          {isOn && <Check className="h-3.5 w-3.5" />}
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-4 py-3 text-right">
                    {role.builtIn ? (
                      <span className="text-xs text-[var(--gantry-text-secondary)]/40" title="Built-in role">—</span>
                    ) : (
                      <button
                        onClick={() => handleDelete(role.id)}
                        className="rounded p-1 text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-danger)]"
                        title="Delete role"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Groups Tab ──────────────────────────────────────────────────────────────

function GroupsTab({ groups, users, roleNames, onRefresh }: { groups: Group[]; users: User[]; roleNames: string[]; onRefresh: () => void }) {
  const [showCreate, setShowCreate] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [members, setMembers] = useState<User[]>([]);
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [role, setRole] = useState('viewer');
  const [error, setError] = useState('');

  const handleCreate = async () => {
    setError('');
    try {
      await api.createGroup({ name, displayName, description, role });
      setName(''); setDisplayName(''); setDescription(''); setRole('viewer');
      setShowCreate(false);
      onRefresh();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteGroup(id);
      onRefresh();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const toggleExpand = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    try {
      const detail = await api.getGroup(id);
      setMembers(detail.members);
    } catch {
      setMembers([]);
    }
  };

  const handleAddMember = async (groupId: string, userId: string) => {
    try {
      await api.addGroupMember(groupId, userId);
      const detail = await api.getGroup(groupId);
      setMembers(detail.members);
      onRefresh();
    } catch {
      // ignore
    }
  };

  const handleRemoveMember = async (groupId: string, userId: string) => {
    try {
      await api.removeGroupMember(groupId, userId);
      const detail = await api.getGroup(groupId);
      setMembers(detail.members);
      onRefresh();
    } catch {
      // ignore
    }
  };

  const handleRoleChange = async (id: string, newRole: string) => {
    try {
      await api.updateGroup(id, { role: newRole });
      onRefresh();
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--gantry-text-primary)]">
          Groups
          <span className="ml-2 rounded-full bg-[var(--gantry-accent)]/10 px-2 py-0.5 text-xs font-medium text-[var(--gantry-accent)]">
            {groups.length}
          </span>
        </h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 rounded-lg bg-[var(--gantry-accent)] px-3 py-2 text-sm font-medium text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)]"
        >
          <Plus className="h-4 w-4" /> Create Group
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-[var(--gantry-danger)]/30 bg-[var(--gantry-danger)]/10 px-4 py-2 text-sm text-[var(--gantry-danger)]">
          {error}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Group name (e.g. platform-team)"
              className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)]"
            />
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Display name (optional)"
              className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)]"
            />
          </div>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)]"
          />
          <div className="flex items-center gap-3">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)]"
            >
              {roleNames.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <button
              onClick={handleCreate}
              disabled={!name}
              className="rounded-lg bg-[var(--gantry-accent)] px-4 py-2 text-sm font-medium text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)] disabled:opacity-50"
            >
              Create
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="rounded-lg border border-[var(--gantry-border)] px-4 py-2 text-sm text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Groups list */}
      <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] overflow-hidden">
        {groups.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-[var(--gantry-text-secondary)]">
            No groups yet. Create a group or enable GitHub team sync.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)]">
                <th className="px-4 py-3 font-medium text-[var(--gantry-text-secondary)]">Name</th>
                <th className="px-4 py-3 font-medium text-[var(--gantry-text-secondary)]">Source</th>
                <th className="px-4 py-3 font-medium text-[var(--gantry-text-secondary)]">Base Role</th>
                <th className="px-4 py-3 font-medium text-[var(--gantry-text-secondary)]">Members</th>
                <th className="px-4 py-3 font-medium text-[var(--gantry-text-secondary)]"></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <>
                  <tr
                    key={g.id}
                    className="border-b border-[var(--gantry-border)] hover:bg-[var(--gantry-bg-secondary)] cursor-pointer"
                    onClick={() => toggleExpand(g.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {expanded === g.id ? <ChevronDown className="h-4 w-4 text-[var(--gantry-text-secondary)]" /> : <ChevronRight className="h-4 w-4 text-[var(--gantry-text-secondary)]" />}
                        <div>
                          <span className="font-medium text-[var(--gantry-text-primary)]">{g.displayName || g.name}</span>
                          {g.displayName && <span className="ml-2 text-xs text-[var(--gantry-text-secondary)]">{g.name}</span>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        g.source === 'github'
                          ? 'bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]'
                          : g.source === 'system'
                          ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                          : 'bg-[var(--gantry-bg-tertiary)] text-[var(--gantry-text-secondary)]'
                      }`}>
                        {g.source === 'github' && <Github className="h-3 w-3" />}
                        {g.source === 'system' && <Shield className="h-3 w-3" />}
                        {g.source}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={g.role}
                        onChange={(e) => { e.stopPropagation(); handleRoleChange(g.id, e.target.value); }}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-2 py-1 text-xs text-[var(--gantry-text-primary)]"
                      >
                        {roleNames.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-[var(--gantry-text-secondary)]">
                        <Users className="h-3.5 w-3.5" /> {g.memberCount || 0}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {g.source === 'local' ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(g.id); }}
                          className="rounded p-1 text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-danger)]"
                          title="Delete group"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      ) : (
                        <span className="text-xs text-[var(--gantry-text-secondary)]/40" title={g.source === 'system' ? 'Built-in group' : 'SSO-synced group'}>—</span>
                      )}
                    </td>
                  </tr>
                  {expanded === g.id && (
                    <tr key={g.id + '-members'}>
                      <td colSpan={5} className="bg-[var(--gantry-bg-secondary)] px-8 py-4">
                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-medium text-[var(--gantry-text-primary)]">Members</h4>
                            <select
                              onChange={(e) => { if (e.target.value) handleAddMember(g.id, e.target.value); e.target.value = ''; }}
                              className="rounded border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-2 py-1 text-xs text-[var(--gantry-text-primary)]"
                              defaultValue=""
                            >
                              <option value="" disabled>+ Add member...</option>
                              {users.filter((u) => !members.some((m) => m.id === u.id)).map((u) => (
                                <option key={u.id} value={u.id}>{u.displayName || u.username}</option>
                              ))}
                            </select>
                          </div>
                          {members.length === 0 ? (
                            <p className="text-xs text-[var(--gantry-text-secondary)]">No members</p>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {members.map((m) => (
                                <span key={m.id} className="inline-flex items-center gap-1 rounded-full bg-[var(--gantry-bg-primary)] border border-[var(--gantry-border)] px-3 py-1 text-xs text-[var(--gantry-text-primary)]">
                                  {m.displayName || m.username}
                                  <button
                                    onClick={() => handleRemoveMember(g.id, m.id)}
                                    className="ml-1 text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-danger)]"
                                  >
                                    x
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Rules Tab ────────────────────────────────────────────────────────────────

function RulesTab({ rules, groups, users, onRefresh }: { rules: PermissionRule[]; groups: Group[]; users: User[]; onRefresh: () => void }) {
  const [showCreate, setShowCreate] = useState(false);
  const [subjectType, setSubjectType] = useState<'user' | 'group'>('group');
  const [subjectId, setSubjectId] = useState('');
  const [resourceType, setResourceType] = useState('entity');
  const [resourceFilter, setResourceFilter] = useState('');
  const [action, setAction] = useState('write');
  const [effect, setEffect] = useState<'allow' | 'deny'>('allow');
  const [error, setError] = useState('');

  const handleCreate = async () => {
    setError('');
    try {
      await api.createPermissionRule({
        subjectType,
        subjectId,
        resourceType: resourceType as any,
        resourceFilter,
        action: action as any,
        effect,
      });
      setSubjectId(''); setResourceFilter('');
      setShowCreate(false);
      onRefresh();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deletePermissionRule(id);
      onRefresh();
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--gantry-text-primary)]">
          Permission Rules
          <span className="ml-2 rounded-full bg-[var(--gantry-accent)]/10 px-2 py-0.5 text-xs font-medium text-[var(--gantry-accent)]">
            {rules.length}
          </span>
        </h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 rounded-lg bg-[var(--gantry-accent)] px-3 py-2 text-sm font-medium text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)]"
        >
          <Plus className="h-4 w-4" /> Add Rule
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-[var(--gantry-danger)]/30 bg-[var(--gantry-danger)]/10 px-4 py-2 text-sm text-[var(--gantry-danger)]">
          {error}
        </div>
      )}

      {showCreate && (
        <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <select value={subjectType} onChange={(e) => { setSubjectType(e.target.value as any); setSubjectId(''); }} className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)]">
              <option value="group">Group</option>
              <option value="user">User</option>
            </select>
            <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)]">
              <option value="" disabled>Select {subjectType}...</option>
              {subjectType === 'group'
                ? groups.map((g) => <option key={g.id} value={g.id}>{g.displayName || g.name}</option>)
                : users.map((u) => <option key={u.id} value={u.id}>{u.displayName || u.username}</option>)
              }
            </select>
            <select value={resourceType} onChange={(e) => setResourceType(e.target.value)} className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)]">
              {RESOURCE_TYPES.map((rt) => <option key={rt} value={rt}>{rt === '*' ? 'All Resources' : rt}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <input
              value={resourceFilter}
              onChange={(e) => setResourceFilter(e.target.value)}
              placeholder="Filter (e.g. Service, production)"
              className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)]"
            />
            <select value={action} onChange={(e) => setAction(e.target.value)} className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)]">
              {ACTIONS.map((a) => <option key={a} value={a}>{a === '*' ? 'All Actions' : a}</option>)}
            </select>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setEffect('allow')}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  effect === 'allow'
                    ? 'bg-[var(--gantry-accent)] text-[var(--gantry-bg-primary)]'
                    : 'border border-[var(--gantry-border)] text-[var(--gantry-text-secondary)]'
                }`}
              >
                Allow
              </button>
              <button
                onClick={() => setEffect('deny')}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  effect === 'deny'
                    ? 'bg-[var(--gantry-danger)] text-white'
                    : 'border border-[var(--gantry-border)] text-[var(--gantry-text-secondary)]'
                }`}
              >
                Deny
              </button>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!subjectId}
              className="rounded-lg bg-[var(--gantry-accent)] px-4 py-2 text-sm font-medium text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)] disabled:opacity-50"
            >
              Create Rule
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="rounded-lg border border-[var(--gantry-border)] px-4 py-2 text-sm text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] overflow-hidden">
        {rules.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-[var(--gantry-text-secondary)]">
            No permission rules. The base role hierarchy applies to all users.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)]">
                <th className="px-4 py-3 font-medium text-[var(--gantry-text-secondary)]">Subject</th>
                <th className="px-4 py-3 font-medium text-[var(--gantry-text-secondary)]">Resource</th>
                <th className="px-4 py-3 font-medium text-[var(--gantry-text-secondary)]">Filter</th>
                <th className="px-4 py-3 font-medium text-[var(--gantry-text-secondary)]">Action</th>
                <th className="px-4 py-3 font-medium text-[var(--gantry-text-secondary)]">Effect</th>
                <th className="px-4 py-3 font-medium text-[var(--gantry-text-secondary)]"></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-b border-[var(--gantry-border)] hover:bg-[var(--gantry-bg-secondary)]">
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium uppercase text-[var(--gantry-text-secondary)]">{rule.subjectType}: </span>
                    <span className="text-[var(--gantry-text-primary)]">{rule.subjectName || rule.subjectId}</span>
                  </td>
                  <td className="px-4 py-3 text-[var(--gantry-text-primary)]">{rule.resourceType === '*' ? 'All' : rule.resourceType}</td>
                  <td className="px-4 py-3 text-[var(--gantry-text-secondary)]">{rule.resourceFilter || '-'}</td>
                  <td className="px-4 py-3 text-[var(--gantry-text-primary)]">{rule.action === '*' ? 'All' : rule.action}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      rule.effect === 'allow'
                        ? 'bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]'
                        : 'bg-[var(--gantry-danger)]/10 text-[var(--gantry-danger)]'
                    }`}>
                      {rule.effect}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(rule.id)}
                      className="rounded p-1 text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-danger)]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ users }: { users: User[] }) {
  const [selectedUserId, setSelectedUserId] = useState('');
  const [perms, setPerms] = useState<EffectivePermissions | null>(null);
  const [loading, setLoading] = useState(false);

  const loadPerms = async (userId: string) => {
    setSelectedUserId(userId);
    if (!userId) { setPerms(null); return; }
    setLoading(true);
    try {
      const p = await api.getEffectivePermissions(userId);
      setPerms(p);
    } catch {
      setPerms(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-[var(--gantry-text-primary)]">Effective Permissions</h2>
      <p className="text-sm text-[var(--gantry-text-secondary)]">
        Select a user to see their computed permissions from their direct role, group memberships, and permission rules.
      </p>

      <select
        value={selectedUserId}
        onChange={(e) => loadPerms(e.target.value)}
        className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-4 py-2 text-sm text-[var(--gantry-text-primary)]"
      >
        <option value="">Select a user...</option>
        {users.map((u) => <option key={u.id} value={u.id}>{u.displayName || u.username} (@{u.username})</option>)}
      </select>

      {loading && <div className="spinner h-6 w-6 text-[var(--gantry-accent)]" />}

      {perms && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-4">
              <p className="text-xs font-medium uppercase text-[var(--gantry-text-secondary)]">Direct Role</p>
              <p className="mt-1 text-lg font-semibold text-[var(--gantry-text-primary)]">{perms.directRole}</p>
            </div>
            <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-4">
              <p className="text-xs font-medium uppercase text-[var(--gantry-text-secondary)]">Effective Role</p>
              <p className="mt-1 text-lg font-semibold text-[var(--gantry-accent)]">{perms.effectiveRole}</p>
            </div>
            <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-4">
              <p className="text-xs font-medium uppercase text-[var(--gantry-text-secondary)]">Groups</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {perms.groups.length === 0 ? (
                  <span className="text-sm text-[var(--gantry-text-secondary)]">None</span>
                ) : (
                  perms.groups.map((g) => (
                    <span key={g} className="rounded-full bg-[var(--gantry-accent)]/10 px-2 py-0.5 text-xs font-medium text-[var(--gantry-accent)]">{g}</span>
                  ))
                )}
              </div>
            </div>
          </div>

          {perms.rules.length > 0 && (
            <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] overflow-hidden">
              <h3 className="border-b border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-4 py-2 text-sm font-medium text-[var(--gantry-text-primary)]">
                Applicable Rules ({perms.rules.length})
              </h3>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--gantry-border)]">
                    <th className="px-4 py-2 text-xs font-medium text-[var(--gantry-text-secondary)]">Source</th>
                    <th className="px-4 py-2 text-xs font-medium text-[var(--gantry-text-secondary)]">Resource</th>
                    <th className="px-4 py-2 text-xs font-medium text-[var(--gantry-text-secondary)]">Action</th>
                    <th className="px-4 py-2 text-xs font-medium text-[var(--gantry-text-secondary)]">Effect</th>
                  </tr>
                </thead>
                <tbody>
                  {perms.rules.map((r) => (
                    <tr key={r.id} className="border-b border-[var(--gantry-border)]">
                      <td className="px-4 py-2 text-[var(--gantry-text-secondary)]">{r.subjectType}: {r.subjectName || r.subjectId}</td>
                      <td className="px-4 py-2 text-[var(--gantry-text-primary)]">{r.resourceType}{r.resourceFilter ? ` / ${r.resourceFilter}` : ''}</td>
                      <td className="px-4 py-2 text-[var(--gantry-text-primary)]">{r.action}</td>
                      <td className="px-4 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          r.effect === 'allow' ? 'bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]' : 'bg-[var(--gantry-danger)]/10 text-[var(--gantry-danger)]'
                        }`}>{r.effect}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Import/Export Tab ─────────────────────────────────────────────────────────

function ImportExportTab({ onRefresh }: { onRefresh: () => void }) {
  const [importData, setImportData] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleExport = async () => {
    try {
      const config = await api.exportRBACConfig();
      const json = JSON.stringify(config, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'gantry-rbac-config.json';
      a.click();
      URL.revokeObjectURL(url);
      setMessage('Config exported successfully');
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleImport = async () => {
    setError('');
    setMessage('');
    try {
      const config: RBACConfig = JSON.parse(importData);
      const result = await api.importRBACConfig(config);
      setMessage(`Imported: ${result.groupsCreated} groups created, ${result.groupsUpdated} updated, ${result.rulesImported} rules`);
      setImportData('');
      onRefresh();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--gantry-text-primary)]">Export</h2>
        <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">
          Download the current RBAC configuration (groups, memberships, and rules) as JSON.
        </p>
        <button
          onClick={handleExport}
          className="mt-3 flex items-center gap-2 rounded-lg bg-[var(--gantry-accent)] px-4 py-2 text-sm font-medium text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)]"
        >
          <Download className="h-4 w-4" /> Export Config
        </button>
      </div>

      <hr className="border-[var(--gantry-border)]" />

      <div>
        <h2 className="text-lg font-semibold text-[var(--gantry-text-primary)]">Import</h2>
        <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">
          Paste JSON to replace the current RBAC configuration. Groups are reconciled; permission rules are fully replaced.
        </p>
        <textarea
          value={importData}
          onChange={(e) => setImportData(e.target.value)}
          placeholder='Paste RBAC config JSON here...'
          rows={10}
          className="mt-3 w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-4 py-3 font-mono text-sm text-[var(--gantry-text-primary)]"
        />
        <button
          onClick={handleImport}
          disabled={!importData.trim()}
          className="mt-2 flex items-center gap-2 rounded-lg bg-[var(--gantry-accent)] px-4 py-2 text-sm font-medium text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)] disabled:opacity-50"
        >
          <Upload className="h-4 w-4" /> Import Config
        </button>
      </div>

      {message && (
        <div className="rounded-lg border border-[var(--gantry-accent)]/30 bg-[var(--gantry-accent)]/10 px-4 py-2 text-sm text-[var(--gantry-accent)]">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-[var(--gantry-danger)]/30 bg-[var(--gantry-danger)]/10 px-4 py-2 text-sm text-[var(--gantry-danger)]">
          {error}
        </div>
      )}
    </div>
  );
}
