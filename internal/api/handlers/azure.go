package handlers

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/mail"
	"strings"

	"github.com/go2engle/gantry/internal/auth"
	"github.com/go2engle/gantry/internal/db"
	"github.com/go2engle/gantry/internal/entity"
	azplugin "github.com/go2engle/gantry/internal/plugins/azure"
)

// GetAzureSSOConfig returns whether Microsoft Azure SSO is enabled.
func (h *Handlers) GetAzureSSOConfig(w http.ResponseWriter, r *http.Request) {
	p, err := h.DB.GetPlugin(r.Context(), "microsoft-azure")
	if err != nil || p == nil || !p.Enabled {
		writeJSON(w, http.StatusOK, map[string]any{"ssoEnabled": false})
		return
	}
	ssoEnabled, _ := p.Config["ssoEnabled"].(bool)
	clientID, _ := p.Config["clientId"].(string)
	clientSecret, _ := p.Config["clientSecret"].(string)
	writeJSON(w, http.StatusOK, map[string]any{
		"ssoEnabled": azureSSOConfigured(ssoEnabled, clientID, clientSecret),
	})
}

// AzureOAuthBegin redirects the browser to the Microsoft identity platform.
func (h *Handlers) AzureOAuthBegin(w http.ResponseWriter, r *http.Request) {
	p, err := h.DB.GetPlugin(r.Context(), "microsoft-azure")
	if err != nil || p == nil || !p.Enabled {
		writeError(w, http.StatusNotFound, "Microsoft Azure plugin not installed or not enabled")
		return
	}

	ssoEnabled, _ := p.Config["ssoEnabled"].(bool)
	clientID, _ := p.Config["clientId"].(string)
	clientSecret, _ := p.Config["clientSecret"].(string)
	if !azureSSOConfigured(ssoEnabled, clientID, clientSecret) {
		writeError(w, http.StatusBadRequest, "Microsoft Azure SSO is not configured")
		return
	}

	state, err := randomHex16()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate state")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "az_oauth_state",
		Value:    state,
		Path:     "/",
		MaxAge:   600,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isHTTPSRequest(r),
	})

	if returnTo := normalizeReturnTo(r, r.URL.Query().Get("return_to")); returnTo != "" {
		http.SetCookie(w, &http.Cookie{
			Name:     "az_oauth_return_to",
			Value:    returnTo,
			Path:     "/",
			MaxAge:   600,
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			Secure:   isHTTPSRequest(r),
		})
	}

	tenantID, _ := p.Config["tenantId"].(string)
	scopes, _ := p.Config["scopes"].(string)
	redirectURI := requestOrigin(r) + "/api/v1/auth/azure/callback"
	authURL := azplugin.AuthorizationURL(tenantID, clientID, redirectURI, state, scopes)
	http.Redirect(w, r, authURL, http.StatusTemporaryRedirect)
}

