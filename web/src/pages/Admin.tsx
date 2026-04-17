import { useEffect, useState, type ComponentType } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ClipboardList,
  Lock,
  Shield,
  Sparkles,
  UserCog,
  Users,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import type { AuditEntry, Group, Role, User } from '../lib/types';
import AuditLog from './AuditLog';
import RBAC from './RBAC';
import UsersPage from './Users';

export type AdminSection = 'overview' | 'users' | 'access' | 'audit';

interface AdminProps {
  section?: Exclude<AdminSection, 'overview'>;
}

interface SectionMeta {
  id: AdminSection;
  label: string;
  description: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
}

const sections: SectionMeta[] = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'A home base for operational settings and day-two admin work.',
    href: '/admin',
    icon: Shield,
  },
  {
    id: 'users',
    label: 'Users',
    description: 'Create accounts, reset passwords, and manage who can sign in.',
    href: '/admin/users',
    icon: UserCog,
  },
  {
    id: 'access',
    label: 'Access Control',
    description: 'Manage roles, groups, permission rules, and effective access.',
    href: '/admin/access',
    icon: Lock,
  },
  {
    id: 'audit',
    label: 'Audit Activity',
    description: 'Review recent changes and trace operational activity.',
    href: '/admin/audit',
    icon: ClipboardList,
  },
];

