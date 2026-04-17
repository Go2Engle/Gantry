import { useState, useEffect } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, Github } from 'lucide-react';
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
  const [ssoConfigLoading, setSSOConfigLoading] = useState(true);
  const [showLocalLogin, setShowLocalLogin] = useState(false);
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    Promise.allSettled([
      api.getGitHubSSOConfig().then((cfg) => setGitHubSSOEnabled(cfg.ssoEnabled)),
      api.getAzureSSOConfig().then((cfg) => setAzureSSOEnabled(cfg.ssoEnabled)),
    ]).finally(() => setSSOConfigLoading(false));

    api.getVersion().then((v) => setAppVersion(v.version)).catch(() => {});

    // Check for SSO error in URL params (e.g. redirected back from OAuth callback).
    const params = new URLSearchParams(window.location.search);
    const ssoError = params.get('error');
    if (ssoError === 'sso_not_authorized') {
      setError('Your single sign-on account is not authorized for Gantry. Ask an administrator to create your account first.');
      setShowLocalLogin(true);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const hasSSO = gitHubSSOEnabled || azureSSOEnabled;
  const localLoginVisible = !ssoConfigLoading && (!hasSSO || showLocalLogin);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
    } catch (err: any) {
      setShowLocalLogin(true);
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
          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-[var(--gantry-danger)] dark:bg-red-900/20">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {hasSSO && !ssoConfigLoading && (
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
              {!showLocalLogin && (
                <button
                  type="button"
                  onClick={() => setShowLocalLogin(true)}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--gantry-border)] px-4 py-2.5 text-sm font-medium text-[var(--gantry-text-secondary)] transition-colors hover:bg-[var(--gantry-bg-secondary)] hover:text-[var(--gantry-text-primary)]"
                  aria-expanded={showLocalLogin}
                >
                  Use username and password
                  <ChevronDown className="h-4 w-4" />
                </button>
              )}
            </>
          )}

          {!ssoConfigLoading && localLoginVisible && (
            <div className={hasSSO ? 'mt-4 border-t border-[var(--gantry-border)] pt-4' : ''}>
              {hasSSO && (
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--gantry-text-primary)]">Local sign in</p>
                    <p className="text-xs text-[var(--gantry-text-secondary)]">Use local credentials if your administrator provided them.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowLocalLogin(false)}
                    className="flex items-center gap-1 text-xs font-medium text-[var(--gantry-text-secondary)] transition-colors hover:text-[var(--gantry-text-primary)]"
                    aria-expanded={showLocalLogin}
                  >
                    Hide
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
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
                    autoFocus={!hasSSO}
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
          )}

          {ssoConfigLoading && (
            <p className="text-sm text-[var(--gantry-text-secondary)]">Checking available sign-in methods...</p>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-[var(--gantry-text-secondary)]">
          Gantry Internal Developer Platform{appVersion ? ` v${appVersion}` : ''}
        </p>
      </div>
    </div>
  );
}
