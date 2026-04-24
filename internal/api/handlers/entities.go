package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go2engle/gantry/internal/api/middleware"
	"github.com/go2engle/gantry/internal/db"
	"github.com/go2engle/gantry/internal/entity"
	"github.com/go2engle/gantry/internal/events"
)

// clientIP extracts the real client IP from the request.
// Checks X-Real-IP, then X-Forwarded-For (first entry), then RemoteAddr.
func clientIP(r *http.Request) string {
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return strings.TrimSpace(ip)
	}
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		if idx := strings.Index(fwd, ","); idx != -1 {
			return strings.TrimSpace(fwd[:idx])
		}
		return strings.TrimSpace(fwd)
	}
	addr := r.RemoteAddr
	if idx := strings.LastIndex(addr, ":"); idx != -1 {
		addr = addr[:idx]
	}
	return strings.Trim(addr, "[]")
}

// marshalEntityState serializes an entity to a compact JSON string for audit storage.
func marshalEntityState(e *entity.Entity) string {
	b, err := json.Marshal(e)
	if err != nil {
		return ""
	}
	return string(b)
}

func entityNotFoundMessage(kind, namespace, name string) string {
	if namespace == "" {
		namespace = entity.DefaultNamespace
	}
	if kind == "" {
		if name == "" {
			return fmt.Sprintf("entity not found in namespace %q", namespace)
		}
		return fmt.Sprintf("entity %q not found in namespace %q", name, namespace)
	}
	if name == "" {
		return fmt.Sprintf("%s entity not found in namespace %q", kind, namespace)
	}
	return fmt.Sprintf("%s entity %q not found in namespace %q", kind, name, namespace)
}

// ListEntities handles GET /entities.
// Supports query filters: ?namespace=, ?owner=, ?tag=
func (h *Handlers) ListEntities(w http.ResponseWriter, r *http.Request) {
	namespace := r.URL.Query().Get("namespace")

	entities, err := h.DB.ListEntities(r.Context(), "", namespace)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list entities")
		return
	}

	// Apply optional query filters that the DB layer does not handle.
	filtered := filterEntities(entities, r)
	if filtered == nil {
		filtered = []*entity.Entity{}
	}

	writeJSON(w, http.StatusOK, filtered)
}

// ListEntitiesByKind handles GET /entities/{kind}.
// Supports query filters: ?namespace=, ?owner=, ?tag=
func (h *Handlers) ListEntitiesByKind(w http.ResponseWriter, r *http.Request) {
	kind := chi.URLParam(r, "kind")
	namespace := r.URL.Query().Get("namespace")

	entities, err := h.DB.ListEntities(r.Context(), kind, namespace)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list entities")
		return
	}

	filtered := filterEntities(entities, r)
	if filtered == nil {
		filtered = []*entity.Entity{}
	}

	writeJSON(w, http.StatusOK, filtered)
}

// GetEntity handles GET /entities/{kind}/{name}.
// Uses ?namespace= query param (defaults to "default").
func (h *Handlers) GetEntity(w http.ResponseWriter, r *http.Request) {
	kind := chi.URLParam(r, "kind")
	name := chi.URLParam(r, "name")
	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		namespace = entity.DefaultNamespace
	}

	e, err := h.DB.GetEntity(r.Context(), kind, namespace, name)
	if err != nil {
		if errors.Is(err, entity.ErrEntityNotFound) {
			writeError(w, http.StatusNotFound, entityNotFoundMessage(kind, namespace, name))
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get entity")
		return
	}

	writeJSON(w, http.StatusOK, e)
}

