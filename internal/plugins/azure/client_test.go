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
	"sync/atomic"
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

	handlerErrCh := make(chan error, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got, want := r.URL.Path, "/common/discovery/v2.0/keys"; got != want {
			recordJWKSHandlerError(w, handlerErrCh, "JWKS path = %q, want %q", got, want)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]any{
			"keys": []map[string]any{jwkFromPublicKey(keyID, &privateKey.PublicKey)},
		}); err != nil {
			recordJWKSHandlerError(w, handlerErrCh, "Encode JWKS: %v", err)
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
	assertNoJWKSHandlerError(t, handlerErrCh)
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

func TestParseIdentityClaimsRejectsEmptyToken(t *testing.T) {
	if _, err := ParseIdentityClaims("   ", "tenant-id", "client-123"); err == nil || !strings.Contains(err.Error(), "id token is empty") {
		t.Fatalf("ParseIdentityClaims error = %v, want empty token error", err)
	}
}

func TestParseIdentityClaimsRejectsInvalidAudience(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("GenerateKey: %v", err)
	}

	handlerErrCh := make(chan error, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]any{
			"keys": []map[string]any{jwkFromPublicKey("test-key", &privateKey.PublicKey)},
		}); err != nil {
			recordJWKSHandlerError(w, handlerErrCh, "Encode JWKS: %v", err)
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
		assertNoJWKSHandlerError(t, handlerErrCh)
		t.Fatalf("ParseIdentityClaims error = %v, want audience validation error", err)
	}
	assertNoJWKSHandlerError(t, handlerErrCh)
}

func TestParseIdentityClaimsAcceptsDomainConfiguredTenant(t *testing.T) {
	const (
		configuredTenant = "contoso.onmicrosoft.com"
		tokenTenant      = "11111111-2222-3333-4444-555555555555"
		clientID         = "client-123"
		keyID            = "test-key"
	)

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("GenerateKey: %v", err)
	}

	handlerErrCh := make(chan error, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got, want := r.URL.Path, "/contoso.onmicrosoft.com/discovery/v2.0/keys"; got != want {
			recordJWKSHandlerError(w, handlerErrCh, "JWKS path = %q, want %q", got, want)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]any{
			"keys": []map[string]any{jwkFromPublicKey(keyID, &privateKey.PublicKey)},
		}); err != nil {
			recordJWKSHandlerError(w, handlerErrCh, "Encode JWKS: %v", err)
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
		"preferred_username": "person@example.com",
		"iss":                fmt.Sprintf("%s/%s/v2.0", server.URL, tokenTenant),
		"aud":                clientID,
		"exp":                time.Now().Add(time.Hour).Unix(),
		"nbf":                time.Now().Add(-time.Minute).Unix(),
	})
	if err != nil {
		t.Fatalf("SignedString: %v", err)
	}

	claims, err := ParseIdentityClaims(tokenString, configuredTenant, clientID)
	assertNoJWKSHandlerError(t, handlerErrCh)
	if err != nil {
		t.Fatalf("ParseIdentityClaims: %v", err)
	}
	if got, want := claims.TID, tokenTenant; got != want {
		t.Fatalf("TID = %q, want %q", got, want)
	}
}

func TestParseIdentityClaimsRefreshesJWKSOnUnknownKeyID(t *testing.T) {
	const (
		configuredTenant = "common"
		tokenTenant      = "tenant-id"
		clientID         = "client-123"
		freshKeyID       = "fresh-key"
	)

	stalePrivateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("Generate stale key: %v", err)
	}
	freshPrivateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("Generate fresh key: %v", err)
	}

	var requestCount atomic.Int32
	handlerErrCh := make(chan error, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		current := requestCount.Add(1)
		w.Header().Set("Content-Type", "application/json")

		keys := []map[string]any{jwkFromPublicKey("stale-key", &stalePrivateKey.PublicKey)}
		if current > 1 {
			keys = append(keys, jwkFromPublicKey(freshKeyID, &freshPrivateKey.PublicKey))
		}

		if err := json.NewEncoder(w).Encode(map[string]any{"keys": keys}); err != nil {
			recordJWKSHandlerError(w, handlerErrCh, "Encode JWKS: %v", err)
		}
	}))
	defer server.Close()

	oldLoginBaseURL := loginBaseURL
	loginBaseURL = server.URL
	defer func() { loginBaseURL = oldLoginBaseURL }()
	clearJWKSCache()
	defer clearJWKSCache()

	cachedKeys, err := requestJWKSKeys(configuredTenant)
	assertNoJWKSHandlerError(t, handlerErrCh)
	if err != nil {
		t.Fatalf("requestJWKSKeys: %v", err)
	}
	jwksCache.Lock()
	jwksCache.entries[configuredTenant] = jwksCacheEntry{
		keys:      cachedKeys,
		expiresAt: time.Now().Add(time.Hour),
	}
	jwksCache.Unlock()

	tokenString, err := newSignedToken(freshPrivateKey, freshKeyID, jwt.MapClaims{
		"oid":                "user-oid",
		"tid":                tokenTenant,
		"preferred_username": "person@example.com",
		"iss":                fmt.Sprintf("%s/%s/v2.0", server.URL, tokenTenant),
		"aud":                clientID,
		"exp":                time.Now().Add(time.Hour).Unix(),
	})
	if err != nil {
		t.Fatalf("SignedString: %v", err)
	}

	if _, err := ParseIdentityClaims(tokenString, configuredTenant, clientID); err != nil {
		assertNoJWKSHandlerError(t, handlerErrCh)
		t.Fatalf("ParseIdentityClaims: %v", err)
	}
	assertNoJWKSHandlerError(t, handlerErrCh)
	if got := requestCount.Load(); got != 2 {
		t.Fatalf("JWKS request count = %d, want 2", got)
	}
}

func TestNormalizeScopesPreservesExplicitValue(t *testing.T) {
	const scopes = "openid profile email User.Read GroupMember.Read.All"
	authURL := AuthorizationURL("contoso.onmicrosoft.com", "client-123", "http://localhost/callback", "state-abc", scopes)
	if !strings.Contains(authURL, url.QueryEscape(scopes)) {
		t.Fatalf("auth URL %q does not contain encoded scopes %q", authURL, scopes)
	}
}

func TestNormalizeScopesAddsOpenIDWhenMissing(t *testing.T) {
	const scopes = "profile email User.Read"
	authURL := AuthorizationURL("contoso.onmicrosoft.com", "client-123", "http://localhost/callback", "state-abc", scopes)
	if !strings.Contains(authURL, url.QueryEscape("openid "+scopes)) {
		t.Fatalf("auth URL %q does not contain encoded scopes %q", authURL, "openid "+scopes)
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

func recordJWKSHandlerError(w http.ResponseWriter, handlerErrCh chan<- error, format string, args ...any) {
	select {
	case handlerErrCh <- fmt.Errorf(format, args...):
	default:
	}
	http.Error(w, "test handler error", http.StatusInternalServerError)
}

func assertNoJWKSHandlerError(t *testing.T, handlerErrCh <-chan error) {
	t.Helper()
	select {
	case err := <-handlerErrCh:
		t.Fatalf("jwks test server handler error: %v", err)
	default:
	}
}
