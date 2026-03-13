package main

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

const githubRepo = "go2engle/gantry"

// githubRelease represents a GitHub Releases API response.
type githubRelease struct {
	TagName string        `json:"tag_name"`
	Name    string        `json:"name"`
	Assets  []githubAsset `json:"assets"`
}

// githubAsset represents a single release asset.
type githubAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

func upgradeCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "upgrade",
		Short: "Upgrade Gantry to the latest version",
		Long: `Self-update Gantry by downloading the latest release from GitHub.

Downloads the appropriate binary for your OS and architecture, verifies
the checksum, and replaces the current binary. If Gantry is running as
a system service, it will be stopped and restarted automatically.

Requires root privileges if the binary is in a system path.`,
		RunE: runUpgrade,
	}

	cmd.Flags().String("version", "", "Specific version to install (e.g., v1.2.3; default: latest)")
	cmd.Flags().Bool("force", false, "Upgrade even if already at the target version")
	cmd.Flags().Bool("no-restart", false, "Don't restart the service after upgrade")

	return cmd
}

func runUpgrade(cmd *cobra.Command, args []string) error {
	targetVersion, _ := cmd.Flags().GetString("version")
	force, _ := cmd.Flags().GetBool("force")
	noRestart, _ := cmd.Flags().GetBool("no-restart")

	fmt.Printf("  Current version: %s\n", Version)

	// 1. Fetch the target release.
	var release *githubRelease
	var err error
	if targetVersion != "" {
		// Ensure the version has a "v" prefix for the GitHub tag.
		if !strings.HasPrefix(targetVersion, "v") {
			targetVersion = "v" + targetVersion
		}
		release, err = fetchRelease(targetVersion)
	} else {
		release, err = fetchLatestRelease()
	}
	if err != nil {
		return fmt.Errorf("fetching release: %w", err)
	}

	newVersion := release.TagName
	fmt.Printf("  Target version:  %s\n\n", newVersion)

	// 2. Compare versions.
	cmp := compareVersions(Version, strings.TrimPrefix(newVersion, "v"))
	if cmp == 0 && !force {
		fmt.Printf("  Already up to date (%s)\n", Version)
		return nil
	}
	if Version == "dev" {
		fmt.Println("  Note: current version is a development build; version comparison may not be meaningful.")
	}
	if cmp > 0 && !force {
		fmt.Printf("  Warning: target version %s is older than current version %s\n", newVersion, Version)
		fmt.Println("  Use --force to downgrade.")
		return nil
	}

	// 3. Find the correct asset.
	ver := strings.TrimPrefix(newVersion, "v")
	asset, err := findAsset(release, ver)
	if err != nil {
		return err
	}

	checksumAsset, err := findChecksumAsset(release)
	if err != nil {
		return err
	}

	// 4. Download the archive and checksums.
	fmt.Printf("  Downloading %s...\n", asset.Name)
	archivePath, err := downloadFile(asset.BrowserDownloadURL)
	if err != nil {
		return fmt.Errorf("downloading archive: %w", err)
	}
	defer os.Remove(archivePath)

	checksumsPath, err := downloadFile(checksumAsset.BrowserDownloadURL)
	if err != nil {
		return fmt.Errorf("downloading checksums: %w", err)
	}
	defer os.Remove(checksumsPath)

	// 5. Verify checksum.
	checksumsData, err := os.ReadFile(checksumsPath)
	if err != nil {
		return fmt.Errorf("reading checksums: %w", err)
	}
	if err := verifyChecksum(archivePath, asset.Name, string(checksumsData)); err != nil {
		return err
	}
	fmt.Println("  Checksum verified (SHA-256)")

	// 6. Extract binary.
	tempDir, err := os.MkdirTemp("", "gantry-upgrade-*")
	if err != nil {
		return fmt.Errorf("creating temp directory: %w", err)
	}
	defer os.RemoveAll(tempDir)

	newBinaryPath, err := extractBinary(archivePath, tempDir)
	if err != nil {
		return fmt.Errorf("extracting binary: %w", err)
	}
	fmt.Println("  Extracted binary")

	// 7. Determine target path and check permissions.
	targetPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("determining current binary path: %w", err)
	}
	targetPath, err = filepath.EvalSymlinks(targetPath)
	if err != nil {
		return fmt.Errorf("resolving binary path: %w", err)
	}

	// If running as a service, prefer the standard binary path.
	svc := detectService()
	if svc.IsInstalled {
		targetPath = defaultBinaryPath
	}

	// Check if we need root for the target path.
	if err := checkWritePermission(targetPath); err != nil {
		if rootErr := requireRoot(); rootErr != nil {
			return fmt.Errorf("cannot write to %s: %w\n  (try: sudo gantry upgrade)", targetPath, rootErr)
		}
	}

	// 8. Stop service if running.
	if svc.IsRunning && !noRestart {
		fmt.Println("  Stopping gantry service...")
		if err := stopService(svc); err != nil {
			return fmt.Errorf("stopping service: %w", err)
		}
	}

	// 9. Replace the binary.
	fmt.Println("  If interrupted, restore with: mv " + targetPath + ".old " + targetPath)
	if err := replaceBinary(targetPath, newBinaryPath); err != nil {
		return fmt.Errorf("replacing binary: %w", err)
	}
	fmt.Printf("  Binary updated: %s\n", targetPath)

	// 10. Restart service if applicable.
	if svc.IsInstalled && !noRestart {
		fmt.Println("  Starting gantry service...")
		// Refresh service info after stop.
		svc = detectService()
		if err := startService(svc); err != nil {
			return fmt.Errorf("starting service: %w", err)
		}
	}

	// 11. Print success.
	fmt.Println()
	fmt.Printf("  Gantry upgraded successfully!\n")
	fmt.Printf("    %s → %s\n\n", Version, newVersion)

	return nil
}

