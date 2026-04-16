import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Shield, Users, KeyRound, Globe } from 'lucide-react';
import { api } from '../lib/api';
import type { User } from '../lib/types';

const MIN_PASSWORD_LENGTH = 8;
const COLUMNS = ['User', 'Email', 'Groups', 'Effective Role', ''] as const;
const MIN_COL_WIDTH = 60;

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  'platform-engineer': 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  developer: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  viewer: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

export default function UsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Create form
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newSSOOnly, setNewSSOOnly] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // Reset password modal
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetSuccess, setResetSuccess] = useState('');

  // Column resize state
  const [colWidths, setColWidths] = useState<number[] | null>(null);
  const headerRef = useRef<HTMLTableRowElement>(null);
  const dragRef = useRef<{ colIndex: number; startX: number; startWidths: number[] } | null>(null);

  const onResizeStart = useCallback((e: React.MouseEvent, colIndex: number) => {
    e.preventDefault();
    const row = headerRef.current;
    if (!row) return;
    const cells = Array.from(row.children) as HTMLElement[];
    const widths = cells.map((c) => c.getBoundingClientRect().width);
    dragRef.current = { colIndex, startX: e.clientX, startWidths: widths };
    setColWidths(widths);

    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const delta = ev.clientX - d.startX;
      const next = [...d.startWidths];
      const nextCol = d.colIndex + 1;
      next[d.colIndex] = Math.max(MIN_COL_WIDTH, d.startWidths[d.colIndex] + delta);
      next[nextCol] = Math.max(MIN_COL_WIDTH, d.startWidths[nextCol] - delta);
      setColWidths(next);
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  useEffect(() => {
    api.listUsers()
      .then((list) => setUsers(list ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    setCreateError('');
    if (!newUsername.trim()) return;
    if (!newSSOOnly && !newPassword.trim()) return;
    if (!newSSOOnly && newPassword.trim().length < MIN_PASSWORD_LENGTH) {
      setCreateError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    setCreating(true);
    try {
      const created = await api.createUser(
        newUsername.trim(),
        newSSOOnly ? '' : newPassword.trim(),
        newDisplayName.trim() || undefined,
        newEmail.trim() || undefined,
        undefined,
        newSSOOnly || undefined,
      );
      setUsers((prev) => [...prev, created]);
      setNewUsername('');
      setNewPassword('');
      setNewDisplayName('');
      setNewEmail('');
      setNewSSOOnly(false);
    } catch (e: any) {
      setCreateError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteUser(id);
      setUsers((prev) => prev.filter((u) => u.id !== id));
    } catch {
      // silently ignore
    }
  };

  const handleResetPassword = async () => {
    if (!resetUserId || !resetPassword.trim()) return;
    if (resetPassword.trim().length < MIN_PASSWORD_LENGTH) {
      setResetError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    setResetError('');
    setResetSuccess('');
    setResetting(true);
    try {
      await api.resetPassword(resetUserId, resetPassword.trim());
      setResetSuccess('Password reset successfully');
      setResetPassword('');
      setTimeout(() => {
        setResetUserId(null);
        setResetSuccess('');
      }, 1500);
    } catch (e: any) {
      setResetError(e.message);
    } finally {
      setResetting(false);
    }
  };

  const resetUser = users.find((u) => u.id === resetUserId);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--gantry-text-primary)]">Users</h1>
          <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">
            Manage user accounts. Roles are assigned via{' '}
            <Link to="/rbac" className="text-[var(--gantry-accent)] hover:underline">
              Access Control
            </Link>{' '}
            groups.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-3 py-2">
          <Users className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
          <span className="text-sm font-medium text-[var(--gantry-text-primary)]">{users.length}</span>
          <span className="text-sm text-[var(--gantry-text-secondary)]">
            {users.length === 1 ? 'user' : 'users'}
          </span>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Create user panel */}
        <div className="w-full lg:w-72 shrink-0">
          <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-5">
            <h2 className="text-sm font-semibold text-[var(--gantry-text-primary)]">Add User</h2>
            <p className="mt-0.5 text-xs text-[var(--gantry-text-secondary)]">Create a new account</p>

            <div className="mt-4 space-y-3">
              {/* SSO-only toggle */}
              <div className="flex items-center justify-between rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
                  <div>
                    <label id="sso-switch-label" className="text-xs font-medium text-[var(--gantry-text-primary)]">SSO-only account</label>
                    <p className="text-[10px] leading-tight text-[var(--gantry-text-secondary)]">
                      User must sign in via SSO provider
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={newSSOOnly}
                  aria-labelledby="sso-switch-label"
                  onClick={() => { setNewSSOOnly(!newSSOOnly); setNewPassword(''); }}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${
                    newSSOOnly ? 'bg-[var(--gantry-accent)]' : 'bg-[var(--gantry-border)]'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-[var(--gantry-bg-primary)] shadow-sm transition-transform ${
                      newSSOOnly ? 'translate-x-4' : 'translate-x-0.5'
                    } mt-0.5`}
                  />
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--gantry-text-secondary)]">
                  Username <span className="text-[var(--gantry-danger)]">*</span>
                </label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder={newSSOOnly ? 'e.g. github:jsmith' : 'e.g. jsmith'}
                  className="mt-1 w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] placeholder-[var(--gantry-text-secondary)] outline-none focus:border-[var(--gantry-accent)]"
                />
              </div>
              {!newSSOOnly && (
                <div>
                  <label className="block text-xs font-medium text-[var(--gantry-text-secondary)]">
                    Password <span className="text-[var(--gantry-danger)]">*</span>
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min. 8 characters"
                    className="mt-1 w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] placeholder-[var(--gantry-text-secondary)] outline-none focus:border-[var(--gantry-accent)]"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-[var(--gantry-text-secondary)]">Display Name</label>
                <input
                  type="text"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  placeholder="e.g. Jane Smith"
                  className="mt-1 w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] placeholder-[var(--gantry-text-secondary)] outline-none focus:border-[var(--gantry-accent)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--gantry-text-secondary)]">Email</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="jane@example.com"
                  className="mt-1 w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] placeholder-[var(--gantry-text-secondary)] outline-none focus:border-[var(--gantry-accent)]"
                />
              </div>
            </div>

            {createError && (
              <p className="mt-3 text-xs text-[var(--gantry-danger)]">{createError}</p>
            )}

            <button
              onClick={handleCreate}
              disabled={creating || !newUsername.trim() || (!newSSOOnly && !newPassword.trim())}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--gantry-accent)] px-4 py-2 text-sm font-medium text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)] disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {creating ? 'Creating…' : newSSOOnly ? 'Create SSO User' : 'Create User'}
            </button>
          </div>

          {/* Managing roles hint */}
          <div className="mt-4 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--gantry-text-primary)]">
              <Shield className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
              Managing Roles
            </h3>
            <p className="mt-2 text-xs text-[var(--gantry-text-secondary)]">
              New users start as <strong>viewer</strong>. To grant higher access, add them to a group in{' '}
              <Link to="/rbac" className="text-[var(--gantry-accent)] hover:underline">
                Access Control
              </Link>
              . Default groups: Admins, Platform Engineers, Developers.
            </p>
          </div>
        </div>

        {/* User list */}
        <div className="flex-1 min-w-0">
          <div className="overflow-hidden rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--gantry-accent)] border-t-transparent" />
              </div>
            ) : users.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16">
                <Users className="h-8 w-8 text-[var(--gantry-text-secondary)]" />
                <p className="mt-2 text-sm text-[var(--gantry-text-secondary)]">No users yet</p>
              </div>
            ) : (
              <table className="w-full" style={colWidths ? { tableLayout: 'fixed' } : undefined}>
                {colWidths && (
                  <colgroup>
                    {colWidths.map((w, i) => (
                      <col key={i} style={{ width: w }} />
                    ))}
                  </colgroup>
                )}
                <thead>
                  <tr ref={headerRef} className="border-b border-[var(--gantry-border)]">
                    {COLUMNS.map((label, i) => (
                      <th
                        key={i}
                        className="relative select-none px-4 py-3 text-left text-xs font-medium text-[var(--gantry-text-secondary)]"
                      >
                        {label}
                        {i < COLUMNS.length - 1 && (
                          <span
                            onMouseDown={(e) => onResizeStart(e, i)}
                            className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-[var(--gantry-accent)]/30"
                          />
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--gantry-border)]">
                  {users.map((u) => (
                    <tr key={u.id} className="group">
                      <td className="px-4 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--gantry-bg-tertiary)] text-xs font-semibold text-[var(--gantry-text-primary)]">
                            {(u.displayName || u.username)[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p
                                className="truncate text-sm font-medium text-[var(--gantry-text-primary)]"
                                title={u.displayName || u.username}
                              >
                                {u.displayName || u.username}
                              </p>
                              {u.id === me?.id && (
                                <span className="text-xs text-[var(--gantry-text-secondary)]">(you)</span>
                              )}
                              {u.ssoOnly && (
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--gantry-accent)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--gantry-accent)]">
                                  <Globe className="h-2.5 w-2.5" />
                                  SSO
                                </span>
                              )}
                            </div>
                            <p className="truncate text-xs text-[var(--gantry-text-secondary)]" title={`@${u.username}`}>@{u.username}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--gantry-text-secondary)]">
                        {u.email ? (
                          <p className="truncate" title={u.email}>{u.email}</p>
                        ) : (
                          <span className="text-[var(--gantry-text-secondary)]/40">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {u.groups && u.groups.length > 0 ? (
                            u.groups.map((g) => (
                              <span
                                key={g}
                                className="inline-flex rounded-full bg-[var(--gantry-accent)]/10 px-2 py-0.5 text-xs font-medium text-[var(--gantry-accent)]"
                              >
                                {g}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-[var(--gantry-text-secondary)]/40">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_COLORS[u.effectiveRole || u.role] || ROLE_COLORS.viewer}`}>
                          {u.effectiveRole || u.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {!u.ssoOnly && u.id !== me?.id && (
                            <button
                              onClick={() => { setResetUserId(u.id); setResetPassword(''); setResetError(''); setResetSuccess(''); }}
                              className="rounded p-1.5 text-[var(--gantry-text-secondary)] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--gantry-bg-tertiary)] hover:text-[var(--gantry-accent)]"
                              title="Reset password"
                              aria-label={`Reset password for ${u.displayName || u.username}`}
                            >
                              <KeyRound className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(u.id)}
                            disabled={u.id === me?.id}
                            className="rounded p-1.5 text-[var(--gantry-text-secondary)] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--gantry-bg-tertiary)] hover:text-[var(--gantry-danger)] disabled:pointer-events-none disabled:opacity-0"
                            title="Delete user"
                            aria-label={`Delete user ${u.displayName || u.username}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Reset password modal */}
      {resetUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setResetUserId(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-password-title"
            className="w-full max-w-sm rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="reset-password-title" className="text-base font-semibold text-[var(--gantry-text-primary)]">Reset Password</h3>
            <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">
              Set a new password for <strong>{resetUser?.displayName || resetUser?.username}</strong>
            </p>
            <div className="mt-4">
              <label className="block text-xs font-medium text-[var(--gantry-text-secondary)]">
                New Password <span className="text-[var(--gantry-danger)]">*</span>
              </label>
              <input
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                placeholder="Min. 8 characters"
                className="mt-1 w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] placeholder-[var(--gantry-text-secondary)] outline-none focus:border-[var(--gantry-accent)]"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleResetPassword(); }}
              />
            </div>
            {resetError && <p className="mt-2 text-xs text-[var(--gantry-danger)]">{resetError}</p>}
            {resetSuccess && <p className="mt-2 text-xs text-[var(--gantry-accent)]">{resetSuccess}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setResetUserId(null)}
                className="rounded-lg border border-[var(--gantry-border)] px-3 py-1.5 text-sm text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-secondary)]"
              >
                Cancel
              </button>
              <button
                onClick={handleResetPassword}
                disabled={resetting || !resetPassword.trim() || resetPassword.trim().length < MIN_PASSWORD_LENGTH}
                className="rounded-lg bg-[var(--gantry-accent)] px-3 py-1.5 text-sm font-medium text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)] disabled:opacity-50"
              >
                {resetting ? 'Resetting…' : 'Reset Password'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