function relativeTime(ts: string): string {
  const date = new Date(ts);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function renderSection(section: AdminSection) {
  switch (section) {
    case 'users':
      return <UsersPage embedded />;
    case 'access':
      return <RBAC embedded />;
    case 'audit':
      return <AuditLog embedded />;
    default:
      return null;
  }
}

export default function Admin({ section }: AdminProps) {
  const { user } = useAuth();
  const currentSection: AdminSection = section ?? 'overview';
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [activity, setActivity] = useState<AuditEntry[]>([]);
  const [loadingOverview, setLoadingOverview] = useState(currentSection === 'overview');
  const [overviewError, setOverviewError] = useState('');

  useEffect(() => {
    if (!user?.permissions?.admin) return;

    let active = true;
    if (currentSection === 'overview') {
      setLoadingOverview(true);
      setOverviewError('');
    }

    const requests: Promise<unknown>[] = [
      api.listUsers(),
      api.listGroups(),
      api.listRoles().catch(() => [] as Role[]),
    ];

    if (currentSection === 'overview') {
      requests.push(api.listAuditEntries(5, 0));
    }

    Promise.allSettled(requests)
      .then((results) => {
        if (!active) return;

        const [usersResult, groupsResult, rolesResult, auditResult] = results;

        if (usersResult.status === 'fulfilled') {
          setUsers((usersResult.value as User[] | undefined) ?? []);
        }
        if (groupsResult.status === 'fulfilled') {
          setGroups((groupsResult.value as Group[] | undefined) ?? []);
        }
        if (rolesResult.status === 'fulfilled') {
          setRoles((rolesResult.value as Role[] | undefined) ?? []);
        }
        if (auditResult?.status === 'fulfilled') {
          setActivity((auditResult.value as AuditEntry[] | undefined) ?? []);
        } else if (currentSection !== 'overview') {
          setActivity([]);
        }

        if (currentSection === 'overview' && auditResult?.status === 'rejected' && usersResult.status === 'rejected' && groupsResult.status === 'rejected' && rolesResult.status === 'rejected') {
          setOverviewError('Failed to load admin overview.');
        }
      })
      .finally(() => {
        if (active && currentSection === 'overview') {
          setLoadingOverview(false);
        }
      });

    return () => {
      active = false;
    };
  }, [currentSection, user?.permissions?.admin]);

  if (!user?.permissions?.admin) {
    return (
      <div className="rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-8">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]">
            <Shield className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-[var(--gantry-text-primary)]">Admin</h1>
            <p className="text-sm text-[var(--gantry-text-secondary)]">
              This area is reserved for administrators.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const activeMeta = sections.find((item) => item.id === currentSection) ?? sections[0];

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-3xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
        <div className="border-b border-[var(--gantry-border)] bg-[var(--gantry-accent)]/10 px-6 py-6 sm:px-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-3 py-1 text-xs font-medium text-[var(--gantry-text-secondary)]">
                <Sparkles className="h-3.5 w-3.5 text-[var(--gantry-accent)]" />
                Unified Admin Workspace
              </div>
              <h1 className="mt-4 text-3xl font-semibold text-[var(--gantry-text-primary)]">Admin</h1>
              <p className="mt-2 text-sm leading-6 text-[var(--gantry-text-secondary)]">
                Centralize Gantry administration in one place so future non-plugin settings have a clear home.
              </p>
            </div>
            <div className="grid w-full gap-3 sm:grid-cols-3 lg:w-auto lg:min-w-[360px]">
              <div className="rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-[var(--gantry-text-secondary)]">Users</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--gantry-text-primary)]">{users.length}</p>
              </div>
              <div className="rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-[var(--gantry-text-secondary)]">Groups</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--gantry-text-primary)]">{groups.length}</p>
              </div>
              <div className="rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-[var(--gantry-text-secondary)]">Roles</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--gantry-text-primary)]">{roles.length}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 sm:px-8">
          <div className="grid gap-3 lg:grid-cols-4">
            {sections.map((item) => {
              const Icon = item.icon;
              const active = item.id === currentSection;
              return (
                <Link
                  key={item.id}
                  to={item.href}
                  className={`rounded-2xl border px-4 py-4 transition-colors ${
                    active
                      ? 'border-[var(--gantry-accent)] bg-[var(--gantry-accent)]/10'
                      : 'border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] hover:bg-[var(--gantry-bg-tertiary)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${active ? 'bg-[var(--gantry-accent)] text-[var(--gantry-bg-primary)]' : 'bg-[var(--gantry-bg-primary)] text-[var(--gantry-text-secondary)]'}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <ArrowRight className={`h-4 w-4 ${active ? 'text-[var(--gantry-accent)]' : 'text-[var(--gantry-text-secondary)]'}`} />
                  </div>
                  <h2 className="mt-4 text-base font-semibold text-[var(--gantry-text-primary)]">{item.label}</h2>
                  <p className="mt-1 text-sm leading-6 text-[var(--gantry-text-secondary)]">{item.description}</p>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {currentSection === 'overview' ? (
        <div className="grid gap-6 xl:grid-cols-[1.25fr,0.75fr]">
          <section className="rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[var(--gantry-text-primary)]">Recent Admin Activity</h2>
                <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">
                  Keep an eye on operational changes without leaving the admin workspace.
                </p>
              </div>
              <Link
                to="/admin/audit"
                className="inline-flex items-center gap-1 rounded-full border border-[var(--gantry-border)] px-3 py-1.5 text-sm text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-secondary)]"
              >
                Open audit
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            {overviewError && (
              <div className="mt-4 rounded-xl border border-[var(--gantry-danger)]/30 bg-[var(--gantry-danger)]/10 px-4 py-3 text-sm text-[var(--gantry-danger)]">
                {overviewError}
              </div>
            )}

            {loadingOverview ? (
              <div className="flex items-center justify-center py-16">
                <div className="spinner h-8 w-8 text-[var(--gantry-accent)]" />
              </div>
            ) : activity.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-dashed border-[var(--gantry-border)] px-6 py-10 text-center">
                <ClipboardList className="mx-auto h-10 w-10 text-[var(--gantry-text-secondary)]" />
                <p className="mt-3 text-sm text-[var(--gantry-text-secondary)]">No audit activity to show yet.</p>
              </div>
            ) : (
              <div className="mt-6 divide-y divide-[var(--gantry-border)] overflow-hidden rounded-2xl border border-[var(--gantry-border)]">
                {activity.map((entry) => (
                  <div key={entry.id} className="flex items-center gap-4 px-5 py-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]">
                      <ClipboardList className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--gantry-text-primary)]">
                        {entry.resourceType && entry.resourceName
                          ? `${entry.resourceType}/${entry.resourceName}`
                          : entry.action}
                      </p>
                      <p className="truncate text-xs text-[var(--gantry-text-secondary)]">
                        {entry.action}
                        {entry.userName ? ` by ${entry.userName}` : ''}
                        {entry.source ? ` via ${entry.source}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-[var(--gantry-text-secondary)]">
                      {relativeTime(entry.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-6">
            <div className="rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-6">
              <h2 className="text-lg font-semibold text-[var(--gantry-text-primary)]">Admin Workflows</h2>
              <div className="mt-5 space-y-3">
                <Link
                  to="/admin/users"
                  className="flex items-center justify-between rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-4 py-4 hover:bg-[var(--gantry-bg-tertiary)]"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--gantry-bg-primary)] text-[var(--gantry-text-secondary)]">
                      <Users className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[var(--gantry-text-primary)]">User lifecycle</p>
                      <p className="text-xs text-[var(--gantry-text-secondary)]">Provision accounts and reset credentials.</p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
                </Link>
                <Link
                  to="/admin/access"
                  className="flex items-center justify-between rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-4 py-4 hover:bg-[var(--gantry-bg-tertiary)]"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--gantry-bg-primary)] text-[var(--gantry-text-secondary)]">
                      <Lock className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[var(--gantry-text-primary)]">Role and policy changes</p>
                      <p className="text-xs text-[var(--gantry-text-secondary)]">Adjust roles, groups, and permission rules.</p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
                </Link>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-6">
              <h2 className="text-lg font-semibold text-[var(--gantry-text-primary)]">Future Settings Home</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--gantry-text-secondary)]">
                Use this space for any future non-plugin administrative settings so the sidebar stays focused and predictable.
              </p>
              <div className="mt-5 rounded-2xl border border-dashed border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-4 py-5">
                <p className="text-sm font-medium text-[var(--gantry-text-primary)]">Good candidates</p>
                <ul className="mt-3 space-y-2 text-sm text-[var(--gantry-text-secondary)]">
                  <li>Authentication and organization-wide defaults</li>
                  <li>Operational controls that are not plugin-specific</li>
                  <li>Global governance and platform policy surfaces</li>
                </ul>
              </div>
            </div>
          </section>
        </div>
      ) : (
        <section className="space-y-4">
          <div className="rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-6 py-5">
            <h2 className="text-xl font-semibold text-[var(--gantry-text-primary)]">{activeMeta.label}</h2>
            <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">{activeMeta.description}</p>
          </div>
          {renderSection(currentSection)}
        </section>
      )}
    </div>
  );
}
