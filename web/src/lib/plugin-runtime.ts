/**
 * plugin-runtime.ts — Gantry plugin extension points.
 *
 * Plugins call runtime.register(fn) with a function that receives this runtime
 * object. They use it to contribute UI panels, dashboard widgets, action types,
 * nav items, and auth providers — without touching the core codebase.
 *
 * Usage (inside a plugin bundle):
 *   export default function register(runtime) {
 *     runtime.addEntityPanel('Service', MyPanel);
 *     runtime.addWidget('my-widget', MyWidget);
 *   }
 */

import type { ComponentType } from 'react';
import { getToken } from './api';

export interface EntityPanelProps {
  kind: string;
  name: string;
  namespace: string;
}

export interface WidgetProps {
  config?: Record<string, any>;
}

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon?: ComponentType;
  /** Minimum role required to see this item */
  role?: 'viewer' | 'developer' | 'admin';
}

export interface ActionTypeDefinition {
  type: string;
  label: string;
  /** React component rendered in the action run detail view */
  OutputRenderer?: ComponentType<{ outputs: Record<string, any> }>;
}

export interface AuthProvider {
  id: string;
  label: string;
  /** Called when user clicks "Sign in with <provider>" */
  initiateLogin: () => void;
}

// ---------------------------------------------------------------------------
// Runtime registry — stores contributions from loaded plugins
// ---------------------------------------------------------------------------

/** Panels contributed by plugins, keyed by entity kind. */
const _entityPanels: Record<string, ComponentType<EntityPanelProps>[]> = {};

/** Dashboard widgets contributed by plugins, keyed by widget ID. */
const _widgets: Record<string, ComponentType<WidgetProps>> = {};

/** Nav items contributed by plugins. */
const _navItems: NavItem[] = [];

/** Action types contributed by plugins. */
const _actionTypes: Record<string, ActionTypeDefinition> = {};

/** Auth providers contributed by plugins. */
const _authProviders: AuthProvider[] = [];

// ---------------------------------------------------------------------------
// Public runtime object passed into each plugin's register() function
// ---------------------------------------------------------------------------

export const pluginRuntime = {
  /**
   * Contribute a panel component to an entity detail page.
   * @param entityKind - e.g. 'Service', 'Team'
   * @param component  - React component rendered in the entity's detail tabs
   */
  addEntityPanel(entityKind: string, component: ComponentType<EntityPanelProps>) {
    if (!_entityPanels[entityKind]) {
      _entityPanels[entityKind] = [];
    }
    _entityPanels[entityKind].push(component);
  },

  /** Contribute a dashboard widget. */
  addWidget(id: string, component: ComponentType<WidgetProps>) {
    _widgets[id] = component;
  },

  /** Contribute a sidebar nav item (subject to role check). */
  addNavItem(item: NavItem) {
    _navItems.push(item);
  },

  /** Contribute a new action type renderer. */
  addActionType(def: ActionTypeDefinition) {
    _actionTypes[def.type] = def;
  },

  /** Contribute an OAuth/SAML auth provider shown on the login page. */
  addAuthProvider(provider: AuthProvider) {
    _authProviders.push(provider);
  },
};

// ---------------------------------------------------------------------------
// Read-only accessors used by the host app
// ---------------------------------------------------------------------------

export function getEntityPanels(kind: string): ComponentType<EntityPanelProps>[] {
  return _entityPanels[kind] ?? [];
}

export function getWidget(id: string): ComponentType<WidgetProps> | undefined {
  return _widgets[id];
}

export function getNavItems(): NavItem[] {
  return [..._navItems];
}

export function getActionType(type: string): ActionTypeDefinition | undefined {
  return _actionTypes[type];
}

export function getAuthProviders(): AuthProvider[] {
  return [..._authProviders];
}

// ---------------------------------------------------------------------------
// Loader — called once on app init to dynamically import enabled plugins
// ---------------------------------------------------------------------------

/**
 * loadPlugins fetches enabled plugins from the API and dynamically imports
 * each plugin's JS bundle, calling its default export with the runtime.
 */
export async function loadPlugins(): Promise<void> {
  try {
    const token = getToken();
    const reqHeaders: Record<string, string> = {};
    if (token) reqHeaders.Authorization = `Bearer ${token}`;
    const res = await fetch('/api/v1/plugins', { headers: reqHeaders });
    if (!res.ok) return;

    const plugins: Array<{ name: string; enabled: boolean; manifest?: { bundleUrl?: string } }> =
      await res.json();

    for (const plugin of plugins) {
      if (!plugin.enabled) continue;
      const bundleUrl = plugin.manifest?.bundleUrl;
      if (!bundleUrl) continue;

      try {
        // Dynamic ES module import — plugins must expose a default export
        // that is a function accepting the runtime object.
        const mod = await import(/* @vite-ignore */ bundleUrl);
        if (typeof mod.default === 'function') {
          mod.default(pluginRuntime);
        }
      } catch (err) {
        console.warn(`[gantry] failed to load plugin "${plugin.name}":`, err);
      }
    }
  } catch (err) {
    console.warn('[gantry] plugin loader error:', err);
  }
}
