package azure

import (
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var (
	graphAPIBase   = "https://graph.microsoft.com/v1.0"
	loginBaseURL   = "https://login.microsoftonline.com"
	azureHTTPClient = &http.Client{Timeout: 15 * time.Second}

	jwksCache = struct {
		sync.RWMutex
		entries   map[string]jwksCacheEntry
		refreshes map[string]chan struct{}
	}{
		entries:   map[string]jwksCacheEntry{},
		refreshes: map[string]chan struct{}{},
	}
)

const (
	jwksCacheTTL            = time.Hour
	jwksForceRefreshCooldown = time.Minute
)

// MicrosoftUser is the subset of Microsoft Graph user fields Gantry needs for SSO.
type MicrosoftUser struct {
	ID                string `json:"id"`
	DisplayName       string `json:"displayName"`
	Mail              string `json:"mail"`
	UserPrincipalName string `json:"userPrincipalName"`
}

// IdentityClaims contains the subset of ID token claims Gantry uses for stable SSO identity mapping.
type IdentityClaims struct {
	OID               string `json:"oid"`
	TID               string `json:"tid"`
	Email             string `json:"email"`
	Name              string `json:"name"`
	PreferredUsername string `json:"preferred_username"`
	jwt.RegisteredClaims
}

// OAuthTokenResponse is the token response from the Microsoft identity platform.
type OAuthTokenResponse struct {
	AccessToken      string `json:"access_token"`
	IDToken          string `json:"id_token"`
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
}

type jwksResponse struct {
	Keys []jsonWebKey `json:"keys"`
}

type jsonWebKey struct {
	KID string `json:"kid"`
	KTY string `json:"kty"`
	ALG string `json:"alg"`
	Use string `json:"use"`
	N   string `json:"n"`
	E   string `json:"e"`
}

type jwksCacheEntry struct {
	keys        map[string]*rsa.PublicKey
	expiresAt   time.Time
	refreshedAt time.Time
}

func normalizeTenantID(tenantID string) string {
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		return "common"
	}
	return tenantID
}

func normalizeScopes(scopes string) string {
	scopes = strings.TrimSpace(scopes)
	if scopes == "" {
		return "openid profile email User.Read"
	}

	parts := strings.Fields(scopes)
	for _, part := range parts {
		if strings.EqualFold(part, "openid") {
			return strings.Join(parts, " ")
		}
	}
	return strings.Join(append([]string{"openid"}, parts...), " ")
}

// AuthorizationURL builds the Microsoft OAuth authorization URL for the configured tenant.
func AuthorizationURL(tenantID, clientID, redirectURI, state, scopes string) string {
	values := url.Values{}
	values.Set("client_id", clientID)
	values.Set("response_type", "code")
	values.Set("redirect_uri", redirectURI)
	values.Set("response_mode", "query")
	values.Set("scope", normalizeScopes(scopes))
	values.Set("state", state)
	return fmt.Sprintf("%s/%s/oauth2/v2.0/authorize?%s", strings.TrimRight(loginBaseURL, "/"), url.PathEscape(normalizeTenantID(tenantID)), values.Encode())
}

// ExchangeOAuthCode exchanges a Microsoft OAuth authorization code for tokens.
func ExchangeOAuthCode(code, clientID, clientSecret, tenantID, redirectURI, scopes string) (*OAuthTokenResponse, error) {
	values := url.Values{}
	values.Set("grant_type", "authorization_code")
	values.Set("code", code)
	values.Set("client_id", clientID)
	values.Set("client_secret", clientSecret)
	values.Set("redirect_uri", redirectURI)
	values.Set("scope", normalizeScopes(scopes))

	endpoint := fmt.Sprintf("%s/%s/oauth2/v2.0/token", strings.TrimRight(loginBaseURL, "/"), url.PathEscape(normalizeTenantID(tenantID)))
	req, err := http.NewRequest(http.MethodPost, endpoint, strings.NewReader(values.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", "gantry-azure-auth/1.0")

	res, err := azureHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("exchange oauth code: %w", err)
	}
	defer res.Body.Close()

	body, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, fmt.Errorf("read token response: %w", err)
	}

	var tokenResp OAuthTokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, fmt.Errorf("decode token response: %w", err)
	}
	if tokenResp.Error != "" {
		return nil, fmt.Errorf("microsoft oauth: %s: %s", tokenResp.Error, tokenResp.ErrorDescription)
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("microsoft oauth token exchange failed: HTTP %d", res.StatusCode)
	}
	if tokenResp.AccessToken == "" {
		return nil, fmt.Errorf("microsoft oauth token exchange returned no access token")
	}
	return &tokenResp, nil
}

