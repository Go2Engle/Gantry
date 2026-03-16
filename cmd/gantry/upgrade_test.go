package main

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestCompareVersions(t *testing.T) {
	tests := []struct {
		a, b string
		want int
	}{
		{"1.0.0", "1.0.0", 0},
		{"1.0.0", "1.0.1", -1},
		{"1.0.1", "1.0.0", 1},
		{"1.1.0", "1.0.9", 1},
		{"2.0.0", "1.9.9", 1},
		{"dev", "0.1.0", -1},
		{"0.1.0", "dev", 1},
		{"dev", "dev", 0},
		{"v1.0.0", "1.0.0", 0},
		{"v1.0.0", "v1.0.1", -1},
		{"1.0.0-rc1", "1.0.0", -1}, // prerelease < release per semver
		{"0.1.0", "0.1.0", 0},
		{"0.2.0", "0.1.0", 1},
		{"1.0.0", "0.99.99", 1},
	}

	for _, tt := range tests {
		t.Run(fmt.Sprintf("%s_vs_%s", tt.a, tt.b), func(t *testing.T) {
			got := compareVersions(tt.a, tt.b)
			if got != tt.want {
				t.Errorf("compareVersions(%q, %q) = %d, want %d", tt.a, tt.b, got, tt.want)
			}
		})
	}
}

func TestVerifyChecksum(t *testing.T) {
	// Create a temp file with known content.
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "test.tar.gz")
	content := []byte("hello gantry")
	if err := os.WriteFile(testFile, content, 0644); err != nil {
		t.Fatal(err)
	}

	// Compute expected hash.
	h := sha256.Sum256(content)
	expectedHash := hex.EncodeToString(h[:])

	checksums := fmt.Sprintf("%s  test.tar.gz\nabcdef1234567890  other.tar.gz\n", expectedHash)

	// Valid checksum.
	if err := verifyChecksum(testFile, "test.tar.gz", checksums); err != nil {
		t.Errorf("expected valid checksum, got error: %v", err)
	}

	// Wrong filename.
	if err := verifyChecksum(testFile, "nonexistent.tar.gz", checksums); err == nil {
		t.Error("expected error for missing filename in checksums, got nil")
	}

	// Corrupted checksum.
	badChecksums := "0000000000000000000000000000000000000000000000000000000000000000  test.tar.gz\n"
	if err := verifyChecksum(testFile, "test.tar.gz", badChecksums); err == nil {
		t.Error("expected checksum mismatch error, got nil")
	}
}

func TestFindAsset(t *testing.T) {
	release := &githubRelease{
		TagName: "v0.2.0",
		Assets: []githubAsset{
			{Name: "gantry_0.2.0_linux_amd64.tar.gz", BrowserDownloadURL: "https://example.com/linux_amd64.tar.gz"},
			{Name: "gantry_0.2.0_darwin_arm64.tar.gz", BrowserDownloadURL: "https://example.com/darwin_arm64.tar.gz"},
			{Name: "gantry_0.2.0_windows_amd64.zip", BrowserDownloadURL: "https://example.com/windows_amd64.zip"},
			{Name: "checksums.txt", BrowserDownloadURL: "https://example.com/checksums.txt"},
		},
	}

	// Find an existing asset.
	asset, err := findAsset(release, "0.2.0")
	if err != nil {
		// This test depends on runtime.GOOS/GOARCH, so just check the function doesn't panic.
		// On most CI systems this will be linux/amd64 or darwin/arm64.
		t.Logf("findAsset returned error (expected on this OS/arch): %v", err)
	} else if asset.Name == "" {
		t.Error("expected a non-empty asset name")
	}

	// Find checksums.
	csAsset, err := findChecksumAsset(release)
	if err != nil {
		t.Errorf("expected to find checksums.txt, got error: %v", err)
	}
	if csAsset.Name != "checksums.txt" {
		t.Errorf("expected checksums.txt, got %s", csAsset.Name)
	}
}

func TestExtractBinary(t *testing.T) {
	// Create a tar.gz archive with a fake "gantry" binary.
	tmpDir := t.TempDir()
	archivePath := filepath.Join(tmpDir, "test.tar.gz")

	binaryContent := []byte("#!/bin/sh\necho gantry")

	f, err := os.Create(archivePath)
	if err != nil {
		t.Fatal(err)
	}

	gw := gzip.NewWriter(f)
	tw := tar.NewWriter(gw)

	// Add the gantry binary.
	hdr := &tar.Header{
		Name: "gantry",
		Mode: 0755,
		Size: int64(len(binaryContent)),
	}
	if err := tw.WriteHeader(hdr); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write(binaryContent); err != nil {
		t.Fatal(err)
	}

	// Add a README (should be ignored).
	readmeContent := []byte("# Gantry")
	hdr2 := &tar.Header{
		Name: "README.md",
		Mode: 0644,
		Size: int64(len(readmeContent)),
	}
	if err := tw.WriteHeader(hdr2); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write(readmeContent); err != nil {
		t.Fatal(err)
	}

	tw.Close()
	gw.Close()
	f.Close()

	// Extract.
	destDir := filepath.Join(tmpDir, "extracted")
	os.MkdirAll(destDir, 0755)

	binaryPath, err := extractFromTarGz(archivePath, destDir)
	if err != nil {
		t.Fatalf("extractFromTarGz: %v", err)
	}

	// Verify extracted binary.
	data, err := os.ReadFile(binaryPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != string(binaryContent) {
		t.Errorf("extracted binary content mismatch: got %q", string(data))
	}

	// Verify permissions.
	info, err := os.Stat(binaryPath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0755 {
		t.Errorf("expected binary permissions 0755, got %o", info.Mode().Perm())
	}
}

func TestReplaceBinary(t *testing.T) {
	tmpDir := t.TempDir()

	// Create "current" binary.
	currentPath := filepath.Join(tmpDir, "gantry")
	if err := os.WriteFile(currentPath, []byte("old binary"), 0755); err != nil {
		t.Fatal(err)
	}

	// Create "new" binary.
	newPath := filepath.Join(tmpDir, "gantry-new")
	if err := os.WriteFile(newPath, []byte("new binary"), 0755); err != nil {
		t.Fatal(err)
	}

	// Replace.
	if err := replaceBinary(currentPath, newPath); err != nil {
		t.Fatalf("replaceBinary: %v", err)
	}

	// Verify content was replaced.
	data, err := os.ReadFile(currentPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "new binary" {
		t.Errorf("expected 'new binary', got %q", string(data))
	}

	// Verify .old is preserved for rollback.
	if _, err := os.Stat(currentPath + ".old"); os.IsNotExist(err) {
		t.Error("expected .old file to be preserved for rollback")
	}
}
