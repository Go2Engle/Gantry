package mcp

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/go2engle/gantry/internal/api/handlers"
	"github.com/go2engle/gantry/internal/entity"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

type searchInput struct {
	Query string `json:"query" jsonschema:"full-text query string; matches entity names, titles, descriptions, and tags"`
}

type getEntityInput struct {
	Kind      string `json:"kind" jsonschema:"entity kind, e.g. Service, API, Team, Infrastructure"`
	Name      string `json:"name" jsonschema:"entity name (metadata.name)"`
	Namespace string `json:"namespace,omitempty" jsonschema:"entity namespace; defaults to \"default\" when omitted"`
}

type listEntitiesInput struct {
	Kind      string `json:"kind,omitempty" jsonschema:"optional kind filter, e.g. Service; omit to list all kinds"`
	Namespace string `json:"namespace,omitempty" jsonschema:"optional namespace filter; omit to list across all namespaces"`
	Owner     string `json:"owner,omitempty" jsonschema:"optional owner filter (matches metadata.owner exactly)"`
	Tag       string `json:"tag,omitempty" jsonschema:"optional tag filter; returns only entities whose metadata.tags contains this value"`
}

type getGraphInput struct {
	Kind      string `json:"kind" jsonschema:"entity kind for the root of the graph"`
	Name      string `json:"name" jsonschema:"entity name for the root of the graph"`
	Namespace string `json:"namespace,omitempty" jsonschema:"entity namespace; defaults to \"default\" when omitted"`
}

func registerTools(srv *mcpsdk.Server, h *handlers.Handlers) {
	mcpsdk.AddTool(srv, &mcpsdk.Tool{
		Name:        "search",
		Description: "Full-text search across all entities in the Gantry catalog. Use this first when the user's question mentions a name, keyword, team, or topic and you don't already know which entity they mean.",
	}, func(ctx context.Context, _ *mcpsdk.CallToolRequest, in searchInput) (*mcpsdk.CallToolResult, any, error) {
		results, err := h.SearchSvc.Search(ctx, in.Query)
		if err != nil {
			return nil, nil, fmt.Errorf("search failed: %w", err)
		}
		return jsonResult(results)
	})

	mcpsdk.AddTool(srv, &mcpsdk.Tool{
		Name:        "get_entity",
		Description: "Return the full entity record (metadata, spec, owner, tags, annotations) for a specific kind+name. Use this once you know which entity the user is asking about to get details like links, description, ownership.",
	}, func(ctx context.Context, _ *mcpsdk.CallToolRequest, in getEntityInput) (*mcpsdk.CallToolResult, any, error) {
		ns := in.Namespace
		if ns == "" {
			ns = entity.DefaultNamespace
		}
		e, err := h.DB.GetEntity(ctx, in.Kind, ns, in.Name)
		if err != nil {
			if errors.Is(err, entity.ErrEntityNotFound) {
				return nil, nil, fmt.Errorf("entity %s/%s not found in namespace %q", in.Kind, in.Name, ns)
			}
			return nil, nil, fmt.Errorf("get entity failed: %w", err)
		}
		return jsonResult(e)
	})

	mcpsdk.AddTool(srv, &mcpsdk.Tool{
		Name:        "list_entities",
		Description: "List entities, optionally filtered by kind, namespace, owner, or tag. Use this to answer questions like \"what services does team X own?\" or \"show me all APIs tagged payments\".",
	}, func(ctx context.Context, _ *mcpsdk.CallToolRequest, in listEntitiesInput) (*mcpsdk.CallToolResult, any, error) {
		entities, err := h.DB.ListEntities(ctx, in.Kind, in.Namespace)
		if err != nil {
			return nil, nil, fmt.Errorf("list entities failed: %w", err)
		}
		filtered := filterEntities(entities, in.Owner, in.Tag)
		return jsonResult(filtered)
	})

	mcpsdk.AddTool(srv, &mcpsdk.Tool{
		Name:        "get_graph",
		Description: "Return the relationship graph (nodes and edges) centered on a given entity — its dependencies, owners, consumed/provided APIs, and reverse dependents. Use this to answer questions about what a service depends on or what depends on it.",
	}, func(ctx context.Context, _ *mcpsdk.CallToolRequest, in getGraphInput) (*mcpsdk.CallToolResult, any, error) {
		ns := in.Namespace
		if ns == "" {
			ns = entity.DefaultNamespace
		}
		graph, err := h.DB.GetEntityGraph(ctx, in.Kind, ns, in.Name)
		if err != nil {
			return nil, nil, fmt.Errorf("get graph failed: %w", err)
		}
		return jsonResult(graph)
	})
}

func filterEntities(entities []*entity.Entity, owner, tag string) []*entity.Entity {
	if owner == "" && tag == "" {
		if entities == nil {
			return []*entity.Entity{}
		}
		return entities
	}
	filtered := make([]*entity.Entity, 0, len(entities))
	for _, e := range entities {
		if owner != "" && e.Metadata.Owner != owner {
			continue
		}
		if tag != "" && !slices.Contains(e.Metadata.Tags, tag) {
			continue
		}
		filtered = append(filtered, e)
	}
	return filtered
}

// jsonResult wraps a value as MCP structured content. Returning the value as
// the second return lets the SDK serialize it as structured output; the
// CallToolResult is left empty so the SDK fills Content from the value.
func jsonResult(v any) (*mcpsdk.CallToolResult, any, error) {
	return nil, v, nil
}
