package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"

	"github.com/go2engle/gantry/internal/auth"
	"github.com/go2engle/gantry/internal/db"
	ghplugin "github.com/go2engle/gantry/internal/plugins/github"
)

// GetGitHubSSOConfig returns whether GitHub SSO is enabled (public endpoint,
// used by the login page to show/hide the SSO button).
func (h *Handlers) GetGitHubSSOConfig(w http.ResponseWriter, r *http.Request) {
	p, err := h.DB.GetPlugin(r.Context(), "github")
	if err != nil || p == nil || !p.Enabled {
		writeJSON(w, http.StatusOK, map[string]any{"ssoEnabled": false})
		return
	}
	ssoEnabled, _ := p.Config["ssoEnabled"].(bool)
	clientID, _ := p.Config["oauthClientId"].(string)
	dispatchAsUser, _ := p.Config["dispatchAsUser"].(bool)
	oauthConfigured := clientID != ""
	writeJSON(w, http.StatusOK, map[string]any{
		"ssoEnabled":     ssoEnabled && oauthConfigured,
		"dispatchAsUser": dispatchAsUser && oauthConfigured,
	})
}

// GitHubOAuthBegin redirects the browser to GitHub's OAuth authorization page.
// This is a public endpoint — the user is not yet authenticated.
func (h *Handlers) GitHubOAuthBegin(w http.ResponseWriter, r *http.Request) {
	p, err := h.DB.GetPlugin(r.Context(), "github")
	if err != nil || p == nil || !p.Enabled {
		writeError(w, http.StatusNotFound, "GitHub plugin not installed or not enabled")
		return
	}
	ssoEnabled, _ := p.Config["ssoEnabled"].(bool)
	clientID, _ := p.Config["oauthClientId"].(string)
	if !ssoEnabled || clientID == "" {
		writeError(w, http.StatusBadRequest, "GitHub SSO is not configured")
		return
	}

	state, err := randomHex16()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate state")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "gh_oauth_state",
		Value:    state,
		Path:     "/",
		MaxAge:   600,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isHTTPSRequest(r),
	})

	// Store the frontend origin so the callback can redirect back to the
	// correct host:port (e.g. localhost:3000 in dev with a Vite proxy).
	if returnTo := normalizeReturnTo(r, r.URL.Query().Get("return_to")); returnTo != "" {
		http.SetCookie(w, &http.Cookie{
			Name:     "gh_oauth_return_to",
			Value:    returnTo,
			Path:     "/",
			MaxAge:   600,
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			Secure:   isHTTPSRequest(r),
		})
	}

	authURL := githubOAuthAuthorizeURL(clientID, state, []string{"read:user", "user:email", "read:org"})
	http.Redirect(w, r, authURL, http.StatusTemporaryRedirect)
}

// GitHubOAuthTokenBegin starts a short-lived OAuth flow for user-attributed
// GitHub API calls. The returned token is posted back to the opener window and
// is not persisted by Gantry.
func (h *Handlers) GitHubOAuthTokenBegin(w http.ResponseWriter, r *http.Request) {
	p, err := h.DB.GetPlugin(r.Context(), "github")
	if err != nil || p == nil || !p.Enabled {
		writeError(w, http.StatusNotFound, "GitHub plugin not installed or not enabled")
		return
	}
	clientID, _ := p.Config["oauthClientId"].(string)
	if clientID == "" {
		writeError(w, http.StatusBadRequest, "GitHub OAuth client is not configured")
		return
	}
	if dispatchAsUser, _ := p.Config["dispatchAsUser"].(bool); !dispatchAsUser {
		writeError(w, http.StatusBadRequest, "GitHub user-attributed action dispatch is not enabled")
		return
	}

	state, err := randomHex16()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate state")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "gh_oauth_token_state",
		Value:    state,
		Path:     "/",
		MaxAge:   600,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isHTTPSRequest(r),
	})

	authURL := githubOAuthAuthorizeURL(clientID, state, githubActionOAuthScopes(p.Config))
	http.Redirect(w, r, authURL, http.StatusTemporaryRedirect)
}

