package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go2engle/gantry/internal/api/middleware"
	"github.com/go2engle/gantry/internal/auth"
	"github.com/go2engle/gantry/internal/db"
	"github.com/go2engle/gantry/internal/entity"
	"github.com/go2engle/gantry/internal/events"
	"github.com/go2engle/gantry/internal/plugins"
)

type flowSettingsResponse struct {
	ShowInSidebar bool   `json:"showInSidebar"`
	EditorRole    string `json:"editorRole"`
	CanEdit       bool   `json:"canEdit"`
}

const maxFlowEntityRequestBytes int64 = 1 << 20

func flowEditorRole(config map[string]any) string {
	role, _ := config["editorRole"].(string)
	role = strings.TrimSpace(role)
	if role == "" || !auth.IsValidRole(role) {
		return "developer"
	}
	return role
}

func flowShowInSidebar(config map[string]any) bool {
	show, ok := config["showInSidebar"].(bool)
	if !ok {
		return true
	}
	return show
}

func (h *Handlers) getFlowPlugin(r *http.Request) (*plugins.Plugin, error) {
	plugin, err := h.DB.GetPlugin(r.Context(), "flow")
	if err != nil {
		return nil, err
	}
	if plugin == nil {
		return nil, plugins.ErrPluginNotInstalled
	}
	return plugin, nil
}

func (h *Handlers) getFlowSettings(r *http.Request) (*plugins.Plugin, flowSettingsResponse, error) {
	plugin, err := h.getFlowPlugin(r)
	if err != nil {
		return nil, flowSettingsResponse{}, err
	}

	editorRole := flowEditorRole(plugin.Config)
	effectiveRole := middleware.GetEffectiveRole(r.Context())
	canEdit := auth.RoleLevel(effectiveRole) >= auth.RoleLevel(editorRole)

	return plugin, flowSettingsResponse{
		ShowInSidebar: flowShowInSidebar(plugin.Config),
		EditorRole:    editorRole,
		CanEdit:       canEdit,
	}, nil
}

func (h *Handlers) ensureFlowWriteAccess(w http.ResponseWriter, r *http.Request) bool {
	plugin, settings, err := h.getFlowSettings(r)
	if err != nil {
		if errors.Is(err, plugins.ErrPluginNotInstalled) {
			writeError(w, http.StatusNotFound, "flow plugin not installed")
			return false
		}
		writeError(w, http.StatusInternalServerError, "failed to load flow plugin")
		return false
	}
	if !plugin.Enabled {
		writeError(w, http.StatusBadRequest, "flow plugin is not enabled")
		return false
	}
	if !settings.CanEdit {
		writeError(w, http.StatusForbidden, "insufficient permissions to edit flows")
		return false
	}
	return true
}

// GetFlowSettings returns the non-sensitive Flow plugin settings needed by the UI.
func (h *Handlers) GetFlowSettings(w http.ResponseWriter, r *http.Request) {
	plugin, settings, err := h.getFlowSettings(r)
	if err != nil {
		if errors.Is(err, plugins.ErrPluginNotInstalled) {
			writeError(w, http.StatusNotFound, "flow plugin not installed")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load flow settings")
		return
	}
	if !plugin.Enabled {
		writeError(w, http.StatusBadRequest, "flow plugin is not enabled")
		return
	}

	writeJSON(w, http.StatusOK, settings)
}

// CreateFlowEntity handles POST /plugins/flow/entities.
func (h *Handlers) CreateFlowEntity(w http.ResponseWriter, r *http.Request) {
	if !h.ensureFlowWriteAccess(w, r) {
		return
	}

	var e entity.Entity
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxFlowEntityRequestBytes)).Decode(&e); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeError(w, http.StatusRequestEntityTooLarge, "request body too large")
			return
		}
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if e.Kind != "" && e.Kind != "Flow" {
		writeError(w, http.StatusBadRequest, "flow endpoint only accepts Flow entities")
		return
	}
	e.Kind = "Flow"
	e.SetDefaults()

	claims := middleware.GetClaims(r.Context())
	if claims != nil {
		e.Metadata.CreatedBy = claims.Username
	}

	if err := h.Validator.Validate(&e); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := h.DB.CreateEntity(r.Context(), &e); err != nil {
		if errors.Is(err, entity.ErrEntityAlreadyExists) {
			writeError(w, http.StatusConflict, "entity already exists")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to create flow")
		return
	}

	h.Events.Publish(events.Event{
		Type: events.EntityCreated,
		Data: map[string]any{
			"kind":      e.Kind,
			"name":      e.Metadata.Name,
			"namespace": e.Metadata.Namespace,
		},
	})

	userName := ""
	userID := ""
	if claims != nil {
		userName = claims.Username
		userID = claims.UserID
	}
	h.DB.CreateAuditEntry(r.Context(), &db.AuditEntry{
		UserID:       userID,
		UserName:     userName,
		Action:       "entity.created",
		ResourceType: e.Kind,
		ResourceName: e.Metadata.Name,
		AfterState:   marshalEntityState(&e),
		Source:       "api",
		IPAddress:    clientIP(r),
	})

	writeJSON(w, http.StatusCreated, e)
}

