package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go2engle/gantry/internal/api/middleware"
	"github.com/go2engle/gantry/internal/db"
)

// knownWidgetIDs is the set of valid standard widget identifiers.
var knownWidgetIDs = map[string]bool{
	"entity_stats":      true,
	"recent_activity":   true,
	"action_runs":       true,
	"my_entities":       true,
	"recently_updated":  true,
	"quick_links":       true,
	"pinned_entities":   true,
	"recently_browsed":  true,
	"status_monitor":    true,
	"gitops_status":     true,
	"harbor_vulns":      true,
}

// GetDashboardConfig handles GET /api/v1/dashboard/config.
// Available to all authenticated users.
func (h *Handlers) GetDashboardConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.DB.GetDashboardConfig(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get dashboard config")
		return
	}
	writeJSON(w, http.StatusOK, cfg)
}

// SetDashboardConfig handles PUT /api/v1/dashboard/config.
// Admin only (enforced by RequireRole middleware in server.go).
func (h *Handlers) SetDashboardConfig(w http.ResponseWriter, r *http.Request) {
	var cfg db.DashboardConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate announcements.
	for i, a := range cfg.Announcements {
		if a.Title == "" {
			writeError(w, http.StatusBadRequest, "announcement title is required")
			return
		}
		switch a.Severity {
		case "info", "warning", "danger":
		default:
			writeError(w, http.StatusBadRequest, "announcement severity must be info, warning, or danger")
			return
		}
		if cfg.Announcements[i].ID == "" {
			writeError(w, http.StatusBadRequest, "announcement id is required")
			return
		}
	}

	// Validate quick links.
	for _, l := range cfg.QuickLinks {
		if l.Title == "" || l.URL == "" {
			writeError(w, http.StatusBadRequest, "quick link title and url are required")
			return
		}
		if l.ID == "" {
			writeError(w, http.StatusBadRequest, "quick link id is required")
			return
		}
	}

	// Validate pinned entities.
	for _, p := range cfg.PinnedEntities {
		if p.Kind == "" || p.Name == "" {
			writeError(w, http.StatusBadRequest, "pinned entity kind and name are required")
			return
		}
		if p.ID == "" {
			writeError(w, http.StatusBadRequest, "pinned entity id is required")
			return
		}
	}

	// Validate widget IDs and widths.
	for _, wgt := range cfg.Widgets {
		if !knownWidgetIDs[wgt.ID] {
			writeError(w, http.StatusBadRequest, "unknown widget id: "+wgt.ID)
			return
		}
		if wgt.Width != "" && wgt.Width != "full" && wgt.Width != "half" {
			writeError(w, http.StatusBadRequest, "widget width must be full or half")
			return
		}
	}

	updatedBy := ""
	if claims := middleware.GetClaims(r.Context()); claims != nil {
		updatedBy = claims.Username
	}

	if err := h.DB.SetDashboardConfig(r.Context(), &cfg, updatedBy); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save dashboard config")
		return
	}

	// Re-fetch so the response includes server-set timestamps.
	saved, err := h.DB.GetDashboardConfig(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read saved config")
		return
	}
	writeJSON(w, http.StatusOK, saved)
}
