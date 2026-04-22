package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/go2engle/gantry/internal/api/handlers"
	"github.com/go2engle/gantry/internal/api/middleware"
	"github.com/go2engle/gantry/internal/auth"
	"github.com/go2engle/gantry/internal/db"
	"github.com/go2engle/gantry/internal/entity"
	"github.com/go2engle/gantry/internal/events"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

type listSchemasInput struct{}

type getSchemaInput struct {
	Kind string `json:"kind" jsonschema:"entity kind, e.g. Service, API, Team, Infrastructure"`
}

type createEntityInput struct {
	Entity entity.Entity `json:"entity" jsonschema:"the entity to create; must have kind, metadata.name, and valid spec per the kind's schema (call get_schema first to learn the allowed fields)"`
}

type updateEntityInput struct {
	Entity entity.Entity `json:"entity" jsonschema:"the updated entity; must have kind, metadata.name matching an existing entity, and valid spec per the kind's schema"`
}

func registerWriteTools(srv *mcpsdk.Server, h *handlers.Handlers) {
	mcpsdk.AddTool(srv, &mcpsdk.Tool{
		Name:        "list_schemas",
		Description: "List all entity kinds with their JSON Schemas. Use this to discover what kinds of entities exist in this Gantry instance and what fields each accepts. Call this before `create_entity` or `update_entity` if you need to know the spec fields for a specific kind.",
	}, func(_ context.Context, _ *mcpsdk.CallToolRequest, _ listSchemasInput) (*mcpsdk.CallToolResult, any, error) {
		schemas := h.Validator.ListSchemas()
		return jsonResult(map[string]any{"schemas": schemas, "count": len(schemas)})
	})

	mcpsdk.AddTool(srv, &mcpsdk.Tool{
		Name:        "get_schema",
		Description: "Return the JSON Schema for a specific entity kind. Call this before `create_entity` or `update_entity` to learn which `metadata` and `spec` fields that kind accepts and what values are valid. All built-in schemas set additionalProperties:false, so unknown fields will be rejected at write time.",
	}, func(_ context.Context, _ *mcpsdk.CallToolRequest, in getSchemaInput) (*mcpsdk.CallToolResult, any, error) {
		raw, err := h.Validator.GetSchema(in.Kind)
		if err != nil {
			return nil, nil, fmt.Errorf("get schema: %w", err)
		}
		return jsonResult(map[string]any{"kind": in.Kind, "schema": raw})
	})

	mcpsdk.AddTool(srv, &mcpsdk.Tool{
		Name:        "create_entity",
		Description: "Create a new entity in the Gantry catalog. Before calling this, call `get_schema` (or `list_schemas`) to learn which `metadata` and `spec` fields the kind accepts — spec is free-form JSON and the validator rejects unknown fields. Requires developer role or higher. On success, GitOps sync is triggered automatically (if enabled) and an audit entry is written. Returns the created entity with server-set defaults (timestamps, createdBy).",
	}, func(ctx context.Context, _ *mcpsdk.CallToolRequest, in createEntityInput) (*mcpsdk.CallToolResult, any, error) {
		if err := requireDeveloperRole(ctx); err != nil {
			return nil, nil, err
		}
		if strings.EqualFold(in.Entity.Kind, "Flow") {
			return nil, nil, errors.New("Flow entities must be created via the REST API due to plugin-specific access rules")
		}

		e := in.Entity
		e.SetDefaults()

		claims := middleware.GetClaims(ctx)
		if claims != nil {
			e.Metadata.CreatedBy = claims.Username
		}

		if err := h.Validator.Validate(&e); err != nil {
			return nil, nil, fmt.Errorf("validation failed: %w", err)
		}

		if err := h.DB.CreateEntity(ctx, &e); err != nil {
			if errors.Is(err, entity.ErrEntityAlreadyExists) {
				return nil, nil, fmt.Errorf("entity %s/%s already exists in namespace %q", e.Kind, e.Metadata.Name, e.Metadata.Namespace)
			}
			return nil, nil, fmt.Errorf("create entity: %w", err)
		}

		h.Events.Publish(events.Event{
			Type: events.EntityCreated,
			Data: map[string]any{
				"kind":      e.Kind,
				"name":      e.Metadata.Name,
				"namespace": e.Metadata.Namespace,
			},
		})

		writeMCPAuditEntry(ctx, h, claims, "entity.created", &e, "", marshalEntityStateJSON(&e))

		return jsonResult(map[string]any{"entity": e, "created": true})
	})

	mcpsdk.AddTool(srv, &mcpsdk.Tool{
		Name:        "update_entity",
		Description: "Update an existing entity. Before calling this, call `get_entity` to see the current state and `get_schema` to confirm which fields are valid for the kind. Requires developer role or higher. The entity is validated before the DB write. On success, GitOps sync is triggered automatically (if enabled). Returns the updated entity.",
	}, func(ctx context.Context, _ *mcpsdk.CallToolRequest, in updateEntityInput) (*mcpsdk.CallToolResult, any, error) {
		if err := requireDeveloperRole(ctx); err != nil {
			return nil, nil, err
		}
		if strings.EqualFold(in.Entity.Kind, "Flow") {
			return nil, nil, errors.New("Flow entities must be updated via the REST API due to plugin-specific access rules")
		}

		e := in.Entity
		e.SetDefaults()

		if err := h.Validator.Validate(&e); err != nil {
			return nil, nil, fmt.Errorf("validation failed: %w", err)
		}

		ns := e.Metadata.Namespace
		if ns == "" {
			ns = entity.DefaultNamespace
		}
		var beforeState string
		if prev, err := h.DB.GetEntity(ctx, e.Kind, ns, e.Metadata.Name); err == nil {
			beforeState = marshalEntityStateJSON(prev)
		}

		if err := h.DB.UpdateEntity(ctx, &e); err != nil {
			if errors.Is(err, entity.ErrEntityNotFound) {
				return nil, nil, fmt.Errorf("entity %s/%s not found in namespace %q", e.Kind, e.Metadata.Name, ns)
			}
			return nil, nil, fmt.Errorf("update entity: %w", err)
		}

		h.Events.Publish(events.Event{
			Type: events.EntityUpdated,
			Data: map[string]any{
				"kind":      e.Kind,
				"name":      e.Metadata.Name,
				"namespace": e.Metadata.Namespace,
			},
		})

		claims := middleware.GetClaims(ctx)
		writeMCPAuditEntry(ctx, h, claims, "entity.updated", &e, beforeState, marshalEntityStateJSON(&e))

		return jsonResult(map[string]any{"entity": e, "updated": true})
	})
}

func requireDeveloperRole(ctx context.Context) error {
	role := middleware.GetEffectiveRole(ctx)
	if auth.RoleLevel(role) < auth.RoleLevel("developer") {
		return fmt.Errorf("this tool requires developer role or higher; current effective role: %q", role)
	}
	return nil
}

func writeMCPAuditEntry(ctx context.Context, h *handlers.Handlers, claims *auth.Claims, action string, e *entity.Entity, before, after string) {
	userName := ""
	userID := ""
	if claims != nil {
		userName = claims.Username
		userID = claims.UserID
	}
	_ = h.DB.CreateAuditEntry(ctx, &db.AuditEntry{
		UserID:       userID,
		UserName:     userName,
		Action:       action,
		ResourceType: e.Kind,
		ResourceName: e.Metadata.Name,
		BeforeState:  before,
		AfterState:   after,
		Source:       "mcp",
	})
}

func marshalEntityStateJSON(e *entity.Entity) string {
	b, err := json.Marshal(e)
	if err != nil {
		return ""
	}
	return string(b)
}
