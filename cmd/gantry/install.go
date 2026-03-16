package main

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/user"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"github.com/spf13/cobra"
	"golang.org/x/term"
)

func installCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "install",
		Short: "Install Gantry as a system service",
		Long: `Install Gantry as a system service (systemd on Linux, launchd on macOS).

This command performs a full setup:
  - Creates a dedicated system user and group
  - Creates data and configuration directories
  - Copies the binary to /usr/local/bin/gantry
  - Writes and enables a service file
  - Starts the service

Requires root privileges (sudo).`,
		RunE: runInstall,
	}

	cmd.Flags().Int("port", 8080, "Port for the Gantry server")
	cmd.Flags().String("data-dir", "/var/lib/gantry", "Data directory")
	cmd.Flags().String("config-dir", "/etc/gantry", "Configuration directory")
	cmd.Flags().String("user", "gantry", "System user to run the service as")
	cmd.Flags().String("group", "gantry", "System group to run the service as")
	cmd.Flags().String("admin-password-file", "", "Path to a file containing the initial admin password")
	cmd.Flags().Bool("admin-password-stdin", false, "Read the initial admin password from stdin (for piped use)")
	cmd.Flags().Bool("no-start", false, "Don't start the service after installation")

	return cmd
}

func runInstall(cmd *cobra.Command, args []string) error {
	// 1. Require root.
	if err := requireRoot(); err != nil {
		return err
	}

	// 2. Detect init system.
	sys := detectInitSystem()
	if sys == initUnknown {
		return fmt.Errorf("unsupported platform: gantry install supports Linux (systemd) and macOS (launchd)")
	}

	// 3. Check if already installed.
	info := detectService()
	if info.IsInstalled {
		return fmt.Errorf("gantry is already installed as a service at %s\nUse 'gantry upgrade' to update the binary", info.UnitPath)
	}

	// Read flags.
	port, _ := cmd.Flags().GetInt("port")
	dataDir, _ := cmd.Flags().GetString("data-dir")
	configDir, _ := cmd.Flags().GetString("config-dir")
	userName, _ := cmd.Flags().GetString("user")
	groupName, _ := cmd.Flags().GetString("group")
	adminPasswordFile, _ := cmd.Flags().GetString("admin-password-file")
	adminPasswordStdin, _ := cmd.Flags().GetBool("admin-password-stdin")
	noStart, _ := cmd.Flags().GetBool("no-start")

	adminPassword, err := readAdminPassword(adminPasswordFile, adminPasswordStdin)
	if err != nil {
		return fmt.Errorf("reading admin password: %w", err)
	}

	fmt.Print("\n  Installing Gantry as a system service...\n\n")

	// 4. Create system user and group.
	if err := createSystemUser(userName, groupName, sys); err != nil {
		return fmt.Errorf("creating system user: %w", err)
	}

	// 5. Create directories.
	if err := createDirectories(dataDir, configDir, userName, groupName); err != nil {
		return err
	}

	// 6. Write env file (for secrets).
	if err := writeEnvFile(configDir, adminPassword, userName); err != nil {
		return err
	}

	// 7. Copy binary to /usr/local/bin/gantry.
	if err := copyBinary(defaultBinaryPath); err != nil {
		return err
	}

	// 8. Render and write service file.
	tmplData := serviceTemplateData{
		User:      userName,
		Group:     groupName,
		Port:      port,
		DataDir:   dataDir,
		ConfigDir: configDir,
	}
	content, err := renderServiceFile(sys, tmplData)
	if err != nil {
		return fmt.Errorf("rendering service file: %w", err)
	}

	var unitPath string
	switch sys {
	case initSystemd:
		unitPath = systemdServicePath
	case initLaunchd:
		unitPath = launchdPlistPath
		// Write the wrapper script that sources gantry.env before exec'ing the binary.
		if err := writeLaunchScript(tmplData); err != nil {
			return fmt.Errorf("writing launch script: %w", err)
		}
	}

	if err := os.WriteFile(unitPath, []byte(content), 0644); err != nil {
		return fmt.Errorf("writing service file: %w", err)
	}
	fmt.Printf("  Created service file: %s\n", unitPath)

	// 9. Enable service.
	info = detectService() // refresh info after writing service file
	if err := enableService(info); err != nil {
		return fmt.Errorf("enabling service: %w", err)
	}
	fmt.Println("  Service enabled")

	// 10. Start service.
	if !noStart {
		if err := startService(info); err != nil {
			return fmt.Errorf("starting service: %w", err)
		}
		fmt.Println("  Service started")
	}

	// 11. Print summary.
	fmt.Println()
	fmt.Println("  Gantry installed successfully!")
	fmt.Println()
	fmt.Printf("    Binary:     %s\n", defaultBinaryPath)
	fmt.Printf("    Config:     %s/gantry.env\n", configDir)
	fmt.Printf("    Data:       %s\n", dataDir)
	fmt.Printf("    Service:    %s (%s)\n", info.ServiceName, sys)
	if noStart {
		fmt.Println("    Status:     not started (--no-start)")
		fmt.Println()
		switch sys {
		case initSystemd:
			fmt.Println("    Start with: sudo systemctl start gantry")
		case initLaunchd:
			fmt.Printf("    Start with: sudo launchctl load -w %s\n", launchdPlistPath)
		}
	} else {
		fmt.Println("    Status:     running")
		fmt.Println()
		fmt.Printf("    Open http://localhost:%d in your browser to get started.\n", port)
	}
	fmt.Println()

	return nil
}

