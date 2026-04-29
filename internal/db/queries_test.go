package db

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/go2engle/gantry/internal/config"
	"github.com/go2engle/gantry/internal/entity"
)

func newTestDB(t *testing.T) *DB {
	t.Helper()

	dataDir := t.TempDir()
	cfg := config.Default()
	cfg.DataDir = dataDir
	cfg.DBDSN = filepath.Join(dataDir, "gantry.db")
	database, err := New(cfg)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Fatalf("Close() error = %v", err)
		}
	})
	if err := database.Migrate(); err != nil {
		t.Fatalf("Migrate() error = %v", err)
	}
	return database
}

func TestListDocumentationForEntityUsesRelatedToAndLegacyAssociatedEntity(t *testing.T) {
	ctx := context.Background()
	database := newTestDB(t)

	for _, e := range []*entity.Entity{
		{
			Kind:       "Service",
			APIVersion: entity.DefaultAPIVersion,
			Metadata:   entity.EntityMetadata{Name: "checkout", Namespace: entity.DefaultNamespace},
			Spec:       map[string]any{},
		},
		{
			Kind:       "Documentation",
			APIVersion: entity.DefaultAPIVersion,
			Metadata:   entity.EntityMetadata{Name: "checkout-runbook", Namespace: entity.DefaultNamespace},
			Spec: map[string]any{
				"url":  "https://docs.example.com/checkout/runbook",
				"type": "runbook",
				"relatedTo": []any{
					map[string]any{"kind": "Service", "name": "checkout"},
				},
			},
		},
		{
			Kind:       "Documentation",
			APIVersion: entity.DefaultAPIVersion,
			Metadata:   entity.EntityMetadata{Name: "checkout-legacy", Namespace: entity.DefaultNamespace},
			Spec: map[string]any{
				"url":              "https://docs.example.com/checkout/legacy",
				"associatedEntity": "Service/checkout",
			},
		},
		{
			Kind:       "Documentation",
			APIVersion: entity.DefaultAPIVersion,
			Metadata:   entity.EntityMetadata{Name: "billing-runbook", Namespace: entity.DefaultNamespace},
			Spec: map[string]any{
				"url": "https://docs.example.com/billing/runbook",
				"relatedTo": []any{
					map[string]any{"kind": "Service", "name": "billing"},
				},
			},
		},
	} {
		e.SetDefaults()
		if err := database.CreateEntity(ctx, e); err != nil {
			t.Fatalf("CreateEntity(%s/%s) error = %v", e.Kind, e.Metadata.Name, err)
		}
	}

	docs, err := database.ListDocumentationForEntity(ctx, "Service", entity.DefaultNamespace, "checkout")
	if err != nil {
		t.Fatalf("ListDocumentationForEntity() error = %v", err)
	}
	if len(docs) != 2 {
		t.Fatalf("ListDocumentationForEntity() returned %d docs, want 2", len(docs))
	}
	got := map[string]bool{}
	for _, doc := range docs {
		got[doc.Metadata.Name] = true
	}
	for _, name := range []string{"checkout-runbook", "checkout-legacy"} {
		if !got[name] {
			t.Fatalf("ListDocumentationForEntity() missing %q", name)
		}
	}
}

func TestGetEntityGraphIncludesDocumentationEdges(t *testing.T) {
	ctx := context.Background()
	database := newTestDB(t)

	for _, e := range []*entity.Entity{
		{
			Kind:       "Service",
			APIVersion: entity.DefaultAPIVersion,
			Metadata:   entity.EntityMetadata{Name: "checkout", Namespace: entity.DefaultNamespace},
			Spec:       map[string]any{},
		},
		{
			Kind:       "Documentation",
			APIVersion: entity.DefaultAPIVersion,
			Metadata:   entity.EntityMetadata{Name: "checkout-runbook", Namespace: entity.DefaultNamespace},
			Spec: map[string]any{
				"url": "https://docs.example.com/checkout/runbook",
				"relatedTo": []any{
					map[string]any{"kind": "Service", "name": "checkout"},
				},
			},
		},
	} {
		e.SetDefaults()
		if err := database.CreateEntity(ctx, e); err != nil {
			t.Fatalf("CreateEntity(%s/%s) error = %v", e.Kind, e.Metadata.Name, err)
		}
	}

	graph, err := database.GetEntityGraph(ctx, "Service", entity.DefaultNamespace, "checkout")
	if err != nil {
		t.Fatalf("GetEntityGraph() error = %v", err)
	}
	found := false
	for _, edge := range graph.Edges {
		if edge.From == "Documentation/checkout-runbook" && edge.To == "Service/checkout" && edge.Relation == "documents" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("GetEntityGraph() missing documentation edge: %#v", graph.Edges)
	}
}

