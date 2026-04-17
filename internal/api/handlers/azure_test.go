package handlers

import (
	"net/http"
	"net/http/httptest"
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
			clientID, _ := tt.config["clientId"].(string)
			clientSecret, _ := tt.config["clientSecret"].(string)
			if got := azureSSOConfigured(tt.ssoEnabled, clientID, clientSecret); got != tt.want {
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

func TestAzureEmail(t *testing.T) {
	t.Run("prefers validated primary email fields", func(t *testing.T) {
		email := azureEmail(
			&azplugin.IdentityClaims{Email: "claims@example.com", PreferredUsername: "preferred@example.com"},
			&azplugin.MicrosoftUser{Mail: "graph@example.com", UserPrincipalName: "upn@example.com"},
		)
		if want := "graph@example.com"; email != want {
			t.Fatalf("azureEmail() = %q, want %q", email, want)
		}
	})

	t.Run("rejects non email fallback values", func(t *testing.T) {
		email := azureEmail(
			&azplugin.IdentityClaims{PreferredUsername: "not-an-email"},
			&azplugin.MicrosoftUser{UserPrincipalName: "also-not-an-email"},
		)
		if email != "" {
			t.Fatalf("azureEmail() = %q, want empty string", email)
		}
	})
}

func TestAzureOAuthCallbackRejectsEmptyStateValues(t *testing.T) {
	h := &Handlers{}
	tests := []struct {
		name        string
		queryState  string
		cookieState string
	}{
		{
			name:        "rejects empty query state",
			queryState:  "",
			cookieState: "generated-state",
		},
		{
			name:        "rejects empty cookie state",
			queryState:  "generated-state",
			cookieState: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/azure/callback?state="+tt.queryState, nil)
			req.AddCookie(&http.Cookie{Name: "az_oauth_state", Value: tt.cookieState})

			rr := httptest.NewRecorder()
			h.AzureOAuthCallback(rr, req)

			if rr.Code != http.StatusBadRequest {
				t.Fatalf("AzureOAuthCallback() status = %d, want %d", rr.Code, http.StatusBadRequest)
			}
			if body := rr.Body.String(); body != "invalid or missing oauth state\n" {
				t.Fatalf("AzureOAuthCallback() body = %q, want %q", body, "invalid or missing oauth state\n")
			}
		})
	}
}
