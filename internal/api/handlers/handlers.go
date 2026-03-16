// Package handlers implements HTTP handler functions for the Gantry API.
package handlers

import (
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/go2engle/gantry/internal/auth"
	"github.com/go2engle/gantry/internal/db"
	"github.com/go2engle/gantry/internal/dispatcher"
	"github.com/go2engle/gantry/internal/entity"
	"github.com/go2engle/gantry/internal/events"
	"github.com/go2engle/gantry/internal/gitops"
	"github.com/go2engle/gantry/internal/search"
)

// Handlers groups all dependencies needed by API handler functions.
type Handlers struct {
	DB         *db.DB
	Auth       *auth.Service
	Events     *events.Bus
	Validator  *entity.SchemaValidator
	SearchSvc  *search.Service
	Dispatcher *dispatcher.Manager
	GitOps     *gitops.Service
	DataDir    string // root data directory, used for GitOps repo storage

	teamsNotifierOnce sync.Once
	teamsCfgMu        sync.RWMutex
	cachedTeamsConfig teamsPluginConfig
	cachedTeamsOK     bool
	cachedTeamsExpiry time.Time
}

// writeJSON serializes v as JSON and writes it to the response with the given
// HTTP status code. The Content-Type header is set to application/json.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		// At this point headers are already sent; just log internally.
		http.Error(w, `{"error":"failed to encode response"}`, http.StatusInternalServerError)
	}
}

// writeError sends a JSON error response with the given status code and message.
func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func isHTTPSRequest(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	return strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

func sessionCookie(r *http.Request, token string) *http.Cookie {
	return &http.Cookie{
		Name:     auth.SessionCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   86400,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isHTTPSRequest(r),
	}
}

func clearSessionCookie(r *http.Request) *http.Cookie {
	return &http.Cookie{
		Name:     auth.SessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isHTTPSRequest(r),
	}
}

func requestOrigin(r *http.Request) string {
	scheme := "http"
	if isHTTPSRequest(r) {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

func normalizeReturnTo(r *http.Request, raw string) string {
	if raw == "" {
		return ""
	}

	u, err := url.Parse(raw)
	if err != nil || !u.IsAbs() || u.Host == "" || u.User != nil {
		return ""
	}
	if u.RawQuery != "" || u.Fragment != "" {
		return ""
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return ""
	}
	if u.Scheme == "https" && !isHTTPSRequest(r) {
		return ""
	}
	if isHTTPSRequest(r) && u.Scheme != "https" {
		return ""
	}

	reqHost := r.Host
	if !isLoopbackHostname(u.Hostname()) && !strings.EqualFold(u.Host, reqHost) {
		return ""
	}
	if isLoopbackHostname(u.Hostname()) && !strings.EqualFold(u.Hostname(), requestHostname(r)) {
		return ""
	}

	return strings.TrimRight(u.String(), "/")
}

func isLoopbackHostname(host string) bool {
	if host == "" {
		return false
	}
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