func TestMigrateUpgradesEntityFTSForFullEntitySearch(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	cfg := config.Default()
	cfg.DataDir = dataDir
	cfg.DBDSN = filepath.Join(dataDir, "gantry.db")

	database, err := New(cfg)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Fatalf("Close() error = %v", err)
		}
	})

	if _, err := database.Exec(`CREATE TABLE entities (
		id          TEXT PRIMARY KEY,
		kind        TEXT NOT NULL,
		api_version TEXT NOT NULL DEFAULT 'gantry.io/v1',
		name        TEXT NOT NULL,
		namespace   TEXT NOT NULL DEFAULT 'default',
		title       TEXT,
		description TEXT,
		owner       TEXT,
		tags        TEXT,
		annotations TEXT,
		labels      TEXT,
		spec        TEXT,
		created_at  TIMESTAMP,
		updated_at  TIMESTAMP,
		created_by  TEXT,
		UNIQUE(kind, namespace, name)
	)`); err != nil {
		t.Fatalf("create entities table: %v", err)
	}
	if _, err := database.Exec(`CREATE VIRTUAL TABLE entities_fts USING fts5(
		name,
		title,
		description,
		tags,
		kind,
		owner,
		content='entities',
		content_rowid='rowid'
	)`); err != nil {
		t.Fatalf("create old entities_fts: %v", err)
	}
	if _, err := database.Exec(`INSERT INTO entities (
		id, kind, api_version, name, namespace, title, description, owner,
		tags, annotations, labels, spec, created_at, updated_at, created_by
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)`,
		newUUID(),
		"Service",
		entity.DefaultAPIVersion,
		"billing",
		entity.DefaultNamespace,
		"Billing",
		"Handles invoices",
		"platform",
		`["payments"]`,
		`{"gantry.io/docs-url":"https://docs.example.com/runbooks/billing"}`,
		`{"tier":"critical"}`,
		`{"healthCheck":{"url":"https://status.example.com/billing/healthz"}}`,
		"admin",
	); err != nil {
		t.Fatalf("insert entity: %v", err)
	}

	if err := database.Migrate(); err != nil {
		t.Fatalf("Migrate() error = %v", err)
	}

	results, err := database.SearchEntities(ctx, "https://status.example.com/billing/healthz")
	if err != nil {
		t.Fatalf("SearchEntities() error = %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("SearchEntities() returned %d results, want 1", len(results))
	}
}

