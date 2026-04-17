import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { Sun, Moon, User, Shield, Info, Key, Plus, Trash2, Copy, Check, Lock } from 'lucide-react';
import { api } from '../lib/api';
import type { APIKey } from '../lib/types';

export default function Settings() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const effectiveRole = user?.effectiveRole || user?.role || '';

  // API Keys
  const [apiKeys, setAPIKeys] = useState<APIKey[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKey, setNewKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [creatingKey, setCreatingKey] = useState(false);

  // Change Password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);
  const [savingPw, setSavingPw] = useState(false);

  // Version
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    api.listAPIKeys().then((keys) => setAPIKeys(keys ?? [])).catch(() => {});
    api.getVersion().then((v) => setAppVersion(v.version)).catch(() => {});
  }, []);

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    setCreatingKey(true);
    try {
      const key = await api.createAPIKey(newKeyName.trim());
      setAPIKeys((prev) => [key, ...prev]);
      setNewKey(key.key ?? '');
      setNewKeyName('');
    } finally {
      setCreatingKey(false);
    }
  };

  const handleRevokeKey = async (id: string) => {
    await api.revokeAPIKey(id);
    setAPIKeys((prev) => prev.filter((k) => k.id !== id));
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleChangePassword = async () => {
    setPwError('');
    setPwSuccess(false);
    if (newPassword !== confirmPassword) {
      setPwError('New passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setPwError('New password must be at least 8 characters.');
      return;
    }
    setSavingPw(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setPwSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (e: any) {
      setPwError(e.message);
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--gantry-text-primary)]">Settings</h1>
      <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">Manage your preferences</p>

      <div className="mt-8 space-y-6">
        {/* Profile */}
        <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]">
              <User className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--gantry-text-primary)]">Profile</h2>
              <p className="text-xs text-[var(--gantry-text-secondary)]">Your account information</p>
            </div>
          </div>
          <dl className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <dt className="text-sm text-[var(--gantry-text-secondary)]">Username</dt>
              <dd className="text-sm font-medium text-[var(--gantry-text-primary)]">{user?.username || '-'}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-sm text-[var(--gantry-text-secondary)]">Email</dt>
              <dd className="text-sm font-medium text-[var(--gantry-text-primary)]">{user?.email || '-'}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-sm text-[var(--gantry-text-secondary)]">Role</dt>
              <dd className="flex items-center gap-1.5 text-sm font-medium text-[var(--gantry-text-primary)]">
                <Shield className="h-3.5 w-3.5 text-[var(--gantry-accent)]" />
                {effectiveRole || '-'}
              </dd>
            </div>
          </dl>
          <button
            onClick={logout}
            className="mt-4 rounded-lg border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            Sign Out
          </button>
        </div>

        {/* Appearance */}
        <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-6">
          <h2 className="text-sm font-semibold text-[var(--gantry-text-primary)]">Appearance</h2>
          <div className="mt-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {theme === 'dark' ? <Moon className="h-5 w-5 text-[var(--gantry-text-secondary)]" /> : <Sun className="h-5 w-5 text-[var(--gantry-text-secondary)]" />}
              <div>
                <p className="text-sm text-[var(--gantry-text-primary)]">Theme</p>
                <p className="text-xs text-[var(--gantry-text-secondary)]">
                  Currently using {theme} mode
                </p>
              </div>
            </div>
            <button
              onClick={toggle}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                theme === 'dark' ? 'bg-[var(--gantry-accent)]' : 'bg-[var(--gantry-bg-tertiary)]'
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-[var(--gantry-bg-primary)] shadow transition-transform ${
                  theme === 'dark' ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Change Password */}
        <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--gantry-text-primary)]">Change Password</h2>
              <p className="text-xs text-[var(--gantry-text-secondary)]">Update your account password</p>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-[var(--gantry-text-secondary)]">Current password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] outline-none focus:border-[var(--gantry-accent)]"
                placeholder="••••••••"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--gantry-text-secondary)]">New password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] outline-none focus:border-[var(--gantry-accent)]"
                placeholder="Min. 8 characters"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--gantry-text-secondary)]">Confirm new password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleChangePassword()}
                className="mt-1 w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] outline-none focus:border-[var(--gantry-accent)]"
                placeholder="••••••••"
              />
            </div>
          </div>
          {pwError && (
            <p className="mt-3 text-xs text-red-500">{pwError}</p>
          )}
          {pwSuccess && (
            <p className="mt-3 text-xs text-green-600 dark:text-green-400">Password updated successfully.</p>
          )}
          <button
            onClick={handleChangePassword}
            disabled={savingPw || !currentPassword || !newPassword || !confirmPassword}
            className="mt-4 rounded-lg bg-[var(--gantry-accent)] px-4 py-2 text-sm font-medium text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)] disabled:opacity-50"
          >
            {savingPw ? 'Saving…' : 'Update Password'}
          </button>
        </div>

        {/* API Keys */}
        <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-6">
          <div className="flex items-center gap-3">
            <Key className="h-5 w-5 text-[var(--gantry-text-secondary)]" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--gantry-text-primary)]">API Keys</h2>
              <p className="text-xs text-[var(--gantry-text-secondary)]">Long-lived tokens for CLI and CI/CD use</p>
            </div>
          </div>

          {/* Revealed new key */}
          {newKey && (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20">
              <p className="mb-2 text-xs font-medium text-green-700 dark:text-green-400">
                Copy this key now — it won't be shown again.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-white/50 px-2 py-1 text-xs text-green-800 dark:bg-black/20 dark:text-green-300">
                  {newKey}
                </code>
                <button
                  onClick={handleCopy}
                  className="shrink-0 rounded p-1.5 text-green-700 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/40"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <button
                onClick={() => setNewKey('')}
                className="mt-2 text-xs text-green-600 underline dark:text-green-500"
              >
                Done, I've saved it
              </button>
            </div>
          )}

          {/* Create new key */}
          <div className="mt-4 flex gap-2">
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateKey()}
              placeholder="Key name (e.g. ci-deploy)"
              className="flex-1 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] placeholder-[var(--gantry-text-secondary)] outline-none focus:border-[var(--gantry-accent)]"
            />
            <button
              onClick={handleCreateKey}
              disabled={creatingKey || !newKeyName.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--gantry-accent)] px-3 py-2 text-sm font-medium text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)] disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Create
            </button>
          </div>

          {/* Key list */}
          {apiKeys.length > 0 && (
            <ul className="mt-4 divide-y divide-[var(--gantry-border)]">
              {apiKeys.map((k) => (
                <li key={k.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--gantry-text-primary)]">{k.name}</p>
                    <p className="text-xs text-[var(--gantry-text-secondary)]">
                      {k.prefix}… · {k.role} ·{' '}
                      {k.lastUsedAt
                        ? `Last used ${new Date(k.lastUsedAt).toLocaleDateString()}`
                        : 'Never used'}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRevokeKey(k.id)}
                    className="rounded p-1.5 text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)] hover:text-[var(--gantry-danger)]"
                    title="Revoke"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* About */}
        <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-6">
          <div className="flex items-center gap-3">
            <Info className="h-5 w-5 text-[var(--gantry-text-secondary)]" />
            <h2 className="text-sm font-semibold text-[var(--gantry-text-primary)]">About</h2>
          </div>
          <dl className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <dt className="text-sm text-[var(--gantry-text-secondary)]">Version</dt>
              <dd className="text-sm font-medium text-[var(--gantry-text-primary)]">{appVersion || '—'}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-sm text-[var(--gantry-text-secondary)]">License</dt>
              <dd className="text-sm font-medium text-[var(--gantry-text-primary)]">Apache 2.0</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-[var(--gantry-text-secondary)]">
            Gantry — The Developer Platform That Just Works
          </p>
        </div>
      </div>
    </div>
  );
}