// fetchLatestRelease fetches the latest release from GitHub.
func fetchLatestRelease() (*githubRelease, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", githubRepo)
	return fetchGitHubRelease(url)
}

// fetchRelease fetches a specific release by tag from GitHub.
func fetchRelease(tag string) (*githubRelease, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/releases/tags/%s", githubRepo, tag)
	return fetchGitHubRelease(url)
}

func fetchGitHubRelease(url string) (*githubRelease, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", fmt.Sprintf("gantry-cli/%s", Version))

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("HTTP request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("release not found (HTTP 404)")
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected HTTP status: %s", resp.Status)
	}

	var release githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, fmt.Errorf("parsing release JSON: %w", err)
	}

	return &release, nil
}

// findAsset finds the archive asset matching the current OS and architecture.
func findAsset(release *githubRelease, version string) (*githubAsset, error) {
	goos := runtime.GOOS
	goarch := runtime.GOARCH

	ext := "tar.gz"
	if goos == "windows" {
		ext = "zip"
	}

	expected := fmt.Sprintf("gantry_%s_%s_%s.%s", version, goos, goarch, ext)

	for i := range release.Assets {
		if release.Assets[i].Name == expected {
			return &release.Assets[i], nil
		}
	}

	return nil, fmt.Errorf("no release asset found for %s/%s (expected: %s)\nThis OS/architecture may not have a pre-built binary", goos, goarch, expected)
}

// findChecksumAsset finds the checksums.txt asset.
func findChecksumAsset(release *githubRelease) (*githubAsset, error) {
	for i := range release.Assets {
		if release.Assets[i].Name == "checksums.txt" {
			return &release.Assets[i], nil
		}
	}
	return nil, fmt.Errorf("checksums.txt not found in release assets")
}

// downloadFile downloads a URL to a temporary file and returns its path.
func downloadFile(url string) (string, error) {
	client := &http.Client{Timeout: 5 * time.Minute}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", fmt.Sprintf("gantry-cli/%s", Version))

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("HTTP request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download failed: HTTP %s", resp.Status)
	}

	tmp, err := os.CreateTemp("", "gantry-download-*")
	if err != nil {
		return "", err
	}
	defer tmp.Close()

	if _, err := io.Copy(tmp, resp.Body); err != nil {
		os.Remove(tmp.Name())
		return "", err
	}

	return tmp.Name(), nil
}

// verifyChecksum verifies a file's SHA-256 against the checksums.txt content.
func verifyChecksum(filePath, expectedName, checksumsContent string) error {
	// Parse checksums.txt: each line is "<sha256>  <filename>"
	var expectedHash string
	for _, line := range strings.Split(checksumsContent, "\n") {
		parts := strings.Fields(line)
		if len(parts) == 2 && parts[1] == expectedName {
			expectedHash = parts[0]
			break
		}
	}

	if expectedHash == "" {
		return fmt.Errorf("checksum not found for %s in checksums.txt", expectedName)
	}

	// Compute actual hash.
	f, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return err
	}

	actualHash := hex.EncodeToString(h.Sum(nil))
	if actualHash != expectedHash {
		return fmt.Errorf("checksum mismatch for %s:\n  expected: %s\n  got:      %s", expectedName, expectedHash, actualHash)
	}

	return nil
}