// AzureOAuthCallback handles the Microsoft OAuth redirect back to Gantry.
func (h *Handlers) AzureOAuthCallback(w http.ResponseWriter, r *http.Request) {
	returnTo := ""
	if c, err := r.Cookie("az_oauth_return_to"); err == nil && c.Value != "" {
		returnTo = normalizeReturnTo(r, c.Value)
	}
	clearAzureOAuthCookies(w, r)

	stateCookie, err := r.Cookie("az_oauth_state")
	queryState := strings.TrimSpace(r.URL.Query().Get("state"))
	if err != nil || strings.TrimSpace(stateCookie.Value) == "" || queryState == "" || queryState != stateCookie.Value {
		writeError(w, http.StatusBadRequest, "invalid or missing oauth state")
		return
	}

	code := r.URL.Query().Get("code")
	if code == "" {
		writeError(w, http.StatusBadRequest, "missing oauth code")
		return
	}

	p, err := h.DB.GetPlugin(r.Context(), "microsoft-azure")
	if err != nil {
		writeSSOProviderError(w, "Microsoft Azure", "load plugin configuration", err)
		return
	}
	if p == nil || !p.Enabled {
		writeError(w, http.StatusBadRequest, "Microsoft Azure plugin not installed or not enabled")
		return
	}

	clientID, _ := p.Config["clientId"].(string)
	clientSecret, _ := p.Config["clientSecret"].(string)
	tenantID, _ := p.Config["tenantId"].(string)
	scopes, _ := p.Config["scopes"].(string)
	ssoEnabled, _ := p.Config["ssoEnabled"].(bool)
	defaultRole, _ := p.Config["defaultRole"].(string)
	if defaultRole == "" {
		defaultRole = "viewer"
	}
	if !azureSSOConfigured(ssoEnabled, clientID, clientSecret) {
		writeError(w, http.StatusBadRequest, "Microsoft Azure SSO is not configured")
		return
	}

	redirectURI := requestOrigin(r) + "/api/v1/auth/azure/callback"
	tokenResp, err := azplugin.ExchangeOAuthCode(code, clientID, clientSecret, tenantID, redirectURI, scopes)
	if err != nil {
		writeSSOProviderError(w, "Microsoft Azure", "exchange oauth code", err)
		return
	}

	claims, err := azplugin.ParseIdentityClaims(tokenResp.IDToken, tenantID, clientID)
	if err != nil {
		writeSSOProviderError(w, "Microsoft Azure", "parse id token", err)
		return
	}

	msUser, err := azplugin.FetchUserWithToken(tokenResp.AccessToken)
	if err != nil {
		writeSSOProviderError(w, "Microsoft Azure", "fetch Microsoft Graph user", err)
		return
	}

	ctx := r.Context()
	username, err := azureUsername(claims)
	if err != nil {
		writeSSOProviderError(w, "Microsoft Azure", "derive identity", err)
		return
	}
	gantryUser, err := h.DB.GetUserByUsername(ctx, username)
	if err != nil && !errors.Is(err, entity.ErrEntityNotFound) {
		writeSSOProviderError(w, "Microsoft Azure", "lookup Gantry user by username", err)
		return
	}

	email := azureEmail(claims, msUser)
	if gantryUser == nil && email != "" {
		usersByEmail, err := h.DB.GetUsersByEmail(ctx, email)
		if err != nil {
			writeSSOProviderError(w, "Microsoft Azure", "lookup Gantry users by email", err)
			return
		}
		switch len(usersByEmail) {
		case 1:
			gantryUser = usersByEmail[0]
		case 0:
		default:
			log.Printf("azure auth: email hash %s matched %d Gantry users; refusing ambiguous SSO lookup", hashEmailForLog(email), len(usersByEmail))
		}
	}

	if gantryUser == nil {
		autoProvision := false
		if v, ok := p.Config["autoProvision"].(bool); ok {
			autoProvision = v
		}

		if !autoProvision {
			errorURL := "/login?error=sso_not_authorized"
			if returnTo != "" {
				errorURL = returnTo + "/login?error=sso_not_authorized"
			}
			http.Redirect(w, r, errorURL, http.StatusTemporaryRedirect)
			return
		}

		newUser := &db.User{
			Username:     username,
			PasswordHash: "",
			DisplayName:  azureDisplayName(claims, msUser),
			Email:        email,
			Role:         "viewer",
			SSOOnly:      true,
		}
		if createErr := h.DB.CreateUser(ctx, newUser); createErr != nil {
			gantryUser, err = h.DB.GetUserByUsername(ctx, username)
			if err != nil && !errors.Is(err, entity.ErrEntityNotFound) {
				writeSSOProviderError(w, "Microsoft Azure", "lookup Gantry user after create conflict", err)
				return
			}
			if gantryUser == nil {
				writeSSOProviderError(w, "Microsoft Azure", "create Gantry user", createErr)
				return
			}
		} else {
			gantryUser = newUser
		}
	}

	if err := h.syncAzureUserProfile(ctx, gantryUser, azureDisplayName(claims, msUser), email); err != nil {
		writeSSOProviderError(w, "Microsoft Azure", "sync Gantry user profile", err)
		return
	}
	if err := h.ensureAzureDefaultAccess(ctx, gantryUser, defaultRole); err != nil {
		writeSSOProviderError(w, "Microsoft Azure", "apply default access", err)
		return
	}

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

	redirectURL := "/"
	if returnTo != "" {
		redirectURL = returnTo + "/"
	}
	http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
}

