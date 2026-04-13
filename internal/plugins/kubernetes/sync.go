package kubernetes

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/go2engle/gantry/internal/entity"
)

// EntityStore is the subset of db.DB used by the sync operation.
type EntityStore interface {
	GetEntity(ctx context.Context, kind, namespace, name string) (*entity.Entity, error)
	CreateEntity(ctx context.Context, e *entity.Entity) error
	UpdateEntity(ctx context.Context, e *entity.Entity) error
}

// SyncResult summarises what happened during a sync run.
type SyncResult struct {
	Namespaces  int      `json:"namespaces"`
	Deployments int      `json:"deployments"`
	Services    int      `json:"services"`
	Created     int      `json:"created"`
	Updated     int      `json:"updated"`
	Errors      []string `json:"errors,omitempty"`
}

// Sync discovers resources from a Kubernetes cluster and upserts them as
// Gantry entities. It returns a SyncResult summarising what was done.
func Sync(ctx context.Context, config map[string]any, store EntityStore) (*SyncResult, error) {
	client, err := NewClient(config)
	if err != nil {
		return nil, err
	}

	// Parse comma-separated namespace filter into a set for O(1) lookup.
	nsAllowed := parseNamespaceFilter(config["namespace"])

	// Optional cluster display name (set by allClusterConfigs from the "name" field).
	clusterName, _ := config["clusterName"].(string)

	// Optional label selector applied to deployments and services queries.
	labelSelector, _ := config["labelSelector"].(string)

	res := &SyncResult{}

	// -----------------------------------------------------------------------
	// 1. Namespaces → Environment entities
	// -----------------------------------------------------------------------
	var nsList NamespaceList
	if err := client.get("/api/v1/namespaces", &nsList); err != nil {
		return nil, fmt.Errorf("list namespaces: %w", err)
	}
	for _, ns := range nsList.Items {
		if ns.Status.Phase != "Active" {
			continue
		}
		if len(nsAllowed) > 0 && !nsAllowed[ns.Metadata.Name] {
			continue
		}
		e := namespaceToEnvironment(ns, clusterName)
		if err := upsert(ctx, store, e, res); err != nil {
			res.Errors = append(res.Errors, fmt.Sprintf("namespace %s: %v", ns.Metadata.Name, err))
		}
		res.Namespaces++
	}

	// -----------------------------------------------------------------------
	// 2. Deployments → Service entities (per namespace)
	// -----------------------------------------------------------------------
	namespaces := namespacesToSync(nsList.Items, nsAllowed)
	for _, ns := range namespaces {
		path := fmt.Sprintf("/apis/apps/v1/namespaces/%s/deployments", ns)
		if labelSelector != "" {
			path += "?labelSelector=" + labelSelector
		}
		var depList DeploymentList
		if err := client.get(path, &depList); err != nil {
			res.Errors = append(res.Errors, fmt.Sprintf("deployments in %s: %v", ns, err))
			continue
		}
		for _, dep := range depList.Items {
			e := deploymentToService(dep, clusterName)
			if err := upsert(ctx, store, e, res); err != nil {
				res.Errors = append(res.Errors, fmt.Sprintf("deployment %s/%s: %v", ns, dep.Metadata.Name, err))
			}
			res.Deployments++
		}
	}

	// -----------------------------------------------------------------------
	// 3. Kubernetes Services → annotate / link the Service entities
	// -----------------------------------------------------------------------
	for _, ns := range namespaces {
		path := fmt.Sprintf("/api/v1/namespaces/%s/services", ns)
		if labelSelector != "" {
			path += "?labelSelector=" + labelSelector
		}
		var svcList KServiceList
		if err := client.get(path, &svcList); err != nil {
			res.Errors = append(res.Errors, fmt.Sprintf("services in %s: %v", ns, err))
			continue
		}
		for _, svc := range svcList.Items {
			// Only record services that aren't headless/kubernetes internal.
			if svc.Metadata.Name == "kubernetes" || svc.Spec.ClusterIP == "None" {
				continue
			}
			e := kserviceToInfrastructure(svc, clusterName)
			if err := upsert(ctx, store, e, res); err != nil {
				res.Errors = append(res.Errors, fmt.Sprintf("service %s/%s: %v", ns, svc.Metadata.Name, err))
			}
			res.Services++
		}
	}

	return res, nil
}

// ---------------------------------------------------------------------------
// Converters — K8s resource → Gantry entity
// ---------------------------------------------------------------------------

