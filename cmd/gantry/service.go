package main

import (
	"bytes"
	"fmt"
	htmltemplate "html/template"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"text/template"
)

// initSystem represents the detected init system.
type initSystem int

const (
	initUnknown initSystem = iota
	initSystemd
	initLaunchd
)

func (s initSystem) String() string {
	switch s {
	case initSystemd:
		return "systemd"
	case initLaunchd:
		return "launchd"
	default:
		return "unknown"
	}
}

// serviceInfo holds the results of service detection.
type serviceInfo struct {
	InitSystem  initSystem
	ServiceName string // "gantry" for systemd, "com.gantry.server" for launchd
	UnitPath    string // path to service unit file
	IsInstalled bool   // whether the service file exists
	IsRunning   bool   // whether the service is currently running
}

// serviceTemplateData holds the data used to render service file templates.
type serviceTemplateData struct {
	User      string
	Group     string
	Port      int
	DataDir   string
	ConfigDir string
}

const systemdServicePath = "/etc/systemd/system/gantry.service"
const launchdPlistPath = "/Library/LaunchDaemons/com.gantry.server.plist"
const defaultBinaryPath = "/usr/local/bin/gantry"

// launchdLaunchScript is the wrapper that loads gantry.env before exec'ing the binary.
// Reads KEY=VALUE pairs line-by-line without shell evaluation to prevent injection.
// ConfigDir and DataDir are POSIX-single-quote-escaped via the sq template function.
const launchdLaunchScript = `#!/bin/sh
# Load environment variables (secrets, config overrides) safely.
# Each line must be KEY=VALUE; comments and blanks are skipped.
ENV_FILE={{sq .ConfigDir}}/gantry.env
if [ -f "$ENV_FILE" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
        # Skip empty lines and comments.
        case "$line" in
            ''|\#*) continue ;;
        esac
        # Split on first '='.
        key="${line%%=*}"
        value="${line#*=}"
        # Validate key is a shell-safe variable name.
        case "$key" in
            *[!A-Za-z0-9_]*) continue ;;
        esac
        # Strip optional surrounding quotes from value.
        case "$value" in
            \'*\'|\"*\") value="${value#?}"; value="${value%?}" ;;
        esac
        export "$key=$value"
    done < "$ENV_FILE"
fi
exec /usr/local/bin/gantry serve --port {{.Port}} --db {{sq .DataDir}}/gantry.db
`

