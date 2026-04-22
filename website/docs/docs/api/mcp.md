---
sidebar_position: 3
title: MCP Server
description: Query Gantry from local AI agents (Claude Code, Cursor, etc.) over the Model Context Protocol.
---

# MCP Server

Gantry exposes a [Model Context Protocol](https://modelcontextprotocol.io) endpoint so local AI agents like Claude Code and Cursor can query the catalog directly — searching entities, reading service details, inspecting relationship graphs, and (with a `developer+` key) creating or updating entities — without a human context-switching to the UI.

The endpoint is served by the Gantry binary itself over HTTP, so there is **nothing to install on developer machines**. Users add a URL and an API key to their agent's MCP config and they're done.

## Endpoint

```
POST /api/v1/mcp
```

The MCP server uses the **Streamable HTTP** transport. A single URL handles protocol initialization, tool listing, and tool invocation.

Authentication uses the same [API keys](./authentication.md#api-keys) as every other Gantry API. Send the key in the `Authorization` header:

```
Authorization: Bearer gantry_<your-key>
```

The `/api/v1/mcp` route is protected by the standard authentication middleware — any authenticated Gantry user (or API key) can connect, regardless of role. The permissions of the key's user still apply to every tool call, so the tools return only data that user is allowed to see. Read and schema-discovery tools work for any authenticated key; write tools (`create_entity`, `update_entity`) require **developer role or higher**.

## Available Tools

### Read & Discovery

| Tool | Purpose |
|---|---|
| `search` | Full-text search across all entities (names, titles, descriptions, tags). Use first when you don't know which entity the user means. |
| `get_entity` | Return the full record (metadata + spec) for a specific `kind`+`name`. |
| `list_entities` | List entities, optionally filtered by `kind`, `namespace`, `owner`, or `tag`. |
| `get_graph` | Return the relationship graph (dependencies, owners, consumed/provided APIs) centered on a given entity. |
| `list_schemas` | Return every entity kind with its JSON Schema — discover what kinds exist and what each accepts. |
| `get_schema` | Return the JSON Schema for a single kind — the authoritative list of valid `metadata` and `spec` fields. |

### Write (requires `developer+`)

| Tool | Purpose |
|---|---|
| `create_entity` | Create a new entity. Validated against the kind's JSON Schema. Triggers GitOps sync and writes an audit entry (source `mcp`). |
| `update_entity` | Update an existing entity. Validated against the kind's JSON Schema. Triggers GitOps sync and writes an audit entry (source `mcp`). |

`delete_entity` and `Flow`-kind writes are **not currently exposed over MCP**; use the REST API or UI for those.

### Tool: `search`

| Input | Type | Description |
|---|---|---|
| `query` | string (required) | Full-text query string |

### Tool: `get_entity`

| Input | Type | Description |
|---|---|---|
| `kind` | string (required) | e.g. `Service`, `API`, `Team` |
| `name` | string (required) | Entity name (`metadata.name`) |
| `namespace` | string | Defaults to `default` when omitted |

### Tool: `list_entities`

| Input | Type | Description |
|---|---|---|
| `kind` | string | Optional kind filter (e.g. `Service`) |
| `namespace` | string | Optional namespace filter |
| `owner` | string | Optional owner filter (exact match on `metadata.owner`) |
| `tag` | string | Optional tag filter (exact match on entries in `metadata.tags`) |

All fields are optional — omit them to list everything.

### Tool: `get_graph`

| Input | Type | Description |
|---|---|---|
| `kind` | string (required) | Kind of the root entity |
| `name` | string (required) | Name of the root entity |
| `namespace` | string | Defaults to `default` when omitted |

### Tool: `list_schemas`

No inputs. Returns `{"schemas": {"service": {...}, "api": {...}, ...}, "count": N}` where each value is the raw JSON Schema for that kind.

### Tool: `get_schema`

| Input | Type | Description |
|---|---|---|
| `kind` | string (required) | e.g. `Service`, `API`, `Team`, `Infrastructure` |

Returns `{"kind": "Service", "schema": { ... }}`. Agents should call this (or `list_schemas`) before `create_entity` / `update_entity` — spec is free-form JSON and all built-in schemas set `additionalProperties: false`, so unknown fields are rejected at write time.

### Tool: `create_entity`

Requires **`developer` role or higher**. The key's user's role applies.

| Input | Type | Description |
|---|---|---|
| `entity` | object (required) | Full entity: `kind`, `apiVersion`, `metadata` (with at least `name`), and `spec`. Call `get_schema` for the kind first to know which fields to populate. |

Server-side on success:

- `metadata.createdBy` is set from the authenticated user (any client-supplied value is overwritten).
- `metadata.createdAt` / `updatedAt` default to now if not provided.
- The event bus publishes `entity.created`, which triggers a **GitOps commit** if GitOps is enabled.
- An audit log entry is written with `source: "mcp"`.
- Returns `{"entity": {...}, "created": true}`.

Common errors the tool will surface:

- `this tool requires developer role or higher` — key's user lacks permission
- `validation failed: …` — entity doesn't match the kind's JSON Schema
- `entity <kind>/<name> already exists in namespace "<ns>"` — duplicate
- `Flow entities must be created via the REST API …` — deliberate v1 limitation

### Tool: `update_entity`

Requires **`developer` role or higher**.

| Input | Type | Description |
|---|---|---|
| `entity` | object (required) | The updated entity. `kind` and `metadata.name` identify the target; other fields are replaced. |

Server-side on success: validates against the kind's schema, writes to DB, publishes `entity.updated` (triggering GitOps), writes an audit entry with `before` and `after` states, and returns `{"entity": {...}, "updated": true}`.

## Configuring Claude Code

Create an API key in **Settings → API Keys** (copy the full `gantry_...` value — it's only shown once), then:

```bash
export GANTRY_KEY="gantry_paste_your_key_here"

claude mcp add --transport http gantry https://gantry.example.com/api/v1/mcp \
  --header "Authorization: Bearer $GANTRY_KEY"
```

Verify the connection:

```bash
claude mcp list
```

`gantry` should appear as **connected**. If it shows an error, run `claude mcp get gantry` for details.

Start a Claude Code session and ask a question — Claude will call the Gantry tools as needed:

- "Use gantry to find services tagged `payments`."
- "What does the `checkout` service depend on, according to gantry?"
- "List the APIs owned by the `platform` team."
- "Create a new Service called `billing-api` owned by team `platform` with repo `github.com/example/billing`." *(requires a `developer`+ key)*
- "Change the owner of `billing-api` to team `data`." *(requires a `developer`+ key)*

## Configuring Other MCP Clients

Any client that supports MCP over Streamable HTTP can connect. The general shape is:

```json
{
  "mcpServers": {
    "gantry": {
      "url": "https://gantry.example.com/api/v1/mcp",
      "headers": {
        "Authorization": "Bearer gantry_<your-key>"
      }
    }
  }
}
```

Consult your client's documentation for the exact config location and schema.

## Sanity Check with curl

You don't need an agent to confirm the endpoint is healthy. Send an `initialize` request directly:

```bash
curl -i -X POST https://gantry.example.com/api/v1/mcp \
  -H "Authorization: Bearer gantry_<your-key>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-11-25",
      "capabilities": {},
      "clientInfo": {"name": "curl", "version": "1"}
    }
  }'
```

A healthy response is `200 OK` with JSON containing `"serverInfo": {"name": "gantry", ...}` and an `Mcp-Session-Id` response header.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `401 Unauthorized` | Missing or invalid `Authorization` header. Confirm the key hasn't been revoked in Settings → API Keys. |
| `404 Not Found` | The Gantry binary is an older version without MCP support, or the URL path is wrong. MCP lives at `/api/v1/mcp`, not `/mcp`. |
| `429 Too Many Requests` | The `/api/v1` rate limiter applies to MCP too. Pace tool-heavy agents. |
| Client connects but tools don't appear | Confirm the initialize response includes a `tools` capability. Some clients require a session restart after adding a new MCP server. |

## Security Notes

- MCP traffic inherits Gantry's **rate limiting** (applied to all `/api/v1` routes) and **audit logging** where relevant.
- MCP respects **RBAC**: because the route lives inside the authenticated API group, any endpoint the key can't reach via REST is also unreachable via MCP.
- Keys you hand to an agent should be **scoped to the minimum role the agent needs** — `viewer` is enough for read and schema-discovery tools; use a `developer` key only if you want the agent to create or update entities.
- Prefer **HTTPS** in production; an agent config pastes the key into `Authorization` on every request.