// extractBinary extracts the gantry binary from a release archive.
func extractBinary(archivePath, destDir string) (string, error) {
	if strings.HasSuffix(archivePath, ".zip") || runtime.GOOS == "windows" {
		return extractFromZip(archivePath, destDir)
	}
	return extractFromTarGz(archivePath, destDir)
}

func extractFromTarGz(archivePath, destDir string) (string, error) {
	f, err := os.Open(archivePath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	gz, err := gzip.NewReader(f)
	if err != nil {
		return "", fmt.Errorf("opening gzip reader: %w", err)
	}
	defer gz.Close()

	tr := tar.NewReader(gz)
	binaryName := "gantry"
	if runtime.GOOS == "windows" {
		binaryName = "gantry.exe"
	}

	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", fmt.Errorf("reading tar entry: %w", err)
		}

		if filepath.Base(hdr.Name) == binaryName && hdr.Typeflag == tar.TypeReg {
			destPath := filepath.Join(destDir, binaryName)
			out, err := os.OpenFile(destPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
			if err != nil {
				return "", err
			}
			if _, err := io.Copy(out, tr); err != nil {
				out.Close()
				return "", err
			}
			out.Close()
			return destPath, nil
		}
	}

	return "", fmt.Errorf("binary %q not found in archive", binaryName)
}

func extractFromZip(archivePath, destDir string) (string, error) {
	r, err := zip.OpenReader(archivePath)
	if err != nil {
		return "", err
	}
	defer r.Close()

	binaryName := "gantry"
	if runtime.GOOS == "windows" {
		binaryName = "gantry.exe"
	}

	for _, f := range r.File {
		if filepath.Base(f.Name) == binaryName {
			rc, err := f.Open()
			if err != nil {
				return "", err
			}

			destPath := filepath.Join(destDir, binaryName)
			out, err := os.OpenFile(destPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
			if err != nil {
				rc.Close()
				return "", err
			}
			if _, err := io.Copy(out, rc); err != nil {
				out.Close()
				rc.Close()
				return "", err
			}
			out.Close()
			rc.Close()
			return destPath, nil
		}
	}

	return "", fmt.Errorf("binary %q not found in archive", binaryName)
}

// replaceBinary replaces the binary at targetPath with the one at newBinaryPath.
// Uses a rename-swap strategy that is safe even for the currently running binary.
func replaceBinary(targetPath, newBinaryPath string) error {
	oldPath := targetPath + ".old"

	// Remove any leftover .old file from a previous upgrade.
	os.Remove(oldPath)

	// Rename current binary to .old (safe: OS keeps inode alive for running process).
	if err := os.Rename(targetPath, oldPath); err != nil {
		return fmt.Errorf("renaming current binary: %w", err)
	}

	// Copy new binary to target path.
	src, err := os.Open(newBinaryPath)
	if err != nil {
		// Attempt to restore.
		os.Rename(oldPath, targetPath)
		return fmt.Errorf("opening new binary: %w", err)
	}
	defer src.Close()

	dst, err := os.OpenFile(targetPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		// Attempt to restore.
		os.Rename(oldPath, targetPath)
		return fmt.Errorf("creating target binary: %w", err)
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		// Attempt to restore.
		os.Remove(targetPath)
		os.Rename(oldPath, targetPath)
		return fmt.Errorf("copying new binary: %w", err)
	}

	// Remove the old binary.
	os.Remove(oldPath)

	return nil
}

// compareVersions compares two semver strings.
// Returns -1 if a < b, 0 if a == b, 1 if a > b.
// "dev" is always considered older than any release version.
func compareVersions(a, b string) int {
	a = strings.TrimPrefix(a, "v")
	b = strings.TrimPrefix(b, "v")

	if a == b {
		return 0
	}
	if a == "dev" {
		return -1
	}
	if b == "dev" {
		return 1
	}

	aParts := strings.SplitN(a, ".", 3)
	bParts := strings.SplitN(b, ".", 3)

	for i := 0; i < 3; i++ {
		var av, bv int
		if i < len(aParts) {
			av, _ = strconv.Atoi(strings.Split(aParts[i], "-")[0]) // strip pre-release suffix
		}
		if i < len(bParts) {
			bv, _ = strconv.Atoi(strings.Split(bParts[i], "-")[0])
		}
		if av < bv {
			return -1
		}
		if av > bv {
			return 1
		}
	}

	return 0
}

// checkWritePermission checks if the current process can write to the given path.
func checkWritePermission(path string) error {
	dir := filepath.Dir(path)
	info, err := os.Stat(dir)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("%s is not a directory", dir)
	}

	// Try opening the file for writing to check actual permission.
	f, err := os.OpenFile(path, os.O_WRONLY, 0)
	if err != nil {
		return err
	}
	f.Close()
	return nil
}