// singleQuoteEscape wraps s in POSIX single quotes, escaping any embedded single
// quotes so the result is safe to use as a shell word in sh scripts.
func singleQuoteEscape(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

// writeLaunchScript renders and writes the gantry-launch.sh wrapper for launchd.
func writeLaunchScript(data serviceTemplateData) error {
	funcMap := template.FuncMap{"sq": singleQuoteEscape}
	tmpl, err := template.New("launch-script").Funcs(funcMap).Parse(launchdLaunchScript)
	if err != nil {
		return fmt.Errorf("parsing launch script template: %w", err)
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return fmt.Errorf("rendering launch script: %w", err)
	}
	scriptPath := data.ConfigDir + "/gantry-launch.sh"
	if err := os.WriteFile(scriptPath, buf.Bytes(), 0755); err != nil {
		return fmt.Errorf("writing launch script: %w", err)
	}
	fmt.Printf("  Created launch script: %s\n", scriptPath)
	return nil
}

// systemd unit template
const systemdTemplate = `[Unit]
Description=Gantry Internal Developer Platform
Documentation=https://github.com/go2engle/gantry
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User={{.User}}
Group={{.Group}}
ExecStart=/usr/local/bin/gantry serve --port {{.Port}} --db "{{.DataDir}}/gantry.db"
WorkingDirectory={{.DataDir}}
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

Environment="GANTRY_DATA_DIR={{.DataDir}}"
EnvironmentFile=-{{.ConfigDir}}/gantry.env

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths="{{.DataDir}}"
ReadOnlyPaths="{{.ConfigDir}}"
PrivateTmp=true

[Install]
WantedBy=multi-user.target
`

// launchd plist template — uses a wrapper script that sources gantry.env
const launchdTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.gantry.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>{{.ConfigDir}}/gantry-launch.sh</string>
    </array>
    <key>UserName</key>
    <string>{{.User}}</string>
    <key>GroupName</key>
    <string>{{.Group}}</string>
    <key>WorkingDirectory</key>
    <string>{{.DataDir}}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>GANTRY_DATA_DIR</key>
        <string>{{.DataDir}}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/var/log/gantry.log</string>
    <key>StandardErrorPath</key>
    <string>/var/log/gantry.err</string>
</dict>
</plist>
`

// detectInitSystem returns the init system for the current OS.
func detectInitSystem() initSystem {
	switch runtime.GOOS {
	case "linux":
		// Check if systemd is running as PID 1.
		if _, err := os.Stat("/run/systemd/system"); err == nil {
			return initSystemd
		}
		return initUnknown
	case "darwin":
		return initLaunchd
	default:
		return initUnknown
	}
}

// detectService probes the system for an installed Gantry service.
func detectService() serviceInfo {
	sys := detectInitSystem()
	info := serviceInfo{InitSystem: sys}

	switch sys {
	case initSystemd:
		info.ServiceName = "gantry"
		info.UnitPath = systemdServicePath
		if _, err := os.Stat(systemdServicePath); err == nil {
			info.IsInstalled = true
		}
		out, err := execCmdOutput("systemctl", "is-active", "gantry")
		if err == nil && strings.TrimSpace(out) == "active" {
			info.IsRunning = true
		}
	case initLaunchd:
		info.ServiceName = "com.gantry.server"
		info.UnitPath = launchdPlistPath
		if _, err := os.Stat(launchdPlistPath); err == nil {
			info.IsInstalled = true
		}
		out, err := execCmdOutput("launchctl", "list", "com.gantry.server")
		if err == nil && out != "" {
			info.IsRunning = true
		}
	}

	return info
}

// requireRoot checks that the current process is running as root.
func requireRoot() error {
	if os.Geteuid() != 0 {
		cmdHint := "<command>"
		if len(os.Args) > 1 {
			cmdHint = os.Args[1]
		}
		return fmt.Errorf("this command must be run as root (try: sudo gantry %s)", cmdHint)
	}
	return nil
}

// createSystemUser creates the system user and group for the Gantry service.
// It is idempotent — existing users/groups are skipped.
func createSystemUser(user, group string, sys initSystem) error {
	switch sys {
	case initSystemd:
		return createSystemUserLinux(user, group)
	case initLaunchd:
		return createSystemUserDarwin(user, group)
	default:
		return fmt.Errorf("unsupported init system: %s", sys)
	}
}

func createSystemUserLinux(user, group string) error {
	// Create group if it doesn't exist.
	if err := exec.Command("getent", "group", group).Run(); err != nil {
		if err := execCmd("groupadd", "--system", group); err != nil {
			return fmt.Errorf("creating group %s: %w", group, err)
		}
		fmt.Printf("  Created system group: %s\n", group)
	} else {
		fmt.Printf("  System group already exists: %s\n", group)
	}

	// Create user if it doesn't exist.
	if err := exec.Command("id", user).Run(); err != nil {
		if err := execCmd("useradd", "--system", "--gid", group, "--no-create-home", "--shell", "/usr/sbin/nologin", user); err != nil {
			return fmt.Errorf("creating user %s: %w", user, err)
		}
		fmt.Printf("  Created system user: %s\n", user)
	} else {
		fmt.Printf("  System user already exists: %s\n", user)
	}

	return nil
}

func createSystemUserDarwin(user, group string) error {
	// Check if group exists.
	if err := exec.Command("dscl", ".", "-read", "/Groups/"+group).Run(); err != nil {
		// Find an unused GID in the system range (300-399).
		gid, err := findUnusedDarwinID("Groups", "PrimaryGroupID", 300, 399)
		if err != nil {
			return fmt.Errorf("finding unused GID: %w", err)
		}
		cmds := [][]string{
			{"dscl", ".", "-create", "/Groups/" + group},
			{"dscl", ".", "-create", "/Groups/" + group, "PrimaryGroupID", fmt.Sprintf("%d", gid)},
		}
		for _, c := range cmds {
			if err := execCmd(c[0], c[1:]...); err != nil {
				return fmt.Errorf("creating group %s: %w", group, err)
			}
		}
		fmt.Printf("  Created system group: %s (gid %d)\n", group, gid)
	} else {
		fmt.Printf("  System group already exists: %s\n", group)
	}

	// Check if user exists.
	if err := exec.Command("id", user).Run(); err != nil {
		// Find an unused UID in the system range (300-399).
		uid, err := findUnusedDarwinID("Users", "UniqueID", 300, 399)
		if err != nil {
			return fmt.Errorf("finding unused UID: %w", err)
		}
		// Get group GID.
		gidOut, err := execCmdOutput("dscl", ".", "-read", "/Groups/"+group, "PrimaryGroupID")
		if err != nil {
			return fmt.Errorf("reading group GID: %w", err)
		}
		gid := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(gidOut), "PrimaryGroupID:"))

		cmds := [][]string{
			{"dscl", ".", "-create", "/Users/" + user},
			{"dscl", ".", "-create", "/Users/" + user, "UserShell", "/usr/bin/false"},
			{"dscl", ".", "-create", "/Users/" + user, "UniqueID", fmt.Sprintf("%d", uid)},
			{"dscl", ".", "-create", "/Users/" + user, "PrimaryGroupID", gid},
			{"dscl", ".", "-create", "/Users/" + user, "NFSHomeDirectory", "/var/empty"},
		}
		for _, c := range cmds {
			if err := execCmd(c[0], c[1:]...); err != nil {
				return fmt.Errorf("creating user %s: %w", user, err)
			}
		}
		fmt.Printf("  Created system user: %s (uid %d)\n", user, uid)
	} else {
		fmt.Printf("  System user already exists: %s\n", user)
	}

	return nil
}

// findUnusedDarwinID finds an unused UID or GID in the given range on macOS.
func findUnusedDarwinID(entityType, idKey string, low, high int) (int, error) {
	out, err := execCmdOutput("dscl", ".", "-list", "/"+entityType, idKey)
	if err != nil {
		return 0, fmt.Errorf("failed to list Darwin %s IDs: %w", entityType, err)
	}
	used := make(map[int]bool)
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 {
			var id int
			if _, err := fmt.Sscanf(fields[len(fields)-1], "%d", &id); err == nil {
				used[id] = true
			}
		}
	}
	for id := low; id <= high; id++ {
		if !used[id] {
			return id, nil
		}
	}
	return 0, fmt.Errorf("no unused ID available in range %d-%d", low, high)
}

// renderServiceFile renders the service file template for the given init system.
func renderServiceFile(sys initSystem, data serviceTemplateData) (string, error) {
	var buf bytes.Buffer

	switch sys {
	case initSystemd:
		tmpl, err := template.New("service").Parse(systemdTemplate)
		if err != nil {
			return "", fmt.Errorf("parsing template: %w", err)
		}
		if err := tmpl.Execute(&buf, data); err != nil {
			return "", fmt.Errorf("rendering template: %w", err)
		}
	case initLaunchd:
		// Use html/template for XML-safe escaping of values in the plist.
		tmpl, err := htmltemplate.New("service").Parse(launchdTemplate)
		if err != nil {
			return "", fmt.Errorf("parsing template: %w", err)
		}
		if err := tmpl.Execute(&buf, data); err != nil {
			return "", fmt.Errorf("rendering template: %w", err)
		}
	default:
		return "", fmt.Errorf("unsupported init system: %s", sys)
	}

	return buf.String(), nil
}

// startService starts the Gantry service.
func startService(info serviceInfo) error {
	switch info.InitSystem {
	case initSystemd:
		return execCmd("systemctl", "start", "gantry")
	case initLaunchd:
		// If already loaded, kickstart it; otherwise load it.
		if info.IsRunning {
			return execCmd("launchctl", "kickstart", "system/com.gantry.server")
		}
		return execCmd("launchctl", "load", "-w", launchdPlistPath)
	default:
		return fmt.Errorf("unsupported init system: %s", info.InitSystem)
	}
}

// stopService stops the Gantry service.
func stopService(info serviceInfo) error {
	switch info.InitSystem {
	case initSystemd:
		return execCmd("systemctl", "stop", "gantry")
	case initLaunchd:
		return execCmd("launchctl", "unload", launchdPlistPath)
	default:
		return fmt.Errorf("unsupported init system: %s", info.InitSystem)
	}
}

// enableService enables the Gantry service to start on boot.
func enableService(info serviceInfo) error {
	switch info.InitSystem {
	case initSystemd:
		if err := execCmd("systemctl", "daemon-reload"); err != nil {
			return err
		}
		return execCmd("systemctl", "enable", "gantry")
	case initLaunchd:
		// launchd plists with RunAtLoad=true are auto-enabled when loaded.
		return nil
	default:
		return fmt.Errorf("unsupported init system: %s", info.InitSystem)
	}
}

// serviceStatus returns a human-readable status string.
func serviceStatus(info serviceInfo) string {
	if !info.IsInstalled {
		return "not installed"
	}
	if info.IsRunning {
		return "running"
	}
	return "stopped"
}

// execCmd runs a command and returns an error if it fails.
func execCmd(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// execCmdOutput runs a command and returns its stdout.
func execCmdOutput(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	out, err := cmd.Output()
	return string(out), err
}
