package handlers

import (
	"testing"

	azplugin "github.com/go2engle/gantry/internal/plugins/azure"
)

func TestAzureSSOConfigured(t *testing.T) {
	tests := []struct {
		name       string
		ssoEnabled bool
		config     map[string]any
		want       bool
	}{
		{
			name:       "disabled plugin config is not ready",
			ssoEnabled: false,
			config: map[string]any{
				"clientId":     "client-id",
				"clientSecret": "client-secret",
			},
			want: false,
		},
		{
			name:       "missing client secret is not ready",
			ssoEnabled: true,
			config: map[string]any{
				"clientId": "client-id",
			},
			want: false,
		},
		{
			name:       "full oauth client config is ready",
			ssoEnabled: true,
			config: map[string]any{
				"clientId":     "client-id",
				"clientSecret": "client-secret",
			},
			want: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := azureSSOConfigured(tt.config, tt.ssoEnabled); got != tt.want {
				t.Fatalf("azureSSOConfigured() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestAzureUsername(t *testing.T) {
	t.Run("uses immutable tenant and object identifiers", func(t *testing.T) {
		username, err := azureUsername(&azplugin.IdentityClaims{TID: "Tenant-ID", OID: "Object-ID"})
		if err != nil {
			t.Fatalf("azureUsername() error = %v, want nil", err)
		}
		if want := "azure:tenant-id:object-id"; username != want {
			t.Fatalf("azureUsername() = %q, want %q", username, want)
		}
	})

	t.Run("fails closed when immutable identifiers are missing", func(t *testing.T) {
		if _, err := azureUsername(&azplugin.IdentityClaims{PreferredUsername: "user@example.com"}); err == nil {
			t.Fatal("azureUsername() error = nil, want failure when oid/tid are missing")
		}
	})
}
