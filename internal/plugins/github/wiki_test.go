package github

import (
	"os"
	"path/filepath"
	"testing"
)

func TestListWikiPagesSortsHomeFirst(t *testing.T) {
	dir := t.TempDir()
	writeTestWikiFile(t, dir, "Install-Guide.md", "# Install")
	writeTestWikiFile(t, dir, "Home.md", "# Home")
	writeTestWikiFile(t, dir, "nested/Runbook.markdown", "# Runbook")
	writeTestWikiFile(t, dir, "notes.txt", "ignored")

	pages, err := listWikiPages(dir)
	if err != nil {
		t.Fatalf("listWikiPages returned error: %v", err)
	}
	if len(pages) != 3 {
		t.Fatalf("expected 3 markdown pages, got %d", len(pages))
	}
	if pages[0].Slug != "Home" {
		t.Fatalf("expected Home first, got %q", pages[0].Slug)
	}
	if pages[1].Title != "Install Guide" {
		t.Fatalf("expected normalized title, got %q", pages[1].Title)
	}
}

func TestSelectWikiPageFallsBackToHome(t *testing.T) {
	pages := []WikiPage{
		{Title: "Install Guide", Slug: "Install-Guide", Path: "Install-Guide.md"},
		{Title: "Home", Slug: "Home", Path: "Home.md"},
	}

	if page := selectWikiPage(pages, "Install Guide"); page.Slug != "Install-Guide" {
		t.Fatalf("expected requested page, got %q", page.Slug)
	}
	if page := selectWikiPage(pages, "../Home"); page.Slug != "Home" {
		t.Fatalf("expected unsafe slug to fall back to Home, got %q", page.Slug)
	}
}

func writeTestWikiFile(t *testing.T, root, name, content string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir test wiki file: %v", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write test wiki file: %v", err)
	}
}
