package handlers

import (
	"io"
	"net/http"
	"net/url"
	"time"
)

// HealthCheckProxy fetches an external health-check URL on behalf of the
// frontend (avoiding CORS issues) and returns the upstream status, latency,
// and body.
func (h *Handlers) HealthCheckProxy(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("url")
	if target == "" {
		writeError(w, http.StatusBadRequest, "url query parameter is required")
		return
	}

	parsed, err := url.Parse(target)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		writeError(w, http.StatusBadRequest, "url must be an absolute http or https URL")
		return
	}
	if parsed.User != nil {
		writeError(w, http.StatusBadRequest, "url must not contain userinfo")
		return
	}

	client := &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	start := time.Now()
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target, nil)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid url")
		return
	}
	req.Header.Set("User-Agent", "gantry-health-check/1.0")
	resp, err := client.Do(req)
	latencyMs := time.Since(start).Milliseconds()

	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"reachable": false,
			"error":     err.Error(),
			"latencyMs": latencyMs,
		})
		return
	}
	defer resp.Body.Close()

	// Read up to 4KB of the response body for display.
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))

	writeJSON(w, http.StatusOK, map[string]any{
		"reachable":  resp.StatusCode >= 200 && resp.StatusCode < 400,
		"statusCode": resp.StatusCode,
		"latencyMs":  latencyMs,
		"body":       string(body),
	})
}
