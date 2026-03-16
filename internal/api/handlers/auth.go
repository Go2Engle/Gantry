package handlers

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go2engle/gantry/internal/api/middleware"
	"github.com/go2engle/gantry/internal/auth"
	"github.com/go2engle/gantry/internal/db"
	"github.com/go2engle/gantry/internal/events"
)

// loginRequest represents the JSON body of a login request.
type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// loginResponse represents the JSON response returned on successful login.
type loginResponse struct {
	Token string           `json:"token"`
	User  authUserResponse `json:"user"`
}

// authUserResponse is the normalized auth payload returned by both login and
// current-user endpoints. It includes the user's direct role plus their
// computed effective role, groups, and permission map.
type authUserResponse struct {
	ID            string          `json:"id"`
	UserID        string          `json:"userId"`
	Username      string          `json:"username"`
	DisplayName   string          `json:"displayName,omitempty"`
	Email         string          `json:"email,omitempty"`
	Role          string          `json:"role"`
	EffectiveRole string          `json:"effectiveRole"`
	Groups        []string        `json:"groups"`
	Permissions   map[string]bool `json:"permissions"`
}

// registerRequest represents the JSON body for user registration.
type registerRequest struct {
	Username    string `json:"username"`
	Password    string `json:"password"`
	DisplayName string `json:"displayName,omitempty"`
	Email       string `json:"email,omitempty"`
	Role        string `json:"role,omitempty"`
}

// Login handles POST /auth/login. It verifies the username and password
// against the database and returns a signed JWT on success.
func (h *Handlers) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Username == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "username and password are required")
		return
	}

	// Look up the user in the database.
	user, err := h.DB.GetUserByUsername(r.Context(), req.Username)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	// Verify the password against the stored hash.
	if err := h.Auth.CheckPassword(user.PasswordHash, req.Password); err != nil {
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	// Build the auth.User needed by GenerateToken.
	tokenUser := &auth.User{
		ID:       user.ID,
		Username: user.Username,
		Role:     user.Role,
	}

	token, err := h.Auth.GenerateToken(tokenUser)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}
	http.SetCookie(w, sessionCookie(r, token))

	// Publish login event.
	h.Events.Publish(events.Event{
		Type: events.UserLogin,
		Data: map[string]any{
			"userId":   user.ID,
			"username": user.Username,
		},
	})

	authResponse := h.buildAuthUserResponse(r.Context(), user)

	writeJSON(w, http.StatusOK, loginResponse{
		Token: token,
		User:  authResponse,
	})
}

// Logout clears the browser session cookie.
func (h *Handlers) Logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, clearSessionCookie(r))
	w.WriteHeader(http.StatusNoContent)
}

// GetMe handles GET /auth/me. It returns the currently authenticated user's
// information from the JWT claims stored in the request context, including
// their effective role (accounting for group memberships) and group names.
func (h *Handlers) GetMe(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r.Context())
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	authUser := authUserResponse{
		ID:       claims.UserID,
		UserID:   claims.UserID,
		Username: claims.Username,
		Role:     claims.Role,
	}
	if claims.UserID != "" {
		if user, err := h.DB.GetUserByID(r.Context(), claims.UserID); err == nil {
			authUser = h.buildAuthUserResponse(r.Context(), user)
		} else {
			authUser.EffectiveRole = middleware.GetEffectiveRole(r.Context())
			authUser.Groups = []string{}
			authUser.Permissions = auth.RolePermissions(authUser.EffectiveRole)
		}
	} else {
		authUser.EffectiveRole = middleware.GetEffectiveRole(r.Context())
		authUser.Groups = []string{}
		authUser.Permissions = auth.RolePermissions(authUser.EffectiveRole)
	}
	if authUser.Permissions == nil {
		authUser.Permissions = map[string]bool{}
	}

	writeJSON(w, http.StatusOK, authUser)
}

// Register handles POST /auth/register. It creates a new user account.
// This endpoint requires admin privileges (enforced by RequireRole middleware).
func (h *Handlers) Register(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Username == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "username and password are required")
		return
	}

	hash, err := h.Auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to hash password")
		return
	}

	// All new users start as viewer. Role elevation is managed through
	// groups in Access Control, not per-user assignment.
	user := &db.User{
		Username:     req.Username,
		PasswordHash: hash,
		DisplayName:  req.DisplayName,
		Email:        req.Email,
		Role:         "viewer",
	}

	if err := h.DB.CreateUser(r.Context(), user); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, user)
}