// UpdateFlowEntity handles PUT /plugins/flow/entities/{name}.
func (h *Handlers) UpdateFlowEntity(w http.ResponseWriter, r *http.Request) {
	if !h.ensureFlowWriteAccess(w, r) {
		return
	}

	name := chi.URLParam(r, "name")
	var e entity.Entity
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxFlowEntityRequestBytes)).Decode(&e); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeError(w, http.StatusRequestEntityTooLarge, "request body too large")
			return
		}
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if e.Kind != "" && e.Kind != "Flow" {
		writeError(w, http.StatusBadRequest, "flow endpoint only accepts Flow entities")
		return
	}
	e.Kind = "Flow"
	e.Metadata.Name = name
	e.SetDefaults()

	if err := h.Validator.Validate(&e); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	ns := e.Metadata.Namespace
	if ns == "" {
		ns = entity.DefaultNamespace
	}

	var beforeState string
	if prev, err := h.DB.GetEntity(r.Context(), e.Kind, ns, e.Metadata.Name); err == nil {
		beforeState = marshalEntityState(prev)
	}

	if err := h.DB.UpdateEntity(r.Context(), &e); err != nil {
		if errors.Is(err, entity.ErrEntityNotFound) {
			writeError(w, http.StatusNotFound, "entity not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to update flow")
		return
	}

	h.Events.Publish(events.Event{
		Type: events.EntityUpdated,
		Data: map[string]any{
			"kind":      e.Kind,
			"name":      e.Metadata.Name,
			"namespace": e.Metadata.Namespace,
		},
	})

	claims := middleware.GetClaims(r.Context())
	userName := ""
	userID := ""
	if claims != nil {
		userName = claims.Username
		userID = claims.UserID
	}
	h.DB.CreateAuditEntry(r.Context(), &db.AuditEntry{
		UserID:       userID,
		UserName:     userName,
		Action:       "entity.updated",
		ResourceType: e.Kind,
		ResourceName: e.Metadata.Name,
		BeforeState:  beforeState,
		AfterState:   marshalEntityState(&e),
		Source:       "api",
		IPAddress:    clientIP(r),
	})

	writeJSON(w, http.StatusOK, e)
}

// DeleteFlowEntity handles DELETE /plugins/flow/entities/{name}.
func (h *Handlers) DeleteFlowEntity(w http.ResponseWriter, r *http.Request) {
	if !h.ensureFlowWriteAccess(w, r) {
		return
	}

	name := chi.URLParam(r, "name")
	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		namespace = entity.DefaultNamespace
	}

	var beforeState string
	if prev, err := h.DB.GetEntity(r.Context(), "Flow", namespace, name); err == nil {
		beforeState = marshalEntityState(prev)
	}

	if err := h.DB.DeleteEntity(r.Context(), "Flow", namespace, name); err != nil {
		if errors.Is(err, entity.ErrEntityNotFound) {
			writeError(w, http.StatusNotFound, "entity not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to delete flow")
		return
	}

	h.Events.Publish(events.Event{
		Type: events.EntityDeleted,
		Data: map[string]any{
			"kind":      "Flow",
			"name":      name,
			"namespace": namespace,
		},
	})

	claims := middleware.GetClaims(r.Context())
	userName := ""
	userID := ""
	if claims != nil {
		userName = claims.Username
		userID = claims.UserID
	}
	h.DB.CreateAuditEntry(r.Context(), &db.AuditEntry{
		UserID:       userID,
		UserName:     userName,
		Action:       "entity.deleted",
		ResourceType: "Flow",
		ResourceName: name,
		BeforeState:  beforeState,
		Source:       "api",
		IPAddress:    clientIP(r),
	})

	w.WriteHeader(http.StatusNoContent)
}
