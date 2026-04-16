package azure

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const graphAPIBase = "https://graph.microsoft.com/v1.0"

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
}

// OAuthTokenResponse is the token response from the Microsoft identity platform.
type OAuthTokenResponse struct {
	AccessToken      string `json:"access_token"`
	IDToken          string `json:"id_token"`
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
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
	return scopes
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
	return fmt.Sprintf("https://login.microsoftonline.com/%s/oauth2/v2.0/authorize?%s", url.PathEscape(normalizeTenantID(tenantID)), values.Encode())
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

	endpoint := fmt.Sprintf("https://login.microsoftonline.com/%s/oauth2/v2.0/token", url.PathEscape(normalizeTenantID(tenantID)))
	req, err := http.NewRequest(http.MethodPost, endpoint, strings.NewReader(values.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", "gantry-azure-auth/1.0")

	res, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
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

	res, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
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

// ParseIdentityClaims extracts useful claims from the returned ID token without re-validating it.
// The token comes directly from the Microsoft token endpoint over TLS after a successful code exchange.
func ParseIdentityClaims(idToken string) (*IdentityClaims, error) {
	if strings.TrimSpace(idToken) == "" {
		return &IdentityClaims{}, nil
	}

	var claims IdentityClaims
	if _, _, err := new(jwt.Parser).ParseUnverified(idToken, &claims); err != nil {
		return nil, fmt.Errorf("parse id token claims: %w", err)
	}
	return &claims, nil
}