// createDirectories creates the data and config directories with proper ownership.
func createDirectories(dataDir, configDir, userName, _ string) error {
	// Look up UID/GID (platform-aware to handle CGO_ENABLED=0 on Darwin).
	uid, gid, err := lookupUserIDs(userName)
	if err != nil {
		return err
	}

	// Create data directory.
	if err := os.MkdirAll(dataDir, 0750); err != nil {
		return fmt.Errorf("creating data directory: %w", err)
	}
	if err := os.Chown(dataDir, uid, gid); err != nil {
		return fmt.Errorf("setting ownership on data directory: %w", err)
	}
	fmt.Printf("  Created data directory: %s\n", dataDir)

	// Create config directory.
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return fmt.Errorf("creating config directory: %w", err)
	}
	fmt.Printf("  Created config directory: %s\n", configDir)

	return nil
}

// writeEnvFile writes the environment file for secrets (mode 0600),
// owned by the service user so the launchd/systemd process can read it.
// If the file already exists, the write is skipped but ownership/permissions
// are still normalized so re-running install repairs any drift.
func writeEnvFile(configDir, adminPassword, serviceUser string) error {
	envPath := filepath.Join(configDir, "gantry.env")

	// Check whether the file already exists.
	_, statErr := os.Stat(envPath)
	fileExists := statErr == nil

	if !fileExists {
		// Validate password before writing.
		if adminPassword != "" && strings.ContainsAny(adminPassword, "\r\n") {
			return fmt.Errorf("admin password must not contain newline characters")
		}
		var content string
		if adminPassword != "" {
			content = fmt.Sprintf("GANTRY_ADMIN_PASSWORD=%s\n", adminPassword)
		} else {
			content = "# Add environment variables here (e.g., GANTRY_ADMIN_PASSWORD, GANTRY_ENCRYPTION_KEY)\n"
		}
		if err := os.WriteFile(envPath, []byte(content), 0600); err != nil {
			return fmt.Errorf("writing environment file: %w", err)
		}
		fmt.Printf("  Created environment file: %s (mode 0600)\n", envPath)
	} else {
		fmt.Printf("  Environment file already exists: %s\n", envPath)
		// Normalize permissions on the existing file.
		if err := os.Chmod(envPath, 0600); err != nil {
			return fmt.Errorf("normalizing permissions on %s: %w", envPath, err)
		}
	}

	// Always normalize ownership so the service user can read the file.
	if os.Geteuid() == 0 && serviceUser != "" {
		uid, gid, err := lookupUserIDs(serviceUser)
		if err != nil {
			return fmt.Errorf("looking up service user %s for env file ownership: %w", serviceUser, err)
		}
		if err := os.Chown(envPath, uid, gid); err != nil {
			return fmt.Errorf("setting ownership on %s: %w", envPath, err)
		}
	}

	return nil
}

