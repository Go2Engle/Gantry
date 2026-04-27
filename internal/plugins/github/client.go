package github

import (
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const apiBase = "https://api.github.com"

// OAuthTokenResponse is the token payload returned by GitHub's OAuth exchange.
type OAuthTokenResponse struct {
	AccessToken           string
	RefreshToken          string
	TokenType             string
	Scope                 string
	ExpiresIn             int
	RefreshTokenExpiresIn int
}

// Client authenticates to the GitHub REST API via PAT or GitHub App installation token.
type Client struct {
	httpClient *http.Client
	token      string
}

// NewClient creates a GitHub API client from plugin configuration.
//
// Config keys (authMode = "pat", default):
//   - personalAccessToken: GitHub PAT with repo and read:org scopes
//
// Config keys (authMode = "app"):
//   - appId:          GitHub App numeric ID
//   - privateKey:     PEM-encoded RSA private key
//   - installationId: GitHub App installation ID for the target org
func NewClient(config map[string]any) (*Client, error) {
	authMode, _ := config["authMode"].(string)
	if authMode == "" {
		authMode = "pat"
	}

	switch authMode {
	case "app":
		token, err := appInstallationToken(config)
		if err != nil {
			return nil, fmt.Errorf("github app auth: %w", err)
		}
		return &Client{
			httpClient: &http.Client{Timeout: 30 * time.Second},
			token:      token,
		}, nil
	default: // "pat"
		pat, _ := config["personalAccessToken"].(string)
		if pat == "" {
			return nil, fmt.Errorf("personalAccessToken is required for pat auth mode")
		}
		return &Client{
			httpClient: &http.Client{Timeout: 30 * time.Second},
			token:      pat,
		}, nil
	}
}

// get performs an authenticated GET request and decodes the JSON response into v.
func (c *Client) get(path string, v any) error {
	req, err := http.NewRequest(http.MethodGet, apiBase+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	res, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("github api request: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(res.Body)
		var errBody struct {
			Message string `json:"message"`
		}
		json.Unmarshal(body, &errBody)
		if errBody.Message != "" {
			return fmt.Errorf("github api %s: %s", path, errBody.Message)
		}
		return fmt.Errorf("github api %s: HTTP %d", path, res.StatusCode)
	}

	return json.NewDecoder(res.Body).Decode(v)
}

// GetRepo fetches a repository by owner/name.
func (c *Client) GetRepo(owner, repo string) (*Repository, error) {
	var r Repository
	if err := c.get(fmt.Sprintf("/repos/%s/%s", owner, repo), &r); err != nil {
		return nil, err
	}
	return &r, nil
}

// GetCommits fetches the n most recent commits for a repository.
func (c *Client) GetCommits(owner, repo string, n int) ([]Commit, error) {
	var commits []Commit
	if err := c.get(fmt.Sprintf("/repos/%s/%s/commits?per_page=%d", owner, repo, n), &commits); err != nil {
		return nil, err
	}
	return commits, nil
}

// GetPullRequests fetches up to n open pull requests for a repository.
func (c *Client) GetPullRequests(owner, repo string, n int) ([]PullRequest, error) {
	var prs []PullRequest
	if err := c.get(fmt.Sprintf("/repos/%s/%s/pulls?state=open&per_page=%d", owner, repo, n), &prs); err != nil {
		return nil, err
	}
	return prs, nil
}

// GetLatestRelease fetches the latest published release for a repository.
// Returns nil (no error) when the repository has no releases.
func (c *Client) GetLatestRelease(owner, repo string) (*Release, error) {
	var r Release
	if err := c.get(fmt.Sprintf("/repos/%s/%s/releases/latest", owner, repo), &r); err != nil {
		// 404 means no releases exist — not an error.
		if strings.Contains(err.Error(), "Not Found") || strings.Contains(err.Error(), "404") {
			return nil, nil
		}
		return nil, err
	}
	return &r, nil
}

// GetReadme fetches the raw markdown content of the default README for a repository.
// Returns an empty string (no error) when the repository has no README.
func (c *Client) GetReadme(owner, repo string) (string, error) {
	req, err := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/repos/%s/%s/readme", apiBase, owner, repo), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/vnd.github.raw+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	res, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("github readme request: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode == http.StatusNotFound {
		return "", nil
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", fmt.Errorf("github readme %s/%s: HTTP %d", owner, repo, res.StatusCode)
	}

	body, err := io.ReadAll(res.Body)
	if err != nil {
		return "", fmt.Errorf("read readme body: %w", err)
	}
	return string(body), nil
}

// ListOrgRepos fetches all repositories for a GitHub organization (all pages).
func (c *Client) ListOrgRepos(org string) ([]Repository, error) {
	var repos []Repository
	for page := 1; ; page++ {
		var pageRepos []Repository
		path := fmt.Sprintf("/orgs/%s/repos?per_page=100&page=%d&type=all&sort=updated", org, page)
		if err := c.get(path, &pageRepos); err != nil {
			return nil, err
		}
		repos = append(repos, pageRepos...)
		if len(pageRepos) < 100 {
			break
		}
	}
	return repos, nil
}

// ParseGitHubURL parses a GitHub repository URL and returns the owner and repo name.
// Handles both https://github.com/owner/repo and github.com/owner/repo forms.
func ParseGitHubURL(rawURL string) (owner, repo string, err error) {
	u := strings.TrimPrefix(rawURL, "https://")
	u = strings.TrimPrefix(u, "http://")
	u = strings.TrimPrefix(u, "github.com/")
	u = strings.TrimSuffix(u, ".git")

	parts := strings.SplitN(strings.Trim(u, "/"), "/", 3)
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return "", "", fmt.Errorf("invalid GitHub URL: %s", rawURL)
	}
	return parts[0], parts[1], nil
}

// ExchangeOAuthCode exchanges a GitHub OAuth authorization code for an access token.
func ExchangeOAuthCode(code, clientID, clientSecret string) (string, error) {
	tokenResp, err := ExchangeOAuthCodeWithResponse(code, clientID, clientSecret)
	if err != nil {
		return "", err
	}
	return tokenResp.AccessToken, nil
}

// ExchangeOAuthCodeWithResponse exchanges a GitHub OAuth authorization code and returns token metadata.
func ExchangeOAuthCodeWithResponse(code, clientID, clientSecret string) (*OAuthTokenResponse, error) {
	params := url.Values{}
	params.Set("code", code)
	params.Set("client_id", clientID)
	params.Set("client_secret", clientSecret)

	req, err := http.NewRequest(http.MethodPost, "https://github.com/login/oauth/access_token", strings.NewReader(params.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", "Gantry/1.0")

	httpClient := &http.Client{Timeout: 15 * time.Second}
	res, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("exchange oauth code: %w", err)
	}
	defer res.Body.Close()

	var tokenResp struct {
		AccessToken           string `json:"access_token"`
		RefreshToken          string `json:"refresh_token"`
		TokenType             string `json:"token_type"`
		Scope                 string `json:"scope"`
		ExpiresIn             int    `json:"expires_in"`
		RefreshTokenExpiresIn int    `json:"refresh_token_expires_in"`
		Error                 string `json:"error"`
		ErrorDesc             string `json:"error_description"`
	}
	if err := json.NewDecoder(res.Body).Decode(&tokenResp); err != nil {
		return nil, fmt.Errorf("decode token response: %w", err)
	}
	if tokenResp.Error != "" {
		return nil, fmt.Errorf("github oauth: %s: %s", tokenResp.Error, tokenResp.ErrorDesc)
	}
	return &OAuthTokenResponse{
		AccessToken:           tokenResp.AccessToken,
		RefreshToken:          tokenResp.RefreshToken,
		TokenType:             tokenResp.TokenType,
		Scope:                 tokenResp.Scope,
		ExpiresIn:             tokenResp.ExpiresIn,
		RefreshTokenExpiresIn: tokenResp.RefreshTokenExpiresIn,
	}, nil
}

// FetchUserWithToken fetches the authenticated GitHub user using the given access token.
func FetchUserWithToken(accessToken string) (*GitHubUser, error) {
	req, err := http.NewRequest(http.MethodGet, apiBase+"/user", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "Gantry/1.0")

	httpClient := &http.Client{Timeout: 15 * time.Second}
	res, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		var ghErr struct {
			Message string `json:"message"`
		}
		_ = json.NewDecoder(res.Body).Decode(&ghErr)
		if ghErr.Message == "" {
			ghErr.Message = res.Status
		}
		return nil, fmt.Errorf("GitHub API returned HTTP %d: %s", res.StatusCode, ghErr.Message)
	}

	var user GitHubUser
	if err := json.NewDecoder(res.Body).Decode(&user); err != nil {
		return nil, err
	}
	return &user, nil
}

// FetchUserTeams fetches the GitHub teams the authenticated user belongs to.
// Requires the read:org OAuth scope. Optionally filters to a specific org.
func FetchUserTeams(accessToken, orgFilter string) ([]GitHubTeam, error) {
	req, err := http.NewRequest(http.MethodGet, apiBase+"/user/teams?per_page=100", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	httpClient := &http.Client{Timeout: 15 * time.Second}
	res, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch user teams: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(res.Body)
		return nil, fmt.Errorf("github teams API: HTTP %d: %s", res.StatusCode, string(body))
	}

	var teams []GitHubTeam
	if err := json.NewDecoder(res.Body).Decode(&teams); err != nil {
		return nil, fmt.Errorf("decode teams response: %w", err)
	}

	// Filter to specific org if provided.
	if orgFilter != "" {
		var filtered []GitHubTeam
		for _, t := range teams {
			if strings.EqualFold(t.Organization.Login, orgFilter) {
				filtered = append(filtered, t)
			}
		}
		return filtered, nil
	}

	return teams, nil
}

// appInstallationToken creates a GitHub App installation access token by:
// 1. Signing a short-lived JWT with the App's RSA private key
// 2. Exchanging it for an installation token via the GitHub API
func appInstallationToken(config map[string]any) (string, error) {
	appID, _ := config["appId"].(string)
	privateKeyPEM, _ := config["privateKey"].(string)
	installationID, _ := config["installationId"].(string)

	if appID == "" || privateKeyPEM == "" || installationID == "" {
		return "", fmt.Errorf("appId, privateKey, and installationId are required for app auth mode")
	}

	key, err := parseRSAPrivateKey(privateKeyPEM)
	if err != nil {
		return "", err
	}

	now := time.Now()
	claims := jwt.MapClaims{
		"iat": jwt.NewNumericDate(now.Add(-60 * time.Second)), // backdate 60s to avoid clock skew
		"exp": jwt.NewNumericDate(now.Add(9 * time.Minute)),
		"iss": appID,
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	appJWT, err := tok.SignedString(key)
	if err != nil {
		return "", fmt.Errorf("sign app jwt: %w", err)
	}

	req, err := http.NewRequest(
		http.MethodPost,
		fmt.Sprintf("%s/app/installations/%s/access_tokens", apiBase, installationID),
		nil,
	)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+appJWT)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	httpClient := &http.Client{Timeout: 15 * time.Second}
	res, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("get installation token: %w", err)
	}
	defer res.Body.Close()

	var tokenResp struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(res.Body).Decode(&tokenResp); err != nil {
		return "", fmt.Errorf("decode installation token: %w", err)
	}
	if tokenResp.Token == "" {
		return "", fmt.Errorf("received empty installation token from GitHub")
	}
	return tokenResp.Token, nil
}

// parseRSAPrivateKey parses a PEM-encoded RSA private key (PKCS#1 or PKCS#8).
func parseRSAPrivateKey(pemStr string) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(pemStr))
	if block == nil {
		return nil, fmt.Errorf("invalid PEM block in private key")
	}

	// Try PKCS#1 first.
	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return key, nil
	}

	// Fall back to PKCS#8.
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse private key: %w", err)
	}
	rsaKey, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("private key is not an RSA key")
	}
	return rsaKey, nil
}