// GitHubOAuthCallback handles the GitHub OAuth redirect back to Gantry.
// It validates the state, exchanges the code for a GitHub access token,
// fetches the GitHub user, finds or creates a Gantry account, issues a JWT,
// then redirects to the frontend with the token in the query string.
func (h *Handlers) GitHubOAuthCallback(w http.ResponseWriter, r *http.Request) {
	if tokenStateCookie, err := r.Cookie("gh_oauth_token_state"); err == nil &&
		tokenStateCookie.Value != "" &&
		tokenStateCookie.Value == r.URL.Query().Get("state") {
		h.githubOAuthTokenCallback(w, r, tokenStateCookie.Value)
		return
	}

	// Validate OAuth state to prevent CSRF.
	stateCookie, err := r.Cookie("gh_oauth_state")
	if err != nil || r.URL.Query().Get("state") != stateCookie.Value {
		writeError(w, http.StatusBadRequest, "invalid or missing oauth state")
		return
	}
	// Clear state cookie.
	http.SetCookie(w, &http.Cookie{
		Name:     "gh_oauth_state",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isHTTPSRequest(r),
	})

	code := r.URL.Query().Get("code")
	if code == "" {
		writeError(w, http.StatusBadRequest, "missing oauth code")
		return
	}

	p, err := h.DB.GetPlugin(r.Context(), "github")
	if err != nil || p == nil || !p.Enabled {
		writeError(w, http.StatusInternalServerError, "GitHub plugin unavailable")
		return
	}
	clientID, _ := p.Config["oauthClientId"].(string)
	clientSecret, _ := p.Config["oauthClientSecret"].(string)
	defaultRole, _ := p.Config["defaultRole"].(string)
	if defaultRole == "" {
		defaultRole = "viewer"
	}

	// Exchange code → GitHub access token.
	accessToken, err := ghplugin.ExchangeOAuthCode(code, clientID, clientSecret)
	if err != nil {
		writeSSOProviderError(w, "GitHub", "exchange oauth code", err)
		return
	}

	// Fetch GitHub user profile.
	ghUser, err := ghplugin.FetchUserWithToken(accessToken)
	if err != nil {
		writeSSOProviderError(w, "GitHub", "fetch GitHub user", err)
		return
	}

	// Find existing Gantry user by GitHub login convention (username = "github:<login>"),
	// then fall back to matching by email address.
	ctx := r.Context()
	username := "github:" + ghUser.Login
	gantryUser, _ := h.DB.GetUserByUsername(ctx, username)

	if gantryUser == nil && ghUser.Email != "" {
		usersByEmail, err := h.DB.GetUsersByEmail(ctx, ghUser.Email)
		if err == nil {
			switch len(usersByEmail) {
			case 1:
				gantryUser = usersByEmail[0]
			case 0:
			default:
				log.Printf("github auth: email hash %s matched %d Gantry users; refusing ambiguous SSO lookup", hashEmailForLog(ghUser.Email), len(usersByEmail))
			}
		}
	}

	// Determine the return URL for redirects (including error redirects).
	returnTo := ""
	if c, err := r.Cookie("gh_oauth_return_to"); err == nil && c.Value != "" {
		returnTo = normalizeReturnTo(r, c.Value)
		http.SetCookie(w, &http.Cookie{
			Name:     "gh_oauth_return_to",
			Value:    "",
			Path:     "/",
			MaxAge:   -1,
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			Secure:   isHTTPSRequest(r),
		})
	}

	if gantryUser == nil {
		// Check if auto-provisioning is enabled (default: false).
		autoProvision := false
		if v, ok := p.Config["autoProvision"].(bool); ok {
			autoProvision = v
		}

		if !autoProvision {
			// User not pre-authorized — redirect to login with error.
			errorURL := "/login?error=sso_not_authorized"
			if returnTo != "" {
				errorURL = returnTo + "/login?error=sso_not_authorized"
			}
			http.Redirect(w, r, errorURL, http.StatusTemporaryRedirect)
			return
		}

		// Auto-provision a new Gantry user for this GitHub identity.
		displayName := ghUser.Name
		if displayName == "" {
			displayName = ghUser.Login
		}
		newUser := &db.User{
			Username:     username,
			PasswordHash: "", // SSO users have no local password
			DisplayName:  displayName,
			Email:        ghUser.Email,
			Role:         defaultRole,
			SSOOnly:      true,
		}
		if err := h.DB.CreateUser(ctx, newUser); err != nil {
			// If username already exists (race), try to fetch again.
			gantryUser, _ = h.DB.GetUserByUsername(ctx, username)
			if gantryUser == nil {
				writeError(w, http.StatusInternalServerError, "failed to create user: "+err.Error())
				return
			}
		} else {
			gantryUser = newUser
		}
	}

	// Sync GitHub teams → Gantry groups (if enabled).
	syncTeams, _ := p.Config["syncTeams"].(bool)
	orgName, _ := p.Config["orgName"].(string)
	if syncTeams && orgName != "" {
		h.syncGitHubTeams(r, accessToken, orgName, p.Config, gantryUser)
	}

	// Issue a Gantry JWT.
	token, err := h.Auth.GenerateToken(&auth.User{
		ID:       gantryUser.ID,
		Username: gantryUser.Username,
		Role:     gantryUser.Role,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}
	http.SetCookie(w, sessionCookie(r, token))

	// Redirect back to the SPA after setting the HttpOnly session cookie.
	redirectURL := "/"
	if returnTo != "" {
		redirectURL = returnTo + "/"
	}
	http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
}

func githubActionOAuthScopes(config map[string]any) []string {
	if configured, _ := config["userTokenScopes"].(string); configured != "" {
		scopes := strings.Fields(strings.ReplaceAll(configured, ",", " "))
		if len(scopes) > 0 {
			return scopes
		}
	}
	return []string{"read:user", "user:email", "read:org", "repo", "workflow"}
}

func githubOAuthAuthorizeURL(clientID, state string, scopes []string) string {
	values := url.Values{}
	values.Set("client_id", clientID)
	values.Set("state", state)
	values.Set("scope", strings.Join(scopes, " "))
	return "https://github.com/login/oauth/authorize?" + values.Encode()
}

func (h *Handlers) githubOAuthTokenCallback(w http.ResponseWriter, r *http.Request, expectedState string) {
	http.SetCookie(w, &http.Cookie{
		Name:     "gh_oauth_token_state",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isHTTPSRequest(r),
	})

	if expectedState == "" || r.URL.Query().Get("state") != expectedState {
		writeGitHubTokenPopup(w, "", "", "invalid or missing oauth state")
		return
	}
	code := r.URL.Query().Get("code")
	if code == "" {
		writeGitHubTokenPopup(w, "", "", "missing oauth code")
		return
	}

	p, err := h.DB.GetPlugin(r.Context(), "github")
	if err != nil || p == nil || !p.Enabled {
		writeGitHubTokenPopup(w, "", "", "GitHub plugin unavailable")
		return
	}
	clientID, _ := p.Config["oauthClientId"].(string)
	clientSecret, _ := p.Config["oauthClientSecret"].(string)
	accessToken, err := ghplugin.ExchangeOAuthCode(code, clientID, clientSecret)
	if err != nil {
		log.Printf("github token auth: exchange oauth code failed: %v", err)
		writeGitHubTokenPopup(w, "", "", "failed to exchange oauth code")
		return
	}
	ghUser, err := ghplugin.FetchUserWithToken(accessToken)
	if err != nil {
		log.Printf("github token auth: fetch GitHub user failed: %v", err)
		writeGitHubTokenPopup(w, "", "", "failed to fetch GitHub user")
		return
	}
	writeGitHubTokenPopup(w, accessToken, ghUser.Login, "")
}

func writeGitHubTokenPopup(w http.ResponseWriter, token, login, errMsg string) {
	payload := map[string]string{
		"type":  "gantry:github-token",
		"token": token,
		"login": login,
		"error": errMsg,
	}
	payloadJSON, _ := json.Marshal(payload)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprintf(w, `<!doctype html>
<html>
<body>
<script>
  if (window.opener) {
    window.opener.postMessage(%s, window.location.origin);
  }
  window.close();
</script>
</body>
</html>`, payloadJSON)
}

// GetGitHubRepo fetches live repository info from GitHub for a given URL.
// Query param: ?url=https://github.com/owner/repo
func (h *Handlers) GetGitHubRepo(w http.ResponseWriter, r *http.Request) {
	repoURL := r.URL.Query().Get("url")
	if repoURL == "" {
		writeError(w, http.StatusBadRequest, "url query param is required")
		return
	}
	if !strings.Contains(repoURL, "github.com") {
		writeError(w, http.StatusBadRequest, "only github.com URLs are supported")
		return
	}

	owner, repo, err := ghplugin.ParseGitHubURL(repoURL)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid GitHub URL: "+err.Error())
		return
	}

	p, err := h.DB.GetPlugin(r.Context(), "github")
	if err != nil || p == nil {
		writeError(w, http.StatusNotFound, "GitHub plugin not installed")
		return
	}
	if !p.Enabled {
		writeError(w, http.StatusBadRequest, "GitHub plugin is not enabled")
		return
	}

	client, err := ghplugin.NewClient(p.Config)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "GitHub client error: "+err.Error())
		return
	}

	repoInfo, err := client.GetRepo(owner, repo)
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to fetch repo: "+err.Error())
		return
	}

	commits, _ := client.GetCommits(owner, repo, 5)
	prs, _ := client.GetPullRequests(owner, repo, 10)
	readme, _ := client.GetReadme(owner, repo)
	latestRelease, _ := client.GetLatestRelease(owner, repo)

	// Ensure slices are never null in JSON.
	if commits == nil {
		commits = []ghplugin.Commit{}
	}
	if prs == nil {
		prs = []ghplugin.PullRequest{}
	}

	writeJSON(w, http.StatusOK, ghplugin.RepoInfo{
		Repo:          repoInfo,
		Commits:       commits,
		PullRequests:  prs,
		Readme:        readme,
		LatestRelease: latestRelease,
	})
}

