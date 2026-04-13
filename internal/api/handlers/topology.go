package handlers

import (
	"net/http"
	"sync"
	"time"
)

// TopologyNode represents an entity in the topology view.
type TopologyNode struct {
	ID          string         `json:"id"` // "Kind/name"
	Kind        string         `json:"kind"`
	Name        string         `json:"name"`
	Namespace   string         `json:"namespace,omitempty"`
	Title       string         `json:"title,omitempty"`
	Description string         `json:"description,omitempty"`
	Owner       string         `json:"owner,omitempty"`
	Spec        map[string]any `json:"spec,omitempty"`
}

// TopologyEdge represents a relationship in the topology view.
type TopologyEdge struct {
	From     string `json:"from"`
	To       string `json:"to"`
	Relation string `json:"relation"` // "dependsOn", "deployedIn", "providesApi", "consumesApi", "ownedBy"
}

// TopologyEnvironment is an environment with aggregated entity counts.
type TopologyEnvironment struct {
	Name        string `json:"name"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	Provider    string `json:"provider,omitempty"`
	Region      string `json:"region,omitempty"`
	Type        string `json:"type,omitempty"` // staging, production, development
	EntityCount int    `json:"entityCount"`
}

// TopologyData is the full topology response.
type TopologyData struct {
	Environments []TopologyEnvironment `json:"environments"`
	Nodes        []TopologyNode        `json:"nodes"`
	Edges        []TopologyEdge        `json:"edges"`
}

// In-memory cache for topology data.
var (
	topoCacheMu   sync.RWMutex
	topoCacheData *TopologyData
	topoCacheTime time.Time
)

// GetTopologyData handles GET /api/v1/plugins/topology-explorer/data.
// Returns all environments and all entities with their relationships.
// Optional query param ?environment=name filters to a single environment.
func (h *Handlers) GetTopologyData(w http.ResponseWriter, r *http.Request) {
	p, err := h.DB.GetPlugin(r.Context(), "topology-explorer")
	if err != nil || p == nil {
		writeError(w, http.StatusNotFound, "topology-explorer plugin not installed")
		return
	}
	if !p.Enabled {
		writeError(w, http.StatusBadRequest, "topology-explorer plugin is not enabled")
		return
	}

	envFilter := r.URL.Query().Get("environment")

	// Check cache (30s TTL) only if no filter is applied.
	if envFilter == "" {
		topoCacheMu.RLock()
		if time.Since(topoCacheTime) < 30*time.Second && topoCacheData != nil {
			data := topoCacheData
			topoCacheMu.RUnlock()
			writeJSON(w, http.StatusOK, data)
			return
		}
		topoCacheMu.RUnlock()
	}

	// Fetch all entities.
	all, err := h.DB.ListEntities(r.Context(), "", "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list entities")
		return
	}

	envMap := make(map[string]*TopologyEnvironment)
	var nodes []TopologyNode
	var edges []TopologyEdge

	// First pass: collect Environment entities.
	for _, e := range all {
		if e.Kind != "Environment" {
			continue
		}
		spec := e.Spec
		if spec == nil {
			spec = map[string]any{}
		}
		provider, _ := spec["provider"].(string)
		region, _ := spec["region"].(string)
		envType, _ := spec["type"].(string)
		envMap[e.Metadata.Name] = &TopologyEnvironment{
			Name:        e.Metadata.Name,
			Title:       e.Metadata.Title,
			Description: e.Metadata.Description,
			Provider:    provider,
			Region:      region,
			Type:        envType,
		}
	}

	// If filtering by environment and it doesn't exist, return empty result.
	if envFilter != "" {
		if _, ok := envMap[envFilter]; !ok {
			writeJSON(w, http.StatusOK, TopologyData{
				Environments: []TopologyEnvironment{},
				Nodes:        []TopologyNode{},
				Edges:        []TopologyEdge{},
			})
			return
		}
	}

	// Second pass: collect all non-Environment entities and build edges.
	for _, e := range all {
		nodeID := e.Kind + "/" + e.Metadata.Name
		spec := e.Spec
		if spec == nil {
			spec = map[string]any{}
		}

		// For Environment entities, add as node but skip relationship extraction for deployment.
		if e.Kind == "Environment" {
			if envFilter == "" || e.Metadata.Name == envFilter {
				nodes = append(nodes, TopologyNode{
					ID:          nodeID,
					Kind:        e.Kind,
					Name:        e.Metadata.Name,
					Namespace:   e.Metadata.Namespace,
					Title:       e.Metadata.Title,
					Description: e.Metadata.Description,
					Owner:       e.Metadata.Owner,
				})
			}
			// Extract dependsOn for environments.
			extractDependsOn(spec, nodeID, &edges)
			continue
		}

		// Reclassify Kubernetes Ingress resources as API entities in the
		// topology view — an Ingress exposes an API endpoint, not generic
		// infrastructure.
		displayKind := e.Kind
		if e.Kind == "Infrastructure" && e.Metadata.Annotations["kubernetes.io/kind"] == "Ingress" {
			displayKind = "API"
		}

		// Determine which environments this entity is deployed in.
		deployedEnvs := extractDeployedIn(spec)

		// If filtering by environment, skip entities not deployed there.
		if envFilter != "" {
			found := false
			for _, env := range deployedEnvs {
				if env == envFilter {
					found = true
					break
				}
			}
			if !found {
				continue
			}
		}

		nodes = append(nodes, TopologyNode{
			ID:          nodeID,
			Kind:        displayKind,
			Name:        e.Metadata.Name,
			Namespace:   e.Metadata.Namespace,
			Title:       e.Metadata.Title,
			Description: e.Metadata.Description,
			Owner:       e.Metadata.Owner,
		})

		// Build edges: deployedIn.
		for _, envName := range deployedEnvs {
			if env, ok := envMap[envName]; ok {
				env.EntityCount++
			}
			edges = append(edges, TopologyEdge{
				From:     nodeID,
				To:       "Environment/" + envName,
				Relation: "deployedIn",
			})
		}

		// Build edges: dependsOn.
		extractDependsOn(spec, nodeID, &edges)

		// Build edges: providesApis.
		if raw, ok := spec["providesApis"]; ok {
			if apis, ok := raw.([]any); ok {
				for _, a := range apis {
					apiName, _ := a.(string)
					if apiName != "" {
						edges = append(edges, TopologyEdge{From: nodeID, To: "API/" + apiName, Relation: "providesApi"})
					}
				}
			}
		}

		// Build edges: consumesApis.
		if raw, ok := spec["consumesApis"]; ok {
			if apis, ok := raw.([]any); ok {
				for _, a := range apis {
					apiName, _ := a.(string)
					if apiName != "" {
						edges = append(edges, TopologyEdge{From: nodeID, To: "API/" + apiName, Relation: "consumesApi"})
					}
				}
			}
		}

		// Build edges: ownedBy.
		if e.Metadata.Owner != "" {
			edges = append(edges, TopologyEdge{From: nodeID, To: "Team/" + e.Metadata.Owner, Relation: "ownedBy"})
		}
	}

	// Build environment list.
	var environments []TopologyEnvironment
	if envFilter != "" {
		if env, ok := envMap[envFilter]; ok {
			environments = append(environments, *env)
		}
	} else {
		for _, env := range envMap {
			environments = append(environments, *env)
		}
	}

	if nodes == nil {
		nodes = []TopologyNode{}
	}
	if edges == nil {
		edges = []TopologyEdge{}
	}
	if environments == nil {
		environments = []TopologyEnvironment{}
	}

	result := &TopologyData{
		Environments: environments,
		Nodes:        nodes,
		Edges:        edges,
	}

	// Cache the unfiltered result.
	if envFilter == "" {
		topoCacheMu.Lock()
		topoCacheData = result
		topoCacheTime = time.Now()
		topoCacheMu.Unlock()
	}

	writeJSON(w, http.StatusOK, result)
}

// GetTopologyStatus handles GET /api/v1/plugins/topology-explorer/status.
// Aggregates health status from status-monitor plugin for entity overlay.
func (h *Handlers) GetTopologyStatus(w http.ResponseWriter, r *http.Request) {
	p, err := h.DB.GetPlugin(r.Context(), "topology-explorer")
	if err != nil || p == nil {
		writeError(w, http.StatusNotFound, "topology-explorer plugin not installed")
		return
	}
	if !p.Enabled {
		writeError(w, http.StatusBadRequest, "topology-explorer plugin is not enabled")
		return
	}

	// Check if status-monitor is enabled; if so, return its data.
	sm, err := h.DB.GetPlugin(r.Context(), "status-monitor")
	if err != nil || sm == nil || !sm.Enabled {
		writeJSON(w, http.StatusOK, map[string]any{})
		return
	}

	// Return cached status-monitor results keyed by provider name.
	smCacheMu.RLock()
	results := smCacheResults
	smCacheMu.RUnlock()

	statusMap := make(map[string]map[string]string, len(results))
	for _, r := range results {
		statusMap[r.Name] = map[string]string{
			"status":      r.Status,
			"description": r.Description,
		}
	}

	writeJSON(w, http.StatusOK, statusMap)
}

// extractDeployedIn reads spec.deployedIn and returns environment names.
func extractDeployedIn(spec map[string]any) []string {
	raw, ok := spec["deployedIn"]
	if !ok {
		return nil
	}
	envs, ok := raw.([]any)
	if !ok {
		return nil
	}
	var names []string
	for _, env := range envs {
		if m, ok := env.(map[string]any); ok {
			envName, _ := m["name"].(string)
			if envName != "" {
				names = append(names, envName)
			}
		}
	}
	return names
}

// extractDependsOn reads spec.dependsOn and appends edges.
func extractDependsOn(spec map[string]any, fromID string, edges *[]TopologyEdge) {
	raw, ok := spec["dependsOn"]
	if !ok {
		return
	}
	deps, ok := raw.([]any)
	if !ok {
		return
	}
	for _, d := range deps {
		if m, ok := d.(map[string]any); ok {
			depKind, _ := m["kind"].(string)
			depName, _ := m["name"].(string)
			if depKind != "" && depName != "" {
				*edges = append(*edges, TopologyEdge{From: fromID, To: depKind + "/" + depName, Relation: "dependsOn"})
			}
		}
	}
}