// readAdminPassword reads the admin password from a file, TTY prompt, or piped stdin.
// Piped stdin is only consumed when stdinAllowed is true (--admin-password-stdin flag).
// Returns empty string if no password source is available.
func readAdminPassword(filePath string, stdinAllowed bool) (string, error) {
	// 1. If --admin-password-file was provided, read from file.
	if filePath != "" {
		data, err := os.ReadFile(filePath)
		if err != nil {
			return "", fmt.Errorf("reading password file %s: %w", filePath, err)
		}
		pw := strings.TrimRight(string(data), "\r\n")
		if pw == "" {
			return "", fmt.Errorf("password file %s is empty", filePath)
		}
		return pw, nil
	}

	// 2. If stdin is a terminal, prompt interactively.
	if term.IsTerminal(int(os.Stdin.Fd())) {
		fmt.Print("  Enter initial admin password (leave empty to skip): ")
		pwBytes, err := term.ReadPassword(int(os.Stdin.Fd()))
		fmt.Println() // newline after hidden input
		if err != nil {
			return "", fmt.Errorf("reading password from terminal: %w", err)
		}
		return strings.TrimSpace(string(pwBytes)), nil
	}

	// 3. Only read from piped stdin when explicitly requested via --admin-password-stdin.
	if !stdinAllowed {
		return "", nil
	}
	scanner := bufio.NewScanner(os.Stdin)
	if scanner.Scan() {
		return strings.TrimSpace(scanner.Text()), nil
	}
	if err := scanner.Err(); err != nil {
		return "", fmt.Errorf("reading password from stdin: %w", err)
	}

	return "", nil
}

// lookupUserIDs returns the numeric UID and GID for the given user name.
// On Darwin, user.Lookup requires CGO which is disabled (CGO_ENABLED=0);
// fall back to id(1) instead, which works regardless of the directory service.
func lookupUserIDs(userName string) (uid, gid int, err error) {
	if runtime.GOOS == "darwin" {
		uidOut, err := execCmdOutput("id", "-u", userName)
		if err != nil {
			return 0, 0, fmt.Errorf("looking up UID for user %s: %w", userName, err)
		}
		uid, err = strconv.Atoi(strings.TrimSpace(uidOut))
		if err != nil {
			return 0, 0, fmt.Errorf("parsing UID %q for user %s: %w", strings.TrimSpace(uidOut), userName, err)
		}
		gidOut, err := execCmdOutput("id", "-g", userName)
		if err != nil {
			return 0, 0, fmt.Errorf("looking up GID for user %s: %w", userName, err)
		}
		gid, err = strconv.Atoi(strings.TrimSpace(gidOut))
		if err != nil {
			return 0, 0, fmt.Errorf("parsing GID %q for user %s: %w", strings.TrimSpace(gidOut), userName, err)
		}
		return uid, gid, nil
	}
	u, err := user.Lookup(userName)
	if err != nil {
		return 0, 0, fmt.Errorf("looking up user %s: %w", userName, err)
	}
	uid, err = strconv.Atoi(u.Uid)
	if err != nil {
		return 0, 0, fmt.Errorf("parsing UID %q for user %s: %w", u.Uid, userName, err)
	}
	gid, err = strconv.Atoi(u.Gid)
	if err != nil {
		return 0, 0, fmt.Errorf("parsing GID %q for user %s: %w", u.Gid, userName, err)
	}
	return uid, gid, nil
}

// copyBinary copies the current executable to the target path atomically.
// Uses a temp file + rename to avoid leaving a partial binary on failure.
func copyBinary(destPath string) error {
	srcPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("determining current binary path: %w", err)
	}
	srcPath, err = filepath.EvalSymlinks(srcPath)
	if err != nil {
		return fmt.Errorf("resolving binary symlinks: %w", err)
	}

	// Skip if already at the target location.
	if srcPath == destPath {
		fmt.Printf("  Binary already at %s\n", destPath)
		return nil
	}

	// Ensure parent directory exists.
	destDir := filepath.Dir(destPath)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return fmt.Errorf("creating binary directory: %w", err)
	}

	src, err := os.Open(srcPath)
	if err != nil {
		return fmt.Errorf("opening source binary: %w", err)
	}
	defer src.Close()

	// Write to a temp file in the same directory, then atomically rename.
	tmp, err := os.CreateTemp(destDir, ".gantry-install-*")
	if err != nil {
		return fmt.Errorf("creating temp file for binary: %w", err)
	}
	tmpPath := tmp.Name()

	if _, err := io.Copy(tmp, src); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("copying binary: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("syncing binary: %w", err)
	}
	tmp.Close()

	if err := os.Chmod(tmpPath, 0755); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("setting binary permissions: %w", err)
	}
	if err := os.Rename(tmpPath, destPath); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("installing binary: %w", err)
	}

	fmt.Printf("  Installed binary: %s\n", destPath)
	return nil
}
