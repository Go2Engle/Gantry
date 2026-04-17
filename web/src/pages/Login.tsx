import { useState, useEffect } from 'react';
import { AlertCircle, Github } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { api } from '../lib/api';
import ThemeToggle from '../components/ThemeToggle';

function MicrosoftLogo() {
  return (
    <span className="grid h-4 w-4 grid-cols-2 gap-[2px]" aria-hidden="true">
      <span className="rounded-[1px] bg-[#f25022]" />
      <span className="rounded-[1px] bg-[#7fba00]" />
      <span className="rounded-[1px] bg-[#00a4ef]" />
      <span className="rounded-[1px] bg-[#ffb900]" />
    </span>
  );
}

export default function Login() {
  const { login } = useAuth();
  const { theme } = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [gitHubSSOEnabled, setGitHubSSOEnabled] = useState(false);
  const [azureSSOEnabled, setAzureSSOEnabled] = useState(false);
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    api.getGitHubSSOConfig()
      .then((cfg) => setGitHubSSOEnabled(cfg.ssoEnabled))
      .catch(() => {}); // SSO check is non-critical

    api.getAzureSSOConfig()
      .then((cfg) => setAzureSSOEnabled(cfg.ssoEnabled))
      .catch(() => {}); // SSO check is non-critical

    api.getVersion().then((v) => setAppVersion(v.version)).catch(() => {});

    // Check for SSO error in URL params (e.g. redirected back from OAuth callback).
    const params = new URLSearchParams(window.location.search);
    const ssoError = params.get('error');
    if (ssoError === 'sso_not_authorized') {
      setError('Your single sign-on account is not authorized for Gantry. Ask an administrator to create your account first.');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--gantry-bg-secondary)] px-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm">
        {/* Branding */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--gantry-accent)]">
            <img src={theme === 'dark' ? '/logo-black.png' : '/logo-white.png'} alt="Gantry" className="h-10 w-10 object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-[var(--gantry-text-primary)]">
            Welcome to Gantry
          </h1>
          <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">
            Internal Developer Platform
          </p>
        </div>

        {/* Login Card */}
        <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-6 shadow-sm">
          {(gitHubSSOEnabled || azureSSOEnabled) && (
            <>
              <div className="space-y-3">
                {gitHubSSOEnabled && (
                  <a
                    href={`/api/v1/auth/github?return_to=${encodeURIComponent(window.location.origin)}`}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--gantry-border)] px-4 py-2.5 text-sm font-medium text-[var(--gantry-text-primary)] transition-colors hover:bg-[var(--gantry-bg-secondary)]"
                  >
                    <Github className="h-4 w-4" />
                    Sign in with GitHub
                  </a>
                )}
                {azureSSOEnabled && (
                  <a
                    href={`/api/v1/auth/azure?return_to=${encodeURIComponent(window.location.origin)}`}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--gantry-border)] px-4 py-2.5 text-sm font-medium text-[var(--gantry-text-primary)] transition-colors hover:bg-[var(--gantry-bg-secondary)]"
                  >
                    <MicrosoftLogo />
                    Sign in with Microsoft Azure
                  </a>
                )}
              </div>
              <div className="my-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-[var(--gantry-border)]" />
                <span className="text-xs text-[var(--gantry-text-secondary)]">or</span>
                <div className="h-px flex-1 bg-[var(--gantry-border)]" />
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-[var(--gantry-danger)] dark:bg-red-900/20">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label
                htmlFor="username"
                className="block text-sm font-medium text-[var(--gantry-text-primary)]"
              >
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                required
                autoFocus
                autoComplete="username"
                className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] placeholder:text-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--gantry-accent)]"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="password"
                className="block text-sm font-medium text-[var(--gantry-text-primary)]"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                autoComplete="current-password"
                className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] placeholder:text-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--gantry-accent)]"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--gantry-accent)] px-4 py-2.5 text-sm font-medium text-[var(--gantry-bg-primary)] transition-colors hover:bg-[var(--gantry-accent-hover)] disabled:opacity-60"
            >
              {loading && <div className="spinner h-4 w-4" />}
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-[var(--gantry-text-secondary)]">
          Gantry Internal Developer Platform{appVersion ? ` v${appVersion}` : ''}
        </p>
      </div>
    </div>
  );
}
