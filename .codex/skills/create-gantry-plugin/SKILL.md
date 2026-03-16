---
name: create-gantry-plugin
description: Create new Gantry plugins end to end across the Go backend, bundled plugin registry, API routes, typed API client, React pages, sidebar navigation, dashboard widgets, and entity tabs. Use when Codex is asked to add or scaffold a Gantry plugin, wire a new plugin feature through the stack, or turn a plugin idea or spec into working code in this repository.
---

# Create Gantry Plugin

Implement Gantry plugins by following the repo's existing full-stack pattern. Use the `status-monitor` plugin as the primary reference and keep the plugin aligned with the bundled registry, route ordering, typed API client, sidebar, dashboard, and optional entity tabs.

## Workflow

1. Classify the requested plugin surface.
   Decide whether the plugin needs a full page, entity tab, dashboard widget, action type, or a combination.
2. Inspect the closest existing implementation before editing.
   Use `internal/api/handlers/status_monitor.go` and `web/src/pages/StatusMonitor.tsx` as the default reference pair.
3. Read [plugin-checklist.md](references/plugin-checklist.md) and map the required files.
   Treat the 11-file list as the default checklist and skip only files that are genuinely out of scope.
4. Implement the backend first.
   Add the handler, read plugin config, enforce installed-and-enabled checks, and register routes before wildcard or SPA routes.
5. Implement metadata and typed client support.
   Update the bundled registry entry, TypeScript types, and `web/src/lib/api.ts`.
6. Implement frontend surfaces only when needed.
   Add routes, sidebar entries, dashboard widgets, and entity tabs only for the surfaces the plugin actually exposes.
7. Verify the result.
   Run `go build ./...` and `cd web && npx tsc --noEmit` before finishing.

## Implementation Rules

- Keep handlers as methods on `handlers.Handlers`.
- Use `writeJSON` and `writeError` helpers for responses.
- For outbound HTTP, build requests explicitly and set a `User-Agent`.
- Cache expensive remote calls with `sync.RWMutex` plus TTL when the plugin needs it.
- Update `internal/api/handlers/dashboard.go` whenever a new dashboard widget ID is introduced.
- Route all frontend requests through the shared `api` object in `web/src/lib/api.ts`.
- Use only the documented `--gantry-*` CSS variables and the repo's accent-text pattern.
- Check entity schemas before introducing new spec fields because schemas use `additionalProperties: false`.

## Reference

Read [plugin-checklist.md](references/plugin-checklist.md) for the full file checklist, handler pattern, registry shape, dashboard widget steps, frontend constraints, common pitfalls, and verification commands.
