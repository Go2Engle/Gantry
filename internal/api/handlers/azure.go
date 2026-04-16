package handlers

import (
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/go2engle/gantry/internal/auth"
	"github.com/go2engle/gantry/internal/db"
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
	writeJSON(w, http.StatusOK, map[string]any{
		"ssoEnabled": azureSSOConfigured(p.Config, ssoEnabled),
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
	if !azureSSOConfigured(p.Config, ssoEnabled) {
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
	stateCookie, err := r.Cookie("az_oauth_state")
	if err != nil || r.URL.Query().Get("state") != stateCookie.Value {
		writeError(w, http.StatusBadRequest, "invalid or missing oauth state")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "az_oauth_state",
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
	if !azureSSOConfigured(p.Config, ssoEnabled) {
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
	username := azureUsername(claims, msUser, tenantID)
	gantryUser, _ := h.DB.GetUserByUsername(ctx, username)

	email := azureEmail(claims, msUser)
	if gantryUser == nil && email != "" {
		usersByEmail, err := h.DB.GetUsersByEmail(ctx, email)
		if err == nil {
			switch len(usersByEmail) {
			case 1:
				gantryUser = usersByEmail[0]
			case 0:
			default:
				log.Printf("azure auth: email hash %s matched %d Gantry users; refusing ambiguous SSO lookup", hashEmailForLog(email), len(usersByEmail))
			}
		}
	}

	returnTo := ""
	if c, err := r.Cookie("az_oauth_return_to"); err == nil && c.Value != "" {
		returnTo = normalizeReturnTo(r, c.Value)
		http.SetCookie(w, &http.Cookie{
			Name:     "az_oauth_return_to",
			Value:    "",
			Path:     "/",
			MaxAge:   -1,
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			Secure:   isHTTPSRequest(r),
		})
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
		if err := h.DB.CreateUser(ctx, newUser); err != nil {
			gantryUser, _ = h.DB.GetUserByUsername(ctx, username)
			if gantryUser == nil {
				writeError(w, http.StatusInternalServerError, "failed to create user: "+err.Error())
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

func azureUsername(claims *azplugin.IdentityClaims, user *azplugin.MicrosoftUser, configuredTenant string) string {
	if claims != nil && claims.TID != "" && claims.OID != "" {
		return fmt.Sprintf("azure:%s:%s", strings.ToLower(claims.TID), strings.ToLower(claims.OID))
	}
	if user != nil && user.ID != "" {
		tenant := strings.TrimSpace(configuredTenant)
		if claims != nil && claims.TID != "" {
			tenant = claims.TID
		}
		if tenant != "" && !strings.EqualFold(tenant, "common") && !strings.EqualFold(tenant, "organizations") && !strings.EqualFold(tenant, "consumers") {
			return fmt.Sprintf("azure:%s:%s", strings.ToLower(tenant), strings.ToLower(user.ID))
		}
		return "azure:" + strings.ToLower(user.ID)
	}
	if email := azureEmail(claims, user); email != "" {
		return "azure:" + strings.ToLower(email)
	}
	if claims != nil && claims.PreferredUsername != "" {
		return "azure:" + strings.ToLower(claims.PreferredUsername)
	}
	if user != nil && user.UserPrincipalName != "" {
		return "azure:" + strings.ToLower(user.UserPrincipalName)
	}
	return "azure:unknown"
}

func azureEmail(claims *azplugin.IdentityClaims, user *azplugin.MicrosoftUser) string {
	if user != nil && strings.TrimSpace(user.Mail) != "" {
		return strings.TrimSpace(user.Mail)
	}
	if claims != nil && strings.TrimSpace(claims.Email) != "" {
		return strings.TrimSpace(claims.Email)
	}
	if user != nil && strings.TrimSpace(user.UserPrincipalName) != "" {
		return strings.TrimSpace(user.UserPrincipalName)
	}
	if claims != nil {
		return strings.TrimSpace(claims.PreferredUsername)
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

func azureSSOConfigured(config map[string]any, ssoEnabled bool) bool {
	if !ssoEnabled {
		return false
	}
	clientID, _ := config["clientId"].(string)
	clientSecret, _ := config["clientSecret"].(string)
	return strings.TrimSpace(clientID) != "" && strings.TrimSpace(clientSecret) != ""
}