func namespaceToEnvironment(ns Namespace, clusterName string) *entity.Entity {
	annotations := make(map[string]string)
	annotations["kubernetes.io/kind"] = "Namespace"
	annotations["kubernetes.io/uid"] = ns.Metadata.UID
	annotations["kubernetes.io/namespace"] = ns.Metadata.Name
	annotations["kubernetes.io/phase"] = ns.Status.Phase
	if clusterName != "" {
		annotations["kubernetes.io/clusterName"] = clusterName
	}
	for k, v := range ns.Metadata.Annotations {
		if strings.HasPrefix(k, "kubectl.kubernetes.io") {
			continue
		}
		annotations[k] = v
	}

	tags := labelsToTags(ns.Metadata.Labels)

	desc := fmt.Sprintf("Kubernetes namespace %q", ns.Metadata.Name)
	if clusterName != "" {
		desc += fmt.Sprintf(" on cluster %q", clusterName)
	}
	desc += "."

	return &entity.Entity{
		Kind:       "Environment",
		APIVersion: "gantry.io/v1",
		Metadata: entity.EntityMetadata{
			Name:        ns.Metadata.Name,
			Namespace:   "default",
			Title:       ns.Metadata.Name,
			Description: desc,
			Annotations: annotations,
			Tags:        append(tags, "kubernetes"),
		},
		Spec: map[string]any{},
	}
}

func deploymentToService(dep Deployment, clusterName string) *entity.Entity {
	appName := dep.Metadata.Labels["app"]
	if appName == "" {
		appName = dep.Metadata.Name
	}

	annotations := make(map[string]string)
	annotations["kubernetes.io/kind"] = "Deployment"
	annotations["kubernetes.io/uid"] = dep.Metadata.UID
	if clusterName != "" {
		annotations["kubernetes.io/clusterName"] = clusterName
	}

	tags := labelsToTags(dep.Metadata.Labels)

	desc := fmt.Sprintf("Kubernetes Deployment %q", appName)
	if clusterName != "" {
		desc += fmt.Sprintf(" on cluster %q", clusterName)
	}
	desc += "."

	return &entity.Entity{
		Kind:       "Service",
		APIVersion: "gantry.io/v1",
		Metadata: entity.EntityMetadata{
			Name:        appName,
			Namespace:   "default",
			Title:       appName,
			Description: desc,
			Annotations: annotations,
			Tags:        append(tags, "kubernetes"),
		},
		Spec: map[string]any{
			"type":       "backend",
			"deployedIn": []any{map[string]any{"kind": "Environment", "name": dep.Metadata.Namespace}},
		},
	}
}

