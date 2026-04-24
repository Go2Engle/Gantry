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