// userWithGroups extends a user with their group memberships and effective role.
type userWithGroups struct {
	*db.User
	Groups        []string `json:"groups"`
	EffectiveRole string   `json:"effectiveRole"`
}

// ListUsers handles GET /auth/users. Returns all users with their group
// memberships and computed effective roles (admin only).
func (h *Handlers) ListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := h.DB.ListUsers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list users")
		return
	}

	result := make([]userWithGroups, 0, len(users))
	for _, u := range users {
		groups, _ := h.DB.ListUserGroups(r.Context(), u.ID)
		groupNames := make([]string, 0, len(groups))
		groupRoles := make([]string, 0, len(groups))
		for _, g := range groups {
			groupNames = append(groupNames, g.Name)
			groupRoles = append(groupRoles, g.Role)
		}
		effectiveRole := auth.EffectiveRole(u.Role, groupRoles)
		result = append(result, userWithGroups{
			User:          u,
			Groups:        groupNames,
			EffectiveRole: effectiveRole,
		})
	}
	writeJSON(w, http.StatusOK, result)
}

// updateUserRequest is the body for admin user updates.
type updateUserRequest struct {
	DisplayName string `json:"displayName"`
	Email       string `json:"email"`
	Role        string `json:"role"`
}

func (h *Handlers) buildAuthUserResponse(ctx context.Context, user *db.User) authUserResponse {
	resp := authUserResponse{
		ID:          user.ID,
		UserID:      user.ID,
		Username:    user.Username,
		DisplayName: user.DisplayName,
		Email:       user.Email,
		Role:        user.Role,
		Groups:      []string{},
	}

	groupRoles := []string{}
	if groups, err := h.DB.ListUserGroups(ctx, user.ID); err == nil {
		resp.Groups = make([]string, 0, len(groups))
		groupRoles = make([]string, 0, len(groups))
		for _, g := range groups {
			resp.Groups = append(resp.Groups, g.Name)
			groupRoles = append(groupRoles, g.Role)
		}
	}

	resp.EffectiveRole = auth.EffectiveRole(user.Role, groupRoles)
	resp.Permissions = auth.RolePermissions(resp.EffectiveRole)
	if resp.Permissions == nil {
		resp.Permissions = map[string]bool{}
	}

	return resp
}

// UpdateUser handles PUT /auth/users/{id}. Allows admins to update a user's
// display name, email, and role.
func (h *Handlers) UpdateUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	user, err := h.DB.GetUserByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}

	var req updateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.DisplayName != "" {
		user.DisplayName = req.DisplayName
	}
	if req.Email != "" {
		user.Email = req.Email
	}
	if req.Role != "" {
		user.Role = req.Role
	}

	if err := h.DB.UpdateUser(r.Context(), user); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update user")
		return
	}

	writeJSON(w, http.StatusOK, user)
}

// DeleteUser handles DELETE /auth/users/{id}. Admins can delete any user
// except their own account.
func (h *Handlers) DeleteUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	claims := middleware.GetClaims(r.Context())
	if claims != nil && claims.UserID == id {
		writeError(w, http.StatusBadRequest, "cannot delete your own account")
		return
	}

	if err := h.DB.DeleteUser(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete user")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// changePasswordRequest is the body for self-service password changes.
type changePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

// ChangePassword handles PUT /auth/me/password. Any authenticated user can
// change their own password by providing their current password for verification.
func (h *Handlers) ChangePassword(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r.Context())
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	var req changePasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.CurrentPassword == "" || req.NewPassword == "" {
		writeError(w, http.StatusBadRequest, "currentPassword and newPassword are required")
		return
	}

	if len(req.NewPassword) < 8 {
		writeError(w, http.StatusBadRequest, "new password must be at least 8 characters")
		return
	}

	user, err := h.DB.GetUserByID(r.Context(), claims.UserID)
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}

	if err := h.Auth.CheckPassword(user.PasswordHash, req.CurrentPassword); err != nil {
		writeError(w, http.StatusUnauthorized, "current password is incorrect")
		return
	}

	hash, err := h.Auth.HashPassword(req.NewPassword)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to hash password")
		return
	}

	if err := h.DB.UpdateUserPassword(r.Context(), claims.UserID, hash); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update password")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "password updated successfully"})
}
