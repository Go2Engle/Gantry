package handlers

import "testing"

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
