package main

import (
	"runtime"
	"strings"
	"testing"
)

func TestDetectInitSystem(t *testing.T) {
	sys := detectInitSystem()

	switch runtime.GOOS {
	case "darwin":
		if sys != initLaunchd {
			t.Errorf("expected launchd on darwin, got %s", sys)
		}
	case "linux":
		// Could be systemd or unknown depending on the environment.
		if sys != initSystemd && sys != initUnknown {
			t.Errorf("expected systemd or unknown on linux, got %s", sys)
		}
	default:
		if sys != initUnknown {
			t.Errorf("expected unknown on %s, got %s", runtime.GOOS, sys)
		}
	}
}

func TestInitSystemString(t *testing.T) {
	tests := []struct {
		sys  initSystem
		want string
	}{
		{initUnknown, "unknown"},
		{initSystemd, "systemd"},
		{initLaunchd, "launchd"},
	}
	for _, tt := range tests {
		if got := tt.sys.String(); got != tt.want {
			t.Errorf("initSystem(%d).String() = %q, want %q", tt.sys, got, tt.want)
		}
	}
}

func TestRenderServiceFileSystemd(t *testing.T) {
	data := serviceTemplateData{
		User:      "gantry",
		Group:     "gantry",
		Port:      9090,
		DataDir:   "/var/lib/gantry",
		ConfigDir: "/etc/gantry",
	}

	content, err := renderServiceFile(initSystemd, data)
	if err != nil {
		t.Fatalf("renderServiceFile(systemd): %v", err)
	}

	// Verify key directives are present.
	checks := []string{
		"User=gantry",
		"Group=gantry",
		"ExecStart=/usr/local/bin/gantry serve --port 9090",
		"WorkingDirectory=/var/lib/gantry",
		"GANTRY_DATA_DIR=/var/lib/gantry",
		"EnvironmentFile=-/etc/gantry/gantry.env",
		"WantedBy=multi-user.target",
		"NoNewPrivileges=true",
	}
	for _, check := range checks {
		if !strings.Contains(content, check) {
			t.Errorf("systemd unit missing %q", check)
		}
	}
}

func TestRenderServiceFileLaunchd(t *testing.T) {
	data := serviceTemplateData{
		User:      "gantry",
		Group:     "gantry",
		Port:      8080,
		DataDir:   "/var/lib/gantry",
		ConfigDir: "/etc/gantry",
	}

	content, err := renderServiceFile(initLaunchd, data)
	if err != nil {
		t.Fatalf("renderServiceFile(launchd): %v", err)
	}

	// Verify key elements are present.
	checks := []string{
		"<string>com.gantry.server</string>",
		"<string>/etc/gantry/gantry-launch.sh</string>",
		"<string>gantry</string>",
		"<string>/var/lib/gantry</string>",
		"<key>RunAtLoad</key>",
		"<key>KeepAlive</key>",
		"/var/log/gantry.log",
	}
	for _, check := range checks {
		if !strings.Contains(content, check) {
			t.Errorf("launchd plist missing %q", check)
		}
	}
}

func TestRenderServiceFileUnknown(t *testing.T) {
	data := serviceTemplateData{}
	_, err := renderServiceFile(initUnknown, data)
	if err == nil {
		t.Error("expected error for unknown init system, got nil")
	}
}

func TestServiceStatus(t *testing.T) {
	tests := []struct {
		info serviceInfo
		want string
	}{
		{serviceInfo{IsInstalled: false, IsRunning: false}, "not installed"},
		{serviceInfo{IsInstalled: true, IsRunning: false}, "stopped"},
		{serviceInfo{IsInstalled: true, IsRunning: true}, "running"},
	}
	for _, tt := range tests {
		got := serviceStatus(tt.info)
		if got != tt.want {
			t.Errorf("serviceStatus(%+v) = %q, want %q", tt.info, got, tt.want)
		}
	}
}
