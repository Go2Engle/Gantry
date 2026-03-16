package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
)

func uninstallCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "uninstall",
		Short: "Uninstall Gantry system service and remove installed files",
		Long: `Cleanly uninstall Gantry by reversing everything the install command set up:
  - Stops the running service
  - Disables and removes the service file
  - Removes the binary from /usr/local/bin
  - Optionally removes data and configuration directories

Requires root privileges (sudo).`,
		RunE: runUninstall,
	}

	cmd.Flags().Bool("purge", false, "Also remove data and configuration directories")
	cmd.Flags().Bool("yes", false, "Skip confirmation prompt")

	return cmd
}

func runUninstall(cmd *cobra.Command, args []string) error {
	// 1. Require root.
	if err := requireRoot(); err != nil {
		return err
	}

	purge, _ := cmd.Flags().GetBool("purge")
	yes, _ := cmd.Flags().GetBool("yes")

	// 2. Detect init system.
	sys := detectInitSystem()
	if sys == initUnknown {
		return fmt.Errorf("unsupported platform: gantry uninstall supports Linux (systemd) and macOS (launchd)")
	}

	// 3. Check if installed.
	info := detectService()
	if !info.IsInstalled {
		// Even if no service file, the binary may still be present.
		if _, err := os.Stat(defaultBinaryPath); os.IsNotExist(err) {
			return fmt.Errorf("gantry is not installed as a service")
		}
	}

	// 4. Confirm with user.
	fmt.Print("\n  This will uninstall Gantry:\n\n")
	if info.IsInstalled {
		fmt.Printf("    Service:  %s (%s)\n", info.ServiceName, info.InitSystem)
	}
	fmt.Printf("    Binary:   %s\n", defaultBinaryPath)
	if purge {
		fmt.Println("    Data:     /var/lib/gantry (WILL BE DELETED)")
		fmt.Println("    Config:   /etc/gantry (WILL BE DELETED)")
	} else {
		fmt.Println("    Data:     /var/lib/gantry (preserved)")
		fmt.Println("    Config:   /etc/gantry (preserved)")
	}
	fmt.Println()

	if !yes {
		fmt.Print("  Continue? [y/N] ")
		reader := bufio.NewReader(os.Stdin)
		answer, _ := reader.ReadString('\n')
		answer = strings.TrimSpace(strings.ToLower(answer))
		if answer != "y" && answer != "yes" {
			fmt.Println("  Aborted.")
			return nil
		}
		fmt.Println()
	}

	// 5. Stop service if running.
	if info.IsRunning {
		fmt.Println("  Stopping gantry service...")
		if err := stopService(info); err != nil {
			return fmt.Errorf("stopping service: %w", err)
		}
	}

	// 6. Disable and remove service file.
	if info.IsInstalled {
		if err := disableService(info); err != nil {
			return fmt.Errorf("disabling service: %w", err)
		}
		fmt.Println("  Service disabled")

		if err := os.Remove(info.UnitPath); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("removing service file: %w", err)
		}
		fmt.Printf("  Removed service file: %s\n", info.UnitPath)

		// Reload daemon after removing the unit file.
		if info.InitSystem == initSystemd {
			_ = execCmd("systemctl", "daemon-reload")
			_ = execCmd("systemctl", "reset-failed", "gantry")
		}
	}

	// 7. Remove binary.
	if err := os.Remove(defaultBinaryPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("removing binary: %w", err)
	}
	// Also remove any leftover .old file from a previous upgrade.
	os.Remove(defaultBinaryPath + ".old")
	fmt.Printf("  Removed binary: %s\n", defaultBinaryPath)

	// 8. Optionally remove data and config directories.
	if purge {
		for _, dir := range []string{"/var/lib/gantry", "/etc/gantry"} {
			if err := os.RemoveAll(dir); err != nil {
				return fmt.Errorf("removing %s: %w", dir, err)
			}
			fmt.Printf("  Removed directory: %s\n", dir)
		}

		// Remove macOS log files if applicable.
		if sys == initLaunchd {
			os.Remove("/var/log/gantry.log")
			os.Remove("/var/log/gantry.err")
		}
	}

	// 9. Print summary.
	fmt.Println()
	fmt.Println("  Gantry uninstalled successfully!")
	if !purge {
		fmt.Println()
		fmt.Println("  Data and configuration were preserved.")
		fmt.Println("  To remove them: sudo rm -rf /var/lib/gantry /etc/gantry")
	}
	fmt.Println()

	return nil
}

// disableService disables the Gantry service from starting on boot.
func disableService(info serviceInfo) error {
	switch info.InitSystem {
	case initSystemd:
		return execCmd("systemctl", "disable", "gantry")
	case initLaunchd:
		// Unloading already prevents re-launch on boot.
		return nil
	default:
		return fmt.Errorf("unsupported init system: %s", info.InitSystem)
	}
}
