package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
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
	writeJSON(w, http.StatusOK, map[string]any{
		"ssoEnabled": ssoEnabled && clientID != "",
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

	authURL := fmt.Sprintf(
		"https://github.com/login/oauth/authorize?client_id=%s&state=%s&scope=read:user+user:email+read:org",
		clientID, state,
	)
	http.Redirect(w, r, authURL, http.StatusTemporaryRedirect)
}

// GitHubOAuthCallback handles the GitHub OAuth redirect back to Gantry.
// It validates the state, exchanges the code for a GitHub access token,
// fetches the GitHub user, finds or creates a Gantry account, issues a JWT,
// then redirects to the frontend with the token in the query string.
func (h *Handlers) GitHubOAuthCallback(w http.ResponseWriter, r *http.Request) {
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
		writeError(w, http.StatusBadGateway, "failed to exchange oauth code: "+err.Error())
		return
	}

	// Fetch GitHub user profile.
	ghUser, err := ghplugin.FetchUserWithToken(accessToken)
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to fetch GitHub user: "+err.Error())
		return
	}

	// Find existing Gantry user by GitHub login convention (username = "github:<login>"),
	// then fall back to matching by email address.
	ctx := r.Context()
	username := "github:" + ghUser.Login
	gantryUser, _ := h.DB.GetUserByUsername(ctx, username)

	if gantryUser == nil && ghUser.Email != "" {
		gantryUser, _ = h.DB.GetUserByEmail(ctx, ghUser.Email)
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
