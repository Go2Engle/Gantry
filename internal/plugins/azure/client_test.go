package azure

import (
	"net/url"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"
)

func TestAuthorizationURLUsesDefaults(t *testing.T) {
	authURL := AuthorizationURL("", "client-123", "http://localhost:3000/api/v1/auth/azure/callback", "state-abc", "")

	parsed, err := url.Parse(authURL)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if got, want := parsed.Scheme, "https"; got != want {
		t.Fatalf("scheme = %q, want %q", got, want)
	}
	if got, want := parsed.Host, "login.microsoftonline.com"; got != want {
		t.Fatalf("host = %q, want %q", got, want)
	}
	if got, want := parsed.Path, "/common/oauth2/v2.0/authorize"; got != want {
		t.Fatalf("path = %q, want %q", got, want)
	}

	query := parsed.Query()
	if got, want := query.Get("client_id"), "client-123"; got != want {
		t.Fatalf("client_id = %q, want %q", got, want)
	}
	if got, want := query.Get("state"), "state-abc"; got != want {
		t.Fatalf("state = %q, want %q", got, want)
	}
	if got, want := query.Get("scope"), "openid profile email User.Read"; got != want {
		t.Fatalf("scope = %q, want %q", got, want)
	}
}

func TestParseIdentityClaims(t *testing.T) {
	token := jwt.NewWithClaims(jwt.SigningMethodNone, jwt.MapClaims{
		"oid":                "user-oid",
		"tid":                "tenant-id",
		"email":              "person@example.com",
		"name":               "Azure Person",
		"preferred_username": "person@example.com",
	})
	tokenString, err := token.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatalf("SignedString: %v", err)
	}

	claims, err := ParseIdentityClaims(tokenString)
	if err != nil {
		t.Fatalf("ParseIdentityClaims: %v", err)
	}
	if got, want := claims.OID, "user-oid"; got != want {
		t.Fatalf("OID = %q, want %q", got, want)
	}
	if got, want := claims.TID, "tenant-id"; got != want {
		t.Fatalf("TID = %q, want %q", got, want)
	}
	if got, want := claims.Email, "person@example.com"; got != want {
		t.Fatalf("Email = %q, want %q", got, want)
	}
}

func TestNormalizeScopesPreservesExplicitValue(t *testing.T) {
	const scopes = "openid profile email User.Read GroupMember.Read.All"
	authURL := AuthorizationURL("contoso.onmicrosoft.com", "client-123", "http://localhost/callback", "state-abc", scopes)
	if !strings.Contains(authURL, url.QueryEscape(scopes)) {
		t.Fatalf("auth URL %q does not contain encoded scopes %q", authURL, scopes)
	}
}