// FetchUserWithToken fetches the current user from Microsoft Graph.
func FetchUserWithToken(accessToken string) (*MicrosoftUser, error) {
	req, err := http.NewRequest(http.MethodGet, graphAPIBase+"/me?$select=id,displayName,mail,userPrincipalName", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "gantry-azure-auth/1.0")

	res, err := azureHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("microsoft graph request: %w", err)
	}
	defer res.Body.Close()

	body, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, fmt.Errorf("read graph response: %w", err)
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("microsoft graph /me: HTTP %d: %s", res.StatusCode, strings.TrimSpace(string(body)))
	}

	var user MicrosoftUser
	if err := json.Unmarshal(body, &user); err != nil {
		return nil, fmt.Errorf("decode graph response: %w", err)
	}
	return &user, nil
}

// ParseIdentityClaims verifies the Microsoft ID token signature and required claims before returning identity data.
func ParseIdentityClaims(idToken, tenantID, clientID string) (*IdentityClaims, error) {
	if strings.TrimSpace(idToken) == "" {
		return nil, fmt.Errorf("parse id token claims: id token is empty")
	}

	claims := &IdentityClaims{}
	parsedToken, err := jwt.ParseWithClaims(idToken, claims, func(token *jwt.Token) (any, error) {
		if token.Method.Alg() != jwt.SigningMethodRS256.Alg() {
			return nil, fmt.Errorf("unexpected signing method %q", token.Method.Alg())
		}

		kid, _ := token.Header["kid"].(string)
		if strings.TrimSpace(kid) == "" {
			return nil, fmt.Errorf("missing key id in token header")
		}

		publicKey, err := fetchJWKSPublicKey(tenantID, kid)
		if err != nil {
			return nil, err
		}
		return publicKey, nil
	})
	if err != nil {
		return nil, fmt.Errorf("parse id token claims: %w", err)
	}
	if !parsedToken.Valid {
		return nil, fmt.Errorf("parse id token claims: token is invalid")
	}

	if err := validateIdentityClaims(claims, tenantID, clientID); err != nil {
		return nil, err
	}
	return claims, nil
}

func validateIdentityClaims(claims *IdentityClaims, tenantID, clientID string) error {
	now := time.Now()
	if claims.ExpiresAt == nil || !claims.ExpiresAt.After(now) {
		return fmt.Errorf("parse id token claims: token expiration is invalid")
	}
	if claims.NotBefore != nil && claims.NotBefore.After(now) {
		return fmt.Errorf("parse id token claims: token is not valid yet")
	}
	if strings.TrimSpace(clientID) == "" {
		return fmt.Errorf("parse id token claims: missing client id for audience validation")
	}
	if !audienceContains(claims.Audience, clientID) {
		return fmt.Errorf("parse id token claims: audience %q does not include client id", strings.Join(claims.Audience, ","))
	}

	expectedIssuer := expectedIssuer(tenantID, claims)
	if claims.Issuer != expectedIssuer {
		return fmt.Errorf("parse id token claims: issuer %q does not match expected %q", claims.Issuer, expectedIssuer)
	}
	return nil
}

func expectedIssuer(tenantID string, claims *IdentityClaims) string {
	tenant := normalizeTenantID(tenantID)
	if shouldUseTokenTenantIssuer(tenant) && claims != nil && strings.TrimSpace(claims.TID) != "" {
		tenant = strings.TrimSpace(claims.TID)
	}
	return fmt.Sprintf("%s/%s/v2.0", strings.TrimRight(loginBaseURL, "/"), tenant)
}

func shouldUseTokenTenantIssuer(tenantID string) bool {
	tenantID = strings.TrimSpace(tenantID)
	if isMultiTenantAuthority(tenantID) {
		return true
	}
	return !looksLikeTenantGUID(tenantID)
}

func isMultiTenantAuthority(tenantID string) bool {
	switch strings.ToLower(strings.TrimSpace(tenantID)) {
	case "common", "organizations", "consumers":
		return true
	default:
		return false
	}
}

func looksLikeTenantGUID(tenantID string) bool {
	parts := strings.Split(strings.TrimSpace(tenantID), "-")
	if len(parts) != 5 {
		return false
	}
	segmentLengths := []int{8, 4, 4, 4, 12}
	for i, part := range parts {
		if len(part) != segmentLengths[i] {
			return false
		}
		for _, r := range part {
			if (r < '0' || r > '9') && (r < 'a' || r > 'f') && (r < 'A' || r > 'F') {
				return false
			}
		}
	}
	return true
}

func audienceContains(audience jwt.ClaimStrings, clientID string) bool {
	for _, aud := range audience {
		if aud == clientID {
			return true
		}
	}
	return false
}