func azureUsername(claims *azplugin.IdentityClaims) (string, error) {
	if claims != nil && claims.TID != "" && claims.OID != "" {
		return fmt.Sprintf("azure:%s:%s", strings.ToLower(claims.TID), strings.ToLower(claims.OID)), nil
	}
	return "", fmt.Errorf("validated Microsoft Azure identity is missing tenant or object identifier")
}

func azureEmail(claims *azplugin.IdentityClaims, user *azplugin.MicrosoftUser) string {
	if user != nil {
		if email := normalizeAzureEmail(user.Mail); email != "" {
			return email
		}
	}
	if claims != nil {
		if email := normalizeAzureEmail(claims.Email); email != "" {
			return email
		}
	}
	if user != nil {
		if email := normalizeAzureEmail(user.UserPrincipalName); email != "" {
			return email
		}
	}
	if claims != nil {
		if email := normalizeAzureEmail(claims.PreferredUsername); email != "" {
			return email
		}
	}
	return ""
}

func azureDisplayName(claims *azplugin.IdentityClaims, user *azplugin.MicrosoftUser) string {
	if user != nil && strings.TrimSpace(user.DisplayName) != "" {
		return strings.TrimSpace(user.DisplayName)
	}
	if claims != nil && strings.TrimSpace(claims.Name) != "" {
		return strings.TrimSpace(claims.Name)
	}
	if user != nil && strings.TrimSpace(user.UserPrincipalName) != "" {
		return strings.TrimSpace(user.UserPrincipalName)
	}
	if email := azureEmail(claims, user); email != "" {
		return email
	}
	return "Microsoft Azure User"
}

func (h *Handlers) syncAzureUserProfile(ctx context.Context, user *db.User, displayName, email string) error {
	if user == nil {
		return nil
	}

	displayName = strings.TrimSpace(displayName)
	email = strings.TrimSpace(email)
	updated := false

	if displayName != "" && user.DisplayName != displayName {
		user.DisplayName = displayName
		updated = true
	}
	if email != "" && !strings.EqualFold(user.Email, email) {
		user.Email = email
		updated = true
	}
	if !updated {
		return nil
	}
	return h.DB.UpdateUser(ctx, user)
}

func (h *Handlers) ensureAzureDefaultAccess(ctx context.Context, user *db.User, defaultRole string) error {
	if user == nil || !user.SSOOnly || !strings.HasPrefix(strings.ToLower(user.Username), "azure:") {
		return nil
	}

	groupRole, fallbackRole := azureDefaultAccess(defaultRole)
	if groupRole == "" && fallbackRole == "viewer" {
		return nil
	}

	groups, err := h.DB.ListUserGroups(ctx, user.ID)
	if err != nil {
		return err
	}
	if len(groups) > 0 || auth.RoleLevel(user.Role) > auth.RoleLevel("viewer") {
		return nil
	}

	if groupRole != "" {
		if err := h.DB.AddUserToGroupByName(ctx, user.ID, groupRole); err == nil {
			return nil
		}
	}

	if fallbackRole == "" || user.Role == fallbackRole {
		return nil
	}
	user.Role = fallbackRole
	return h.DB.UpdateUser(ctx, user)
}

func azureDefaultAccess(defaultRole string) (groupName, fallbackRole string) {
	role := strings.ToLower(strings.TrimSpace(defaultRole))
	if role == "" {
		role = "viewer"
	}

	switch role {
	case "admin":
		return "admins", role
	case "platform-engineer":
		return "platform-engineers", role
	case "developer":
		return "developers", role
	case "viewer":
		return "", role
	default:
		if auth.IsValidRole(role) {
			return "", role
		}
		return "", "viewer"
	}
}

func azureSSOConfigured(ssoEnabled bool, clientID, clientSecret string) bool {
	if !ssoEnabled {
		return false
	}
	return strings.TrimSpace(clientID) != "" && strings.TrimSpace(clientSecret) != ""
}

func normalizeAzureEmail(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	addr, err := mail.ParseAddress(value)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(addr.Address)
}

func clearAzureOAuthCookies(w http.ResponseWriter, r *http.Request) {
	for _, name := range []string{"az_oauth_state", "az_oauth_return_to"} {
		http.SetCookie(w, &http.Cookie{
			Name:     name,
			Value:    "",
			Path:     "/",
			MaxAge:   -1,
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			Secure:   isHTTPSRequest(r),
		})
	}
}
