package handlers

import (
	"errors"
	"fmt"
	"log"
	"net/mail"
	"net/http"
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
	if err != nil || r.URL.Query().Get("state") != stateCookie.Value {
		writeError(w, http.StatusBadRequest, "invalid or missing oauth state")
		return
	}

	code := r.URL.Query().Get("code")
	if code == "" {
		writeError(w, http.StatusBadRequest, "missing oauth code")
		return
	}

	p, err := h.DB.GetPlugin(r.Context(), "microsoft-azure")
	if err != nil || p == nil || !p.Enabled {
		writeError(w, http.StatusInternalServerError, "Microsoft Azure plugin unavailable")
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
			Role:         defaultRole,
			SSOOnly:      true,
		}
		if createErr := h.DB.CreateUser(ctx, newUser); createErr != nil {
			gantryUser, err = h.DB.GetUserByUsername(ctx, username)
			if err != nil && !errors.Is(err, entity.ErrEntityNotFound) {
				writeSSOProviderError(w, "Microsoft Azure", "lookup Gantry user after create conflict", err)
				return
			}
			if gantryUser == nil {
				writeError(w, http.StatusInternalServerError, "failed to create user: "+createErr.Error())
				return
			}
		} else {
			gantryUser = newUser
		}
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