// GetGitHubWiki fetches GitHub wiki metadata and optionally a page's markdown.
// Query params:
//   - url: repository URL (https://github.com/owner/repo)
//   - page: optional wiki page slug/title
//   - content=false: list pages without returning page markdown
func (h *Handlers) GetGitHubWiki(w http.ResponseWriter, r *http.Request) {
	repoURL := r.URL.Query().Get("url")
	if repoURL == "" {
		writeError(w, http.StatusBadRequest, "url query param is required")
		return
	}
	if !strings.Contains(repoURL, "github.com") {
		writeError(w, http.StatusBadRequest, "only github.com URLs are supported")
		return
	}

	owner, repo, err := ghplugin.ParseGitHubURL(repoURL)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid GitHub URL: "+err.Error())
		return
	}

	p, err := h.DB.GetPlugin(r.Context(), "github")
	if err != nil || p == nil {
		writeError(w, http.StatusNotFound, "GitHub plugin not installed")
		return
	}
	if !p.Enabled {
		writeError(w, http.StatusBadRequest, "GitHub plugin is not enabled")
		return
	}

	client, err := ghplugin.NewClient(p.Config)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "GitHub client error: "+err.Error())
		return
	}

	includeContent := r.URL.Query().Get("content") != "false"
	wiki, err := client.GetWiki(r.Context(), owner, repo, h.DataDir, r.URL.Query().Get("page"), includeContent)
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to fetch wiki: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, wiki)
}

