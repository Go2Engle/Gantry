import { type ComponentType } from 'react';
import { Link } from 'react-router-dom';
import {
  ClipboardList,
  Lock,
  Package,
  Shield,
  UserCog,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import AdminPluginSettings from '../components/AdminPluginSettings';
import AuditLog from './AuditLog';
import RBAC from './RBAC';
import UsersPage from './Users';

export type AdminSection = 'users' | 'access' | 'plugins' | 'audit';

interface AdminProps {
  section?: AdminSection;
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
    id: 'users',
    label: 'Users',
    description: 'Create accounts, reset passwords, and manage sign-in access.',
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
    id: 'plugins',
    label: 'Plugin Settings',
    description: 'Adjust settings for enabled plugins from one shared admin surface.',
    href: '/admin/plugins',
    icon: Package,
  },
  {
    id: 'audit',
    label: 'Audit Activity',
    description: 'Review recent changes and trace operational activity.',
    href: '/admin/audit',
    icon: ClipboardList,
  },
];

function renderSection(section: AdminSection) {
  switch (section) {
    case 'users':
      return <UsersPage embedded />;
    case 'access':
      return <RBAC embedded />;
    case 'plugins':
      return <AdminPluginSettings />;
    case 'audit':
      return <AuditLog embedded />;
    default:
      return null;
  }
}

export default function Admin({ section }: AdminProps) {
  const { user } = useAuth();
  const currentSection: AdminSection = section ?? 'users';

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
      <section className="rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-5 py-5 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--gantry-text-primary)]">Admin</h1>
          <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">
            Manage current and future Gantry settings from one place.
          </p>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {sections.map((item) => {
            const Icon = item.icon;
            const active = item.id === currentSection;
            return (
              <Link
                key={item.id}
                to={item.href}
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'border-[var(--gantry-accent)] bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]'
                    : 'border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)] hover:text-[var(--gantry-text-primary)]'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </section>

      <div>
        <h2 className="text-lg font-semibold text-[var(--gantry-text-primary)]">{activeMeta.label}</h2>
        <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">{activeMeta.description}</p>
      </div>

      {renderSection(currentSection)}
    </div>
  );
}
