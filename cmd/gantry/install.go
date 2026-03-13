package main

import (
	"fmt"
	"io"
	"os"
	"os/user"
	"path/filepath"
	"strconv"

	"github.com/spf13/cobra"
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
	cmd.Flags().String("admin-password", "", "Initial admin password")
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
	adminPassword, _ := cmd.Flags().GetString("admin-password")
	noStart, _ := cmd.Flags().GetBool("no-start")

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
	if err := writeEnvFile(configDir, adminPassword); err != nil {
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
	// Look up UID/GID.
	u, err := user.Lookup(userName)
	if err != nil {
		return fmt.Errorf("looking up user %s: %w", userName, err)
	}
	uid, _ := strconv.Atoi(u.Uid)
	gid, _ := strconv.Atoi(u.Gid)

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

// writeEnvFile writes the environment file for secrets (mode 0600).
func writeEnvFile(configDir, adminPassword string) error {
	envPath := filepath.Join(configDir, "gantry.env")

	// Don't overwrite an existing env file.
	if _, err := os.Stat(envPath); err == nil {
		fmt.Printf("  Environment file already exists: %s\n", envPath)
		return nil
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

	return nil
}

// copyBinary copies the current executable to the target path.
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
	if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
		return fmt.Errorf("creating binary directory: %w", err)
	}

	src, err := os.Open(srcPath)
	if err != nil {
		return fmt.Errorf("opening source binary: %w", err)
	}
	defer src.Close()

	dst, err := os.OpenFile(destPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		return fmt.Errorf("creating destination binary: %w", err)
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src); err != nil {
		return fmt.Errorf("copying binary: %w", err)
	}

	fmt.Printf("  Installed binary: %s\n", destPath)
	return nil
}