func kserviceToInfrastructure(svc KService, clusterName string) *entity.Entity {
	annotations := make(map[string]string)
	annotations["kubernetes.io/kind"] = "Service"
	annotations["kubernetes.io/uid"] = svc.Metadata.UID
	annotations["kubernetes.io/namespace"] = svc.Metadata.Namespace
	annotations["kubernetes.io/serviceType"] = svc.Spec.Type
	annotations["kubernetes.io/clusterIP"] = svc.Spec.ClusterIP
	if clusterName != "" {
		annotations["kubernetes.io/clusterName"] = clusterName
	}
	// Prefer spec.selector.app (the selector the Service uses to route to pods)
	// over metadata labels, since not all Services carry their own app label.
	appName := svc.Spec.Selector["app"]
	if appName == "" {
		appName = svc.Metadata.Labels["app"]
	}
	spec := map[string]any{
		"deployedIn": []any{map[string]any{"kind": "Environment", "name": svc.Metadata.Namespace}},
	}
	if appName != "" {
		spec["dependsOn"] = []any{map[string]any{"kind": "Service", "name": appName}}
	}

	desc := fmt.Sprintf("Kubernetes %s Service %q in namespace %q", svc.Spec.Type, svc.Metadata.Name, svc.Metadata.Namespace)
	if clusterName != "" {
		desc += fmt.Sprintf(" on cluster %q", clusterName)
	}
	desc += "."

	return &entity.Entity{
		Kind:       "Infrastructure",
		APIVersion: "gantry.io/v1",
		Metadata: entity.EntityMetadata{
			Name:        svc.Metadata.Name + "-svc",
			Namespace:   "default",
			Title:       svc.Metadata.Name,
			Description: desc,
			Annotations: annotations,
			Tags:        []string{"kubernetes", "k8s-service"},
		},
		Spec: spec,
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func upsert(ctx context.Context, store EntityStore, e *entity.Entity, res *SyncResult) error {
	existing, err := store.GetEntity(ctx, e.Kind, e.Metadata.Namespace, e.Metadata.Name)
	if err != nil && !errors.Is(err, entity.ErrEntityNotFound) {
		return fmt.Errorf("get entity: %w", err)
	}
	if existing == nil {
		e.Metadata.CreatedBy = "kubernetes-plugin"
		e.Metadata.CreatedAt = time.Now().UTC()
		if err := store.CreateEntity(ctx, e); err != nil {
			return fmt.Errorf("create entity: %w", err)
		}
		res.Created++
		return nil
	}

	// Preserve user-set fields, only overwrite kubernetes-sourced ones.
	existing.Metadata.Annotations = mergeAnnotations(existing.Metadata.Annotations, e.Metadata.Annotations)
	existing.Metadata.Tags = mergeTags(existing.Metadata.Tags, e.Metadata.Tags)
	existing.Spec = mergeSpec(existing.Spec, e.Spec)
	if err := store.UpdateEntity(ctx, existing); err != nil {
		// If UpdateEntity returns ErrEntityNotFound we should CreateEntity.
		if errors.Is(err, entity.ErrEntityNotFound) {
			return store.CreateEntity(ctx, e)
		}
		return fmt.Errorf("update entity: %w", err)
	}
	res.Updated++
	return nil
}

func namespacesToSync(items []Namespace, allowed map[string]bool) []string {
	var names []string
	for _, ns := range items {
		if ns.Status.Phase != "Active" {
			continue
		}
		if len(allowed) > 0 && !allowed[ns.Metadata.Name] {
			continue
		}
		names = append(names, ns.Metadata.Name)
	}
	return names
}

// parseNamespaceFilter splits a comma-separated namespace string into a set.
// Returns nil (no filter) if the value is empty or not a string.
func parseNamespaceFilter(v any) map[string]bool {
	s, _ := v.(string)
	if s == "" {
		return nil
	}
	set := make(map[string]bool)
	for _, ns := range strings.Split(s, ",") {
		if ns = strings.TrimSpace(ns); ns != "" {
			set[ns] = true
		}
	}
	return set
}

func labelsToTags(labels map[string]string) []string {
	var tags []string
	if app, ok := labels["app"]; ok {
		tags = append(tags, app)
	}
	if app, ok := labels["app.kubernetes.io/name"]; ok && app != "" {
		if !containsStr(tags, app) {
			tags = append(tags, app)
		}
	}
	return tags
}

// mergeSpec merges incoming spec fields into existing, with special handling
// for "deployedIn" so environment references accumulate across syncs.
func mergeSpec(existing, incoming map[string]any) map[string]any {
	if existing == nil {
		return incoming
	}
	result := make(map[string]any, len(existing))
	for k, v := range existing {
		result[k] = v
	}
	for k, v := range incoming {
		if k == "deployedIn" {
			result[k] = mergeDeployedIn(existing[k], v)
		} else {
			result[k] = v
		}
	}
	return result
}

// mergeDeployedIn deduplicates {kind, name} references from two deployedIn lists.
func mergeDeployedIn(existing, incoming any) []any {
	seen := make(map[string]bool)
	var result []any
	for _, list := range []any{existing, incoming} {
		items, ok := list.([]any)
		if !ok {
			continue
		}
		for _, item := range items {
			m, ok := item.(map[string]any)
			if !ok {
				continue
			}
			key := fmt.Sprintf("%s/%s", m["kind"], m["name"])
			if !seen[key] {
				seen[key] = true
				result = append(result, item)
			}
		}
	}
	return result
}

func mergeAnnotations(existing, incoming map[string]string) map[string]string {
	if existing == nil {
		return incoming
	}
	for k, v := range incoming {
		// Accumulate cluster names rather than overwriting.
		if k == "kubernetes.io/clusterName" {
			existing = mergeClusterName(existing, v)
			continue
		}
		existing[k] = v
	}
	return existing
}

// mergeClusterName adds a cluster name to the accumulated kubernetes.io/clusters
// annotation (comma-separated) and keeps kubernetes.io/clusterName in sync.
func mergeClusterName(annotations map[string]string, newCluster string) map[string]string {
	existing := annotations["kubernetes.io/clusters"]
	seen := make(map[string]bool)
	var parts []string
	for _, c := range strings.Split(existing, ",") {
		c = strings.TrimSpace(c)
		if c != "" && !seen[c] {
			seen[c] = true
			parts = append(parts, c)
		}
	}
	if !seen[newCluster] {
		parts = append(parts, newCluster)
	}
	annotations["kubernetes.io/clusters"] = strings.Join(parts, ", ")
	annotations["kubernetes.io/clusterName"] = parts[0] // keep for legacy compat
	return annotations
}

func mergeTags(existing, incoming []string) []string {
	seen := make(map[string]bool, len(existing))
	for _, t := range existing {
		seen[t] = true
	}
	for _, t := range incoming {
		if !seen[t] {
			existing = append(existing, t)
		}
	}
	return existing
}

func containsStr(slice []string, s string) bool {
	for _, v := range slice {
		if v == s {
			return true
		}
	}
	return false
}