// requestHostname returns just the hostname from r.Host, stripping any port.
func requestHostname(r *http.Request) string {
	host := r.Host
	if h, _, found := strings.Cut(host, ":"); found {
		return h
	}
	return host
}

// randomHex16 generates 16 random bytes as a hex string.
func randomHex16() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// syncGitHubTeams fetches the user's GitHub teams and syncs them as Gantry groups.
func (h *Handlers) syncGitHubTeams(r *http.Request, accessToken, orgName string, pluginConfig map[string]any, user *db.User) {
	teams, err := ghplugin.FetchUserTeams(accessToken, orgName)
	if err != nil {
		// Best effort — don't fail the login flow.
		return
	}

	// Build team→role mapping from plugin config.
	teamRoleMap := make(map[string]string)
	if mappings, ok := pluginConfig["teamRoleMappings"].([]any); ok {
		for _, m := range mappings {
			if entry, ok := m.(map[string]any); ok {
				name, _ := entry["name"].(string)
				role, _ := entry["role"].(string)
				if name != "" && role != "" {
					teamRoleMap[name] = role
				}
			}
		}
	}

	defaultRole, _ := pluginConfig["defaultRole"].(string)
	if defaultRole == "" {
		defaultRole = "viewer"
	}

	ctx := r.Context()
	var groupIDs []string

	for _, team := range teams {
		sourceID := orgName + "/" + team.Slug

		// Find or create the group.
		g, err := h.DB.GetGroupByName(ctx, sourceID)
		if err != nil {
			// Group doesn't exist — create it.
			role := defaultRole
			if mapped, ok := teamRoleMap[team.Slug]; ok {
				role = mapped
			}
			g = &db.Group{
				Name:        sourceID,
				DisplayName: team.Name,
				Description: team.Description,
				Source:      "github",
				SourceID:    sourceID,
				Role:        role,
			}
			if err := h.DB.CreateGroup(ctx, g); err != nil {
				continue
			}
		} else {
			// Update role from mapping if configured.
			if mapped, ok := teamRoleMap[team.Slug]; ok && g.Role != mapped {
				g.Role = mapped
				_ = h.DB.UpdateGroup(ctx, g)
			}
		}

		groupIDs = append(groupIDs, g.ID)
	}

	// Sync user's group memberships — replace all with current teams.
	_ = h.DB.SyncUserGroups(ctx, user.ID, groupIDs)
}
