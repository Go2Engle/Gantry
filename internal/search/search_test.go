package search

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/go2engle/gantry/internal/config"
	"github.com/go2engle/gantry/internal/db"
	"github.com/go2engle/gantry/internal/entity"
	"github.com/go2engle/gantry/internal/search/fts"
)

func newTestDB(t *testing.T) *db.DB {
	t.Helper()

	dataDir := t.TempDir()
	cfg := config.Default()
	cfg.DataDir = dataDir
	cfg.DBDSN = filepath.Join(dataDir, "gantry.db")

	database, err := db.New(cfg)
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

func TestSearchMatchesEntityURLInMetadataAndSpec(t *testing.T) {
	ctx := context.Background()
	database := newTestDB(t)

	catalogEntity := &entity.Entity{
		Kind:       "Service",
		APIVersion: entity.DefaultAPIVersion,
		Metadata: entity.EntityMetadata{
			Name:        "checkout",
			Namespace:   entity.DefaultNamespace,
			Title:       "Checkout",
			Description: "Handles orders",
			Annotations: map[string]string{
				"gantry.io/docs-url": "https://docs.example.com/runbooks/checkout",
			},
		},
		Spec: map[string]any{
			"healthCheck": map[string]any{
				"url": "https://status.example.com/checkout/healthz?probe=ready",
			},
		},
	}
	if err := database.CreateEntity(ctx, catalogEntity); err != nil {
		t.Fatalf("CreateEntity() error = %v", err)
	}

	service := New(database.DB)
	results, err := service.Search(ctx, "https://status.example.com/checkout/healthz?probe=ready")
	if err != nil {
		t.Fatalf("Search() error = %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("Search() returned %d results, want 1", len(results))
	}
	if got := results[0].Name; got != "checkout" {
		t.Fatalf("Search() result name = %q, want checkout", got)
	}

	results, err = service.Search(ctx, "docs.example.com/runbooks/checkout")
	if err != nil {
		t.Fatalf("Search() metadata URL error = %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("Search() metadata URL returned %d results, want 1", len(results))
	}
}

func TestSanitizeFTS5NormalizesURLPunctuation(t *testing.T) {
	got := fts.SanitizeQuery("https://status.example.com/checkout/healthz?probe=ready")
	want := "https status example com checkout healthz probe ready*"
	if got != want {
		t.Fatalf("SanitizeQuery() = %q, want %q", got, want)
	}
}
