package azure

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

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

func TestParseIdentityClaimsValidatesSignatureAndClaims(t *testing.T) {
	const (
		configuredTenant = "common"
		tokenTenant      = "tenant-id"
		clientID         = "client-123"
		keyID            = "test-key"
	)

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("GenerateKey: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got, want := r.URL.Path, "/common/discovery/v2.0/keys"; got != want {
			t.Fatalf("JWKS path = %q, want %q", got, want)
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]any{
			"keys": []map[string]any{jwkFromPublicKey(keyID, &privateKey.PublicKey)},
		}); err != nil {
			t.Fatalf("Encode JWKS: %v", err)
		}
	}))
	defer server.Close()

	oldLoginBaseURL := loginBaseURL
	loginBaseURL = server.URL
	defer func() { loginBaseURL = oldLoginBaseURL }()
	clearJWKSCache()
	defer clearJWKSCache()

	tokenString, err := newSignedToken(privateKey, keyID, jwt.MapClaims{
		"oid":                "user-oid",
		"tid":                tokenTenant,
		"email":              "person@example.com",
		"name":               "Azure Person",
		"preferred_username": "person@example.com",
		"iss":                fmt.Sprintf("%s/%s/v2.0", server.URL, tokenTenant),
		"aud":                clientID,
		"exp":                time.Now().Add(time.Hour).Unix(),
		"nbf":                time.Now().Add(-time.Minute).Unix(),
		"iat":                time.Now().Add(-time.Minute).Unix(),
	})
	if err != nil {
		t.Fatalf("SignedString: %v", err)
	}

	claims, err := ParseIdentityClaims(tokenString, configuredTenant, clientID)
	if err != nil {
		t.Fatalf("ParseIdentityClaims: %v", err)
	}
	if got, want := claims.OID, "user-oid"; got != want {
		t.Fatalf("OID = %q, want %q", got, want)
	}
	if got, want := claims.TID, tokenTenant; got != want {
		t.Fatalf("TID = %q, want %q", got, want)
	}
	if got, want := claims.Email, "person@example.com"; got != want {
		t.Fatalf("Email = %q, want %q", got, want)
	}
}

func TestParseIdentityClaimsRejectsInvalidAudience(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("GenerateKey: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]any{
			"keys": []map[string]any{jwkFromPublicKey("test-key", &privateKey.PublicKey)},
		}); err != nil {
			t.Fatalf("Encode JWKS: %v", err)
		}
	}))
	defer server.Close()

	oldLoginBaseURL := loginBaseURL
	loginBaseURL = server.URL
	defer func() { loginBaseURL = oldLoginBaseURL }()
	clearJWKSCache()
	defer clearJWKSCache()

	tokenString, err := newSignedToken(privateKey, "test-key", jwt.MapClaims{
		"oid":                "user-oid",
		"tid":                "tenant-id",
		"preferred_username": "person@example.com",
		"iss":                fmt.Sprintf("%s/%s/v2.0", server.URL, "tenant-id"),
		"aud":                "different-client",
		"exp":                time.Now().Add(time.Hour).Unix(),
	})
	if err != nil {
		t.Fatalf("SignedString: %v", err)
	}

	if _, err := ParseIdentityClaims(tokenString, "common", "client-123"); err == nil || !strings.Contains(err.Error(), "audience") {
		t.Fatalf("ParseIdentityClaims error = %v, want audience validation error", err)
	}
}

func TestNormalizeScopesPreservesExplicitValue(t *testing.T) {
	const scopes = "openid profile email User.Read GroupMember.Read.All"
	authURL := AuthorizationURL("contoso.onmicrosoft.com", "client-123", "http://localhost/callback", "state-abc", scopes)
	if !strings.Contains(authURL, url.QueryEscape(scopes)) {
		t.Fatalf("auth URL %q does not contain encoded scopes %q", authURL, scopes)
	}
}

func newSignedToken(privateKey *rsa.PrivateKey, keyID string, claims jwt.Claims) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = keyID
	return token.SignedString(privateKey)
}

func jwkFromPublicKey(keyID string, publicKey *rsa.PublicKey) map[string]any {
	return map[string]any{
		"kid": keyID,
		"kty": "RSA",
		"alg": "RS256",
		"use": "sig",
		"n":   base64.RawURLEncoding.EncodeToString(publicKey.N.Bytes()),
		"e":   base64.RawURLEncoding.EncodeToString(big.NewInt(int64(publicKey.E)).Bytes()),
	}
}