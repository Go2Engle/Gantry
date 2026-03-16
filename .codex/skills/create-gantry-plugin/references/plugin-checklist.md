# Gantry Plugin Checklist

Use this checklist when implementing a new plugin in the Gantry repository.

## Primary Reference

Use the `status-monitor` plugin as the complete reference implementation:

- `internal/api/handlers/status_monitor.go`
- `web/src/pages/StatusMonitor.tsx`

## Files To Create Or Modify

1. `internal/api/handlers/<plugin>.go`
   Create backend handler logic, external API calls, and caching.
2. `internal/plugins/bundled/registry.json`
   Add plugin metadata, config schema, entity panels, and action types.
3. `internal/api/server.go`
   Register plugin routes before wildcard and SPA routes.
4. `web/src/lib/types.ts`
   Add TypeScript interfaces for request and response payloads.
5. `web/src/lib/api.ts`
   Add API client methods for every frontend call.
6. `web/src/pages/<PluginPage>.tsx`
   Create the full-page UI when the plugin needs a dedicated page.
7. `web/src/App.tsx`
   Add the route for the plugin page.
8. `web/src/components/Sidebar.tsx`
   Add a conditional navigation item when the plugin exposes a page.
9. `web/src/pages/Dashboard.tsx`
   Add the widget label, default config, fetch path, and render case when the plugin exposes a dashboard widget.
10. `internal/api/handlers/dashboard.go`
    Add the widget ID to `knownWidgetIDs` when the plugin adds a dashboard widget.
11. `web/src/components/<PluginTab>.tsx`
    Create the entity detail tab when the plugin exposes entity panels.

## Backend Handler Pattern

```go
package handlers

func (h *Handlers) GetMyPluginData(w http.ResponseWriter, r *http.Request) {
    p, err := h.DB.GetPlugin(r.Context(), "my-plugin")
    if err != nil || p == nil {
        writeError(w, http.StatusNotFound, "my-plugin not installed")
        return
    }
    if !p.Enabled {
        writeError(w, http.StatusBadRequest, "my-plugin not enabled")
        return
    }

    // Read config from p.Config.
    // Perform business logic.
    // For external HTTP, create a request explicitly and set User-Agent.
    // For expensive operations, add sync.RWMutex plus TTL caching.
    writeJSON(w, http.StatusOK, result)
}
```

## Registry Entry Requirements

Every plugin entry in `internal/plugins/bundled/registry.json` must include all of these fields:

```json
{
  "name": "my-plugin",
  "title": "My Plugin",
  "description": "Short description.",
  "longDescription": "Detailed description.",
  "features": ["Feature 1", "Feature 2"],
  "version": "1.0.0",
  "author": "Gantry",
  "category": "integration|widget|action-type",
  "homepage": "https://github.com/go2engle/gantry",
  "configSchema": {
    "type": "object",
    "properties": {}
  },
  "entityPanels": [],
  "actionTypes": []
}
```

## Dashboard Widget Pattern

When the plugin adds a dashboard widget:

1. Add the widget label to `WIDGET_LABELS` in `web/src/pages/Dashboard.tsx`.
2. Add the default widget config to `DEFAULT_WIDGETS`.
3. Add state and fetch wiring in the dashboard data-loading flow.
4. Add a `case` in `renderWidget()` and return `null` when there is no data.
5. Add the widget ID to `knownWidgetIDs` in `internal/api/handlers/dashboard.go`.

## Frontend Rules

- Use only these CSS variables: `--gantry-bg-primary`, `--gantry-bg-secondary`, `--gantry-bg-tertiary`, `--gantry-text-primary`, `--gantry-text-secondary`, `--gantry-border`, `--gantry-accent`, `--gantry-accent-hover`, `--gantry-danger`.
- Use `text-[var(--gantry-bg-primary)]` on accent backgrounds, not `text-white`.
- Use Tailwind opacity like `bg-[var(--gantry-accent)]/10`, not `bg-opacity-10`.
- Import icons from `lucide-react`.
- Route all requests through the shared `api` object in `web/src/lib/api.ts`.

## Common Pitfalls

- Using undefined CSS variables makes the UI invisible or inconsistent.
- Adding new entity spec fields without checking the schema fails validation because schemas use `additionalProperties: false`.
- Omitting `User-Agent` on external HTTP requests can cause provider blocks.
- Forgetting `knownWidgetIDs` causes dashboard save failures with `unknown widget id`.
- Registering plugin routes after wildcard routes breaks the API.
- Omitting `configSchema`, `entityPanels`, or `actionTypes` in `registry.json` causes parse errors.

## Verification

Run both commands after implementation:

```bash
go build ./...
cd web && npx tsc --noEmit
```