// CreateEntity handles POST /entities.
// Parses a JSON entity body, validates with SchemaValidator, saves to DB,
// publishes an EntityCreated event, and writes an audit log entry.
func (h *Handlers) CreateEntity(w http.ResponseWriter, r *http.Request) {
	var e entity.Entity
	if err := json.NewDecoder(r.Body).Decode(&e); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Set defaults before validation.
	e.SetDefaults()

	// Set created_by from authenticated user.
	claims := middleware.GetClaims(r.Context())
	if claims != nil {
		e.Metadata.CreatedBy = claims.Username
	}

	// Validate against JSON Schema.
	if err := h.Validator.Validate(&e); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := h.DB.CreateEntity(r.Context(), &e); err != nil {
		if errors.Is(err, entity.ErrEntityAlreadyExists) {
			writeError(w, http.StatusConflict, "entity already exists")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to create entity")
		return
	}

	// Publish event.
	h.Events.Publish(events.Event{
		Type: events.EntityCreated,
		Data: map[string]any{
			"kind":      e.Kind,
			"name":      e.Metadata.Name,
			"namespace": e.Metadata.Namespace,
		},
	})

	// Write audit log.
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

// UpdateEntity handles PUT /entities/{kind}/{name}.
// Parses body, validates, updates in DB, publishes EntityUpdated, and writes audit.
func (h *Handlers) UpdateEntity(w http.ResponseWriter, r *http.Request) {
	kind := chi.URLParam(r, "kind")
	name := chi.URLParam(r, "name")
	if kind == "Flow" && !h.ensureFlowWriteAccess(w, r) {
		return
	}

	var e entity.Entity
	if err := json.NewDecoder(r.Body).Decode(&e); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Ensure the URL path values take precedence.
	e.Kind = kind
	e.Metadata.Name = name

	// Set defaults.
	e.SetDefaults()

	// Validate against JSON Schema.
	if err := h.Validator.Validate(&e); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Capture before state for audit log.
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
			writeError(w, http.StatusNotFound, entityNotFoundMessage(e.Kind, ns, e.Metadata.Name))
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to update entity")
		return
	}

	// Publish event.
	h.Events.Publish(events.Event{
		Type: events.EntityUpdated,
		Data: map[string]any{
			"kind":      e.Kind,
			"name":      e.Metadata.Name,
			"namespace": e.Metadata.Namespace,
		},
	})

	// Write audit log.
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

// DeleteEntity handles DELETE /entities/{kind}/{name}.
// Deletes the entity from the DB, publishes EntityDeleted, and writes audit.
func (h *Handlers) DeleteEntity(w http.ResponseWriter, r *http.Request) {
	kind := chi.URLParam(r, "kind")
	name := chi.URLParam(r, "name")
	if kind == "Flow" && !h.ensureFlowWriteAccess(w, r) {
		return
	}
	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		namespace = entity.DefaultNamespace
	}

	// Capture before state for audit log.
	var beforeState string
	if prev, err := h.DB.GetEntity(r.Context(), kind, namespace, name); err == nil {
		beforeState = marshalEntityState(prev)
	}

	if err := h.DB.DeleteEntity(r.Context(), kind, namespace, name); err != nil {
		if errors.Is(err, entity.ErrEntityNotFound) {
			writeError(w, http.StatusNotFound, entityNotFoundMessage(kind, namespace, name))
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to delete entity")
		return
	}

	// Publish event.
	h.Events.Publish(events.Event{
		Type: events.EntityDeleted,
		Data: map[string]any{
			"kind":      kind,
			"name":      name,
			"namespace": namespace,
		},
	})

	// Write audit log.
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
		ResourceType: kind,
		ResourceName: name,
		BeforeState:  beforeState,
		Source:       "api",
		IPAddress:    clientIP(r),
	})

	w.WriteHeader(http.StatusNoContent)
}

// filterEntities applies optional owner and tag query filters to a list of entities.
func filterEntities(entities []*entity.Entity, r *http.Request) []*entity.Entity {
	owner := r.URL.Query().Get("owner")
	tag := r.URL.Query().Get("tag")

	if owner == "" && tag == "" {
		return entities
	}

	var filtered []*entity.Entity
	for _, e := range entities {
		if owner != "" && e.Metadata.Owner != owner {
			continue
		}
		if tag != "" && !containsTag(e.Metadata.Tags, tag) {
			continue
		}
		filtered = append(filtered, e)
	}
	return filtered
}

// containsTag checks whether a slice of tags contains the given tag.
func containsTag(tags []string, tag string) bool {
	for _, t := range tags {
		if t == tag {
			return true
		}
	}
	return false
}
