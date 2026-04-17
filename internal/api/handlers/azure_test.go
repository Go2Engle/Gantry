package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/go2engle/gantry/internal/config"
	"github.com/go2engle/gantry/internal/db"
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

func TestAzureDisplayName(t *testing.T) {
	t.Run("prefers microsoft graph display name", func(t *testing.T) {
		name := azureDisplayName(
			&azplugin.IdentityClaims{Name: "Claims Name", PreferredUsername: "claims@example.com"},
			&azplugin.MicrosoftUser{DisplayName: "Graph Name", UserPrincipalName: "graph@example.com"},
		)
		if want := "Graph Name"; name != want {
			t.Fatalf("azureDisplayName() = %q, want %q", name, want)
		}
	})

	t.Run("falls back to email style identifiers only when needed", func(t *testing.T) {
		name := azureDisplayName(
			&azplugin.IdentityClaims{PreferredUsername: "claims@example.com"},
			&azplugin.MicrosoftUser{},
		)
		if want := "claims@example.com"; name != want {
			t.Fatalf("azureDisplayName() = %q, want %q", name, want)
		}
	})
}

func TestAzureDefaultAccess(t *testing.T) {
	t.Run("maps built in roles to default groups", func(t *testing.T) {
		group, fallback := azureDefaultAccess("developer")
		if group != "developers" || fallback != "developer" {
			t.Fatalf("azureDefaultAccess() = (%q, %q), want (%q, %q)", group, fallback, "developers", "developer")
		}
	})

	t.Run("falls back to viewer for unknown roles", func(t *testing.T) {
		group, fallback := azureDefaultAccess("mystery-role")
		if group != "" || fallback != "viewer" {
			t.Fatalf("azureDefaultAccess() = (%q, %q), want (%q, %q)", group, fallback, "", "viewer")
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
			if body := rr.Body.String(); body != "{\"error\":\"invalid or missing oauth state\"}\n" {
				t.Fatalf("AzureOAuthCallback() body = %q, want %q", body, "{\"error\":\"invalid or missing oauth state\"}\n")
			}
		})
	}
}

func TestAzureOAuthCallbackRejectsUnavailablePlugin(t *testing.T) {
	dataDir := t.TempDir()
	cfg := &config.Config{
		Port:          8080,
		DBType:        "sqlite",
		DBDSN:         filepath.Join(dataDir, "gantry.db"),
		JWTSecret:     "test-secret",
		DataDir:       dataDir,
		EncryptionKey: "test-encryption-key",
	}

	database, err := db.New(cfg)
	if err != nil {
		t.Fatalf("db.New: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	if err := database.Migrate(); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	h := &Handlers{DB: database}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/azure/callback?state=generated-state&code=test-code", nil)
	req = req.WithContext(context.Background())
	req.AddCookie(&http.Cookie{Name: "az_oauth_state", Value: "generated-state"})

	rr := httptest.NewRecorder()
	h.AzureOAuthCallback(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("AzureOAuthCallback() status = %d, want %d", rr.Code, http.StatusBadRequest)
	}
	if body := rr.Body.String(); body != "{\"error\":\"Microsoft Azure plugin not installed or not enabled\"}\n" {
		t.Fatalf("AzureOAuthCallback() body = %q, want %q", body, "{\"error\":\"Microsoft Azure plugin not installed or not enabled\"}\n")
	}
}

func TestEnsureAzureDefaultAccessAssignsBuiltInGroup(t *testing.T) {
	database := newAzureTestDB(t)
	h := &Handlers{DB: database}

	user := &db.User{
		Username: "azure:tenant:object",
		Role:     "viewer",
		SSOOnly:  true,
	}
	if err := database.CreateUser(context.Background(), user); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	if err := h.ensureAzureDefaultAccess(context.Background(), user, "developer"); err != nil {
		t.Fatalf("ensureAzureDefaultAccess: %v", err)
	}

	groups, err := database.ListUserGroups(context.Background(), user.ID)
	if err != nil {
		t.Fatalf("ListUserGroups: %v", err)
	}
	if len(groups) != 1 || groups[0].Name != "developers" {
		t.Fatalf("ListUserGroups() = %#v, want developers membership", groups)
	}

	reloaded, err := database.GetUserByID(context.Background(), user.ID)
	if err != nil {
		t.Fatalf("GetUserByID: %v", err)
	}
	if reloaded.Role != "viewer" {
		t.Fatalf("user role = %q, want %q", reloaded.Role, "viewer")
	}
}

func TestEnsureAzureDefaultAccessDoesNotOverrideExistingAssignments(t *testing.T) {
	database := newAzureTestDB(t)
	h := &Handlers{DB: database}

	user := &db.User{
		Username: "azure:tenant:object",
		Role:     "viewer",
		SSOOnly:  true,
	}
	if err := database.CreateUser(context.Background(), user); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if err := database.AddUserToGroupByName(context.Background(), user.ID, "admins"); err != nil {
		t.Fatalf("AddUserToGroupByName: %v", err)
	}

	if err := h.ensureAzureDefaultAccess(context.Background(), user, "developer"); err != nil {
		t.Fatalf("ensureAzureDefaultAccess: %v", err)
	}

	groups, err := database.ListUserGroups(context.Background(), user.ID)
	if err != nil {
		t.Fatalf("ListUserGroups: %v", err)
	}
	if len(groups) != 1 || groups[0].Name != "admins" {
		t.Fatalf("ListUserGroups() = %#v, want existing admins membership to remain unchanged", groups)
	}
}

func newAzureTestDB(t *testing.T) *db.DB {
	t.Helper()

	dataDir := t.TempDir()
	cfg := &config.Config{
		Port:          8080,
		DBType:        "sqlite",
		DBDSN:         filepath.Join(dataDir, "gantry.db"),
		JWTSecret:     "test-secret",
		DataDir:       dataDir,
		EncryptionKey: "test-encryption-key",
	}

	database, err := db.New(cfg)
	if err != nil {
		t.Fatalf("db.New: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	if err := database.Migrate(); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	if err := database.SeedDefaultGroups(context.Background()); err != nil {
		t.Fatalf("SeedDefaultGroups: %v", err)
	}

	return database
}
