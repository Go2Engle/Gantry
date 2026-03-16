package handlers

import "net/http"

// Healthz returns a simple health-check response indicating the server is running.
func (h *Handlers) Healthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// GetVersion returns the server's build-time version string.
func (h *Handlers) GetVersion(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"version": h.Version})
}

// Readyz checks that the server is ready to serve traffic by verifying
// the database connection is alive. Returns 200 if healthy, 503 otherwise.
func (h *Handlers) Readyz(w http.ResponseWriter, r *http.Request) {
	if err := h.DB.Ping(); err != nil {
		writeError(w, http.StatusServiceUnavailable, "database not ready")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