func fetchJWKSKeys(tenantID string) (map[string]*rsa.PublicKey, error) {
	return fetchJWKSKeysWithOptions(tenantID, false)
}

func fetchJWKSPublicKey(tenantID, kid string) (*rsa.PublicKey, error) {
	keys, err := fetchJWKSKeysWithOptions(tenantID, false)
	if err != nil {
		return nil, err
	}
	if publicKey, ok := keys[kid]; ok {
		return publicKey, nil
	}

	keys, err = fetchJWKSKeysWithOptions(tenantID, true)
	if err != nil {
		return nil, err
	}
	if publicKey, ok := keys[kid]; ok {
		return publicKey, nil
	}
	return nil, fmt.Errorf("signing key %q not found in jwks", kid)
}

func fetchJWKSKeysWithOptions(tenantID string, forceRefresh bool) (map[string]*rsa.PublicKey, error) {
	tenant := normalizeTenantID(tenantID)

	for {
		now := time.Now()
		jwksCache.Lock()
		entry, ok := jwksCache.entries[tenant]
		if !forceRefresh && ok && now.Before(entry.expiresAt) {
			jwksCache.Unlock()
			return entry.keys, nil
		}
		if forceRefresh && ok && !entry.refreshedAt.IsZero() && now.Sub(entry.refreshedAt) < jwksForceRefreshCooldown {
			jwksCache.Unlock()
			return entry.keys, nil
		}
		if waitCh, refreshing := jwksCache.refreshes[tenant]; refreshing {
			jwksCache.Unlock()
			<-waitCh
			continue
		}

		waitCh := make(chan struct{})
		jwksCache.refreshes[tenant] = waitCh
		jwksCache.Unlock()

		keys, err := requestJWKSKeys(tenant)
		fetchedAt := time.Now()

		jwksCache.Lock()
		delete(jwksCache.refreshes, tenant)
		close(waitCh)
		if err != nil {
			jwksCache.Unlock()
			return nil, err
		}
		jwksCache.entries[tenant] = jwksCacheEntry{
			keys:        keys,
			expiresAt:   fetchedAt.Add(jwksCacheTTL),
			refreshedAt: fetchedAt,
		}
		jwksCache.Unlock()
		return keys, nil
	}
}

func requestJWKSKeys(tenantID string) (map[string]*rsa.PublicKey, error) {
	endpoint := fmt.Sprintf("%s/%s/discovery/v2.0/keys", strings.TrimRight(loginBaseURL, "/"), url.PathEscape(tenantID))
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("build jwks request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "gantry-azure-auth/1.0")

	res, err := azureHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch jwks: %w", err)
	}
	defer res.Body.Close()

	body, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, fmt.Errorf("read jwks response: %w", err)
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("fetch jwks: HTTP %d: %s", res.StatusCode, strings.TrimSpace(string(body)))
	}

	var payload jwksResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("decode jwks response: %w", err)
	}

	keys := make(map[string]*rsa.PublicKey, len(payload.Keys))
	for _, key := range payload.Keys {
		if strings.ToUpper(key.KTY) != "RSA" || strings.TrimSpace(key.KID) == "" {
			continue
		}
		publicKey, err := rsaPublicKeyFromJWK(key)
		if err != nil {
			return nil, err
		}
		keys[key.KID] = publicKey
	}
	if len(keys) == 0 {
		return nil, fmt.Errorf("jwks response did not contain usable rsa keys")
	}
	return keys, nil
}

func rsaPublicKeyFromJWK(key jsonWebKey) (*rsa.PublicKey, error) {
	modulus, err := base64.RawURLEncoding.DecodeString(key.N)
	if err != nil {
		return nil, fmt.Errorf("decode jwks modulus for key %q: %w", key.KID, err)
	}
	exponent, err := base64.RawURLEncoding.DecodeString(key.E)
	if err != nil {
		return nil, fmt.Errorf("decode jwks exponent for key %q: %w", key.KID, err)
	}

	eBig := new(big.Int).SetBytes(exponent)
	if eBig.Sign() <= 0 || !eBig.IsInt64() {
		return nil, fmt.Errorf("jwks exponent for key %q is invalid", key.KID)
	}
	e := int(eBig.Int64())
	if int64(e) != eBig.Int64() {
		return nil, fmt.Errorf("jwks exponent for key %q is invalid", key.KID)
	}

	return &rsa.PublicKey{
		N: new(big.Int).SetBytes(modulus),
		E: e,
	}, nil
}

func clearJWKSCache() {
	jwksCache.Lock()
	defer jwksCache.Unlock()
	jwksCache.entries = map[string]jwksCacheEntry{}
	jwksCache.refreshes = map[string]chan struct{}{}
}