func TestMigrateRepairsStaleEntityFTSTriggers(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	cfg := config.Default()
	cfg.DataDir = dataDir
	cfg.DBDSN = filepath.Join(dataDir, "gantry.db")

	database, err := New(cfg)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Fatalf("Close() error = %v", err)
		}
	})

	if _, err := database.Exec(`CREATE TABLE entities (
		id          TEXT PRIMARY KEY,
		kind        TEXT NOT NULL,
		api_version TEXT NOT NULL DEFAULT 'gantry.io/v1',
		name        TEXT NOT NULL,
		namespace   TEXT NOT NULL DEFAULT 'default',
		title       TEXT,
		description TEXT,
		owner       TEXT,
		tags        TEXT,
		annotations TEXT,
		labels      TEXT,
		spec        TEXT,
		created_at  TIMESTAMP,
		updated_at  TIMESTAMP,
		created_by  TEXT,
		UNIQUE(kind, namespace, name)
	)`); err != nil {
		t.Fatalf("create entities table: %v", err)
	}
	if _, err := database.Exec(entitiesFTSTableSQL); err != nil {
		t.Fatalf("create entities_fts: %v", err)
	}
	for _, stmt := range []string{
		`CREATE TRIGGER entities_ai AFTER INSERT ON entities BEGIN SELECT 1; END`,
		`CREATE TRIGGER entities_ad AFTER DELETE ON entities BEGIN SELECT 1; END`,
		`CREATE TRIGGER entities_au AFTER UPDATE ON entities BEGIN SELECT 1; END`,
	} {
		if _, err := database.Exec(stmt); err != nil {
			t.Fatalf("create stale trigger: %v", err)
		}
	}

	if _, err := database.Exec(`INSERT INTO entities (
		id, kind, api_version, name, namespace, title, description, owner,
		tags, annotations, labels, spec, created_at, updated_at, created_by
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)`,
		newUUID(),
		"Service",
		entity.DefaultAPIVersion,
		"orders",
		entity.DefaultNamespace,
		"Orders",
		"Handles orders",
		"platform",
		`["checkout"]`,
		`{}`,
		`{}`,
		`{"healthCheck":{"url":"https://status.example.com/orders/healthz"}}`,
		"admin",
	); err != nil {
		t.Fatalf("insert entity: %v", err)
	}

	if err := database.Migrate(); err != nil {
		t.Fatalf("Migrate() error = %v", err)
	}

	results, err := database.SearchEntities(ctx, "https://status.example.com/orders/healthz")
	if err != nil {
		t.Fatalf("SearchEntities() error = %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("SearchEntities() returned %d results, want 1", len(results))
	}
}

func TestUpdateEntityByRefRepairsInvalidExistingName(t *testing.T) {
	ctx := context.Background()
	database := newTestDB(t)

	_, err := database.exec(ctx,
		`INSERT INTO entities (id, kind, api_version, name, namespace, title) VALUES (?, ?, ?, ?, ?, ?)`,
		newUUID(), "Flow", entity.DefaultAPIVersion, "Future State (Draft)", entity.DefaultNamespace, "Future State (Draft)",
	)
	if err != nil {
		t.Fatalf("insert invalid existing entity: %v", err)
	}

	repaired := &entity.Entity{
		Kind:       "Flow",
		APIVersion: entity.DefaultAPIVersion,
		Metadata: entity.EntityMetadata{
			Name:      "future-state-draft",
			Namespace: entity.DefaultNamespace,
			Title:     "Future State (Draft)",
		},
		Spec: map[string]any{},
	}
	if err := database.UpdateEntityByRef(ctx, "Flow", entity.DefaultNamespace, "Future State (Draft)", repaired); err != nil {
		t.Fatalf("UpdateEntityByRef() error = %v", err)
	}

	if _, err := database.GetEntity(ctx, "Flow", entity.DefaultNamespace, "Future State (Draft)"); err == nil {
		t.Fatalf("old invalid entity still exists")
	}
	if _, err := database.GetEntity(ctx, "Flow", entity.DefaultNamespace, "future-state-draft"); err != nil {
		t.Fatalf("repaired entity lookup failed: %v", err)
	}
}

func TestDeleteEntityRemovesInvalidExistingName(t *testing.T) {
	ctx := context.Background()
	database := newTestDB(t)

	_, err := database.exec(ctx,
		`INSERT INTO entities (id, kind, api_version, name, namespace) VALUES (?, ?, ?, ?, ?)`,
		newUUID(), "Flow", entity.DefaultAPIVersion, "Future State (Draft)", entity.DefaultNamespace,
	)
	if err != nil {
		t.Fatalf("insert invalid existing entity: %v", err)
	}

	if err := database.DeleteEntity(ctx, "Flow", entity.DefaultNamespace, "Future State (Draft)"); err != nil {
		t.Fatalf("DeleteEntity() error = %v", err)
	}
}
