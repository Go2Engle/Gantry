package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

// Shared HTTP client for all Harbor API requests.
var harborHTTPClient = &http.Client{Timeout: 10 * time.Second}

// Harbor response types.

type HarborRepository struct {
	ID            int64  `json:"id"`
	Name          string `json:"name"`
	ProjectID     int64  `json:"project_id"`
	Description   string `json:"description"`
	PullCount     int64  `json:"pull_count"`
	ArtifactCount int64  `json:"artifact_count"`
	CreationTime  string `json:"creation_time"`
	UpdateTime    string `json:"update_time"`
}

type HarborTag struct {
	Name     string `json:"name"`
	PushTime string `json:"push_time"`
	PullTime string `json:"pull_time"`
}

type HarborVulnSummary struct {
	Critical int `json:"critical"`
	High     int `json:"high"`
	Medium   int `json:"medium"`
	Low      int `json:"low"`
	None     int `json:"none"`
	Unknown  int `json:"unknown"`
	Total    int `json:"total"`
}

type HarborArtifact struct {
	ID              int64              `json:"id"`
	Digest          string             `json:"digest"`
	Size            int64              `json:"size"`
	PushTime        string             `json:"push_time"`
	PullTime        string             `json:"pull_time"`
	Tags            []HarborTag        `json:"tags"`
	VulnSummary     *HarborVulnSummary `json:"vulnerability_summary,omitempty"`
	ScanOverviewRaw json.RawMessage    `json:"-"` // internal; not sent to frontend
}

type HarborVulnerability struct {
	ID          string  `json:"id"`
	Severity    string  `json:"severity"`
	Package     string  `json:"package"`
	Version     string  `json:"version"`
	FixVersion  string  `json:"fix_version"`
	Description string  `json:"description"`
	Score       float64 `json:"score,omitempty"`
}

type HarborSummaryResponse struct {
	Critical     int `json:"critical"`
	High         int `json:"high"`
	Medium       int `json:"medium"`
	Low          int `json:"low"`
	Total        int `json:"total"`
	Repositories int `json:"repositories"`
}

func capitalizeFirst(s string) string {
	if s == "" {
		return s
	}
	r, size := utf8.DecodeRuneInString(s)
	return string(unicode.ToUpper(r)) + s[size:]
}

// In-memory cache for Harbor API responses.
var (
	harborCacheMu      sync.RWMutex
	harborCacheEntries map[string]harborCacheEntry
)

type harborCacheEntry struct {
	data      []byte
	expiresAt time.Time
}

func harborCacheGet(key string) ([]byte, bool) {
	harborCacheMu.RLock()
	defer harborCacheMu.RUnlock()
	if harborCacheEntries == nil {
		return nil, false
	}
	entry, ok := harborCacheEntries[key]
	if !ok || time.Now().After(entry.expiresAt) {
		return nil, false
	}
	return entry.data, true
}

func harborCacheSet(key string, data []byte) {
	harborCacheMu.Lock()
	defer harborCacheMu.Unlock()
	if harborCacheEntries == nil {
		harborCacheEntries = make(map[string]harborCacheEntry)
	}
	now := time.Now()
	// Evict expired entries to prevent unbounded growth.
	for k, v := range harborCacheEntries {
		if now.After(v.expiresAt) {
			delete(harborCacheEntries, k)
		}
	}
	harborCacheEntries[key] = harborCacheEntry{
		data:      data,
		expiresAt: now.Add(60 * time.Second),
	}
}

func harborRequest(ctx context.Context, baseURL, username, password, path string) ([]byte, error) {
	reqURL := strings.TrimRight(baseURL, "/") + path

	// Check cache first.
	if cached, ok := harborCacheGet(reqURL); ok {
		return cached, nil
	}

	req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Gantry/1.0 Harbor")
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(username+":"+password)))

	resp, err := harborHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	const maxBody = 1 << 20 // 1 MiB
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxBody {
		return nil, fmt.Errorf("harbor API response exceeded %d bytes", maxBody)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("harbor API returned %d: %s", resp.StatusCode, string(body))
	}

	harborCacheSet(reqURL, body)
	return body, nil
}

type harborPluginConfig struct {
	URL            string
	Username       string
	Password       string
	DefaultProject string
}

func getHarborConfig(cfg map[string]any) (harborPluginConfig, error) {
	c := harborPluginConfig{DefaultProject: "library"}
	if cfg == nil {
		return c, fmt.Errorf("harbor plugin has no configuration")
	}
	c.URL, _ = cfg["url"].(string)
	c.Username, _ = cfg["username"].(string)
	c.Password, _ = cfg["password"].(string)
	if dp, ok := cfg["defaultProject"].(string); ok && dp != "" {
		c.DefaultProject = dp
	}
	if c.URL == "" || c.Username == "" || c.Password == "" {
		return c, fmt.Errorf("harbor plugin requires url, username, and password")
	}
	return c, nil
}

// ensureHarborConfig checks the harbor plugin is installed, enabled, and configured.
// Returns the parsed config or writes an HTTP error and returns a non-nil error.
func (h *Handlers) ensureHarborConfig(w http.ResponseWriter, r *http.Request) (harborPluginConfig, error) {
	p, err := h.DB.GetPlugin(r.Context(), "harbor")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "plugin lookup failed")
		return harborPluginConfig{}, fmt.Errorf("plugin lookup failed: %w", err)
	}
	if p == nil {
		writeError(w, http.StatusNotFound, "harbor plugin not installed")
		return harborPluginConfig{}, fmt.Errorf("not installed")
	}
	if !p.Enabled {
		writeError(w, http.StatusBadRequest, "harbor plugin is not enabled")
		return harborPluginConfig{}, fmt.Errorf("not enabled")
	}
	cfg, err := getHarborConfig(p.Config)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return harborPluginConfig{}, err
	}
	return cfg, nil
}

// GetHarborRepositories returns repositories for a given project.
func (h *Handlers) GetHarborRepositories(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.ensureHarborConfig(w, r)
	if err != nil {
		return
	}

	project := r.URL.Query().Get("project")
	if project == "" {
		project = cfg.DefaultProject
	}

	path := fmt.Sprintf("/api/v2.0/projects/%s/repositories?page_size=100", url.PathEscape(project))
	body, err := harborRequest(r.Context(), cfg.URL, cfg.Username, cfg.Password, path)
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to fetch repositories: "+err.Error())
		return
	}

	var repos []HarborRepository
	if err := json.Unmarshal(body, &repos); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to parse harbor response")
		return
	}

	writeJSON(w, http.StatusOK, repos)
}

// GetHarborArtifacts returns artifacts for a given repository.
func (h *Handlers) GetHarborArtifacts(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.ensureHarborConfig(w, r)
	if err != nil {
		return
	}

	project := r.URL.Query().Get("project")
	repository := r.URL.Query().Get("repository")
	if project == "" || repository == "" {
		writeError(w, http.StatusBadRequest, "project and repository query parameters are required")
		return
	}

	path := fmt.Sprintf("/api/v2.0/projects/%s/repositories/%s/artifacts?with_tag=true&with_scan_overview=true&page_size=50",
		url.PathEscape(project), url.PathEscape(repository))
	body, err := harborRequest(r.Context(), cfg.URL, cfg.Username, cfg.Password, path)
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to fetch artifacts: "+err.Error())
		return
	}

	// Parse raw artifacts to extract scan overview into vulnerability summary.
	var rawArtifacts []json.RawMessage
	if err := json.Unmarshal(body, &rawArtifacts); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to parse harbor response")
		return
	}

	results := make([]HarborArtifact, 0, len(rawArtifacts))
	for _, raw := range rawArtifacts {
		var a HarborArtifact
		if err := json.Unmarshal(raw, &a); err != nil {
			continue
		}

		// Extract scan overview from raw JSON.
		var full map[string]json.RawMessage
		if err := json.Unmarshal(raw, &full); err == nil {
			if scanOverview, ok := full["scan_overview"]; ok {
				a.VulnSummary = parseScanOverview(scanOverview)
			}
		}

		if a.Tags == nil {
			a.Tags = []HarborTag{}
		}
		results = append(results, a)
	}

	writeJSON(w, http.StatusOK, results)
}

// parseScanOverview extracts vulnerability counts from Harbor's scan_overview field.
// The scan_overview is a map keyed by MIME type (e.g.
// "application/vnd.security.vulnerability.report; version=1.1").
// Each value is a NativeReportSummary with structure:
//
//	{
//	  "report_id": "...",
//	  "scan_status": "Success",
//	  "severity": "High",
//	  "summary": {
//	    "total": 45,
//	    "fixable": 12,
//	    "summary": { "Critical": 5, "High": 10, "Medium": 20, "Low": 10 }
//	  }
//	}
func parseScanOverview(raw json.RawMessage) *HarborVulnSummary {
	var overview map[string]json.RawMessage
	if err := json.Unmarshal(raw, &overview); err != nil {
		return nil
	}

	for _, reportRaw := range overview {
		var report struct {
			ScanStatus string `json:"scan_status"`
			Summary    *struct {
				Total   int            `json:"total"`
				Fixable int            `json:"fixable"`
				Summary map[string]int `json:"summary"`
			} `json:"summary"`
		}
		if err := json.Unmarshal(reportRaw, &report); err != nil {
			continue
		}
		// Only use completed scan reports.
		if report.ScanStatus != "Success" {
			continue
		}
		if report.Summary == nil {
			continue
		}

		s := &HarborVulnSummary{Total: report.Summary.Total}
		for sev, count := range report.Summary.Summary {
			switch strings.ToLower(sev) {
			case "critical":
				s.Critical = count
			case "high":
				s.High = count
			case "medium":
				s.Medium = count
			case "low":
				s.Low = count
			case "none":
				s.None = count
			case "unknown":
				s.Unknown = count
			}
		}
		return s
	}
	return nil
}

// GetHarborVulnerabilities returns vulnerabilities for a specific artifact.
func (h *Handlers) GetHarborVulnerabilities(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.ensureHarborConfig(w, r)
	if err != nil {
		return
	}

	project := r.URL.Query().Get("project")
	repository := r.URL.Query().Get("repository")
	reference := r.URL.Query().Get("reference")
	if project == "" || repository == "" || reference == "" {
		writeError(w, http.StatusBadRequest, "project, repository, and reference query parameters are required")
		return
	}

	path := fmt.Sprintf("/api/v2.0/projects/%s/repositories/%s/artifacts/%s/additions/vulnerabilities",
		url.PathEscape(project), url.PathEscape(repository), url.PathEscape(reference))
	body, err := harborRequest(r.Context(), cfg.URL, cfg.Username, cfg.Password, path)
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to fetch vulnerabilities: "+err.Error())
		return
	}

	// Harbor returns a map keyed by MIME type, each containing a report with vulnerabilities array.
	var reports map[string]json.RawMessage
	if err := json.Unmarshal(body, &reports); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to parse vulnerabilities response")
		return
	}

	var vulns []HarborVulnerability
	for _, reportRaw := range reports {
		var report struct {
			Vulnerabilities []struct {
				ID          string `json:"id"`
				Severity    string `json:"severity"`
				Package     string `json:"package"`
				Version     string `json:"version"`
				FixVersion  string `json:"fix_version"`
				Description string `json:"description"`
				Links       []string `json:"links"`
				CVSS        *struct {
					ScoreV3 *float64 `json:"score_v3"`
					ScoreV2 *float64 `json:"score_v2"`
				} `json:"preferred_cvss"`
			} `json:"vulnerabilities"`
		}
		if err := json.Unmarshal(reportRaw, &report); err != nil {
			continue
		}
		for _, v := range report.Vulnerabilities {
			var score float64
			if v.CVSS != nil {
				if v.CVSS.ScoreV3 != nil {
					score = *v.CVSS.ScoreV3
				} else if v.CVSS.ScoreV2 != nil {
					score = *v.CVSS.ScoreV2
				}
			}
			vulns = append(vulns, HarborVulnerability{
				ID:          v.ID,
				Severity:    capitalizeFirst(strings.ToLower(v.Severity)),
				Package:     v.Package,
				Version:     v.Version,
				FixVersion:  v.FixVersion,
				Description: v.Description,
				Score:       score,
			})
		}
	}

	if vulns == nil {
		vulns = []HarborVulnerability{}
	}

	writeJSON(w, http.StatusOK, vulns)
}

// GetHarborSummary returns aggregated vulnerability counts across all repos in the default project.
func (h *Handlers) GetHarborSummary(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.ensureHarborConfig(w, r)
	if err != nil {
		return
	}

	ctx := r.Context()

	// Fetch repositories.
	repoPath := fmt.Sprintf("/api/v2.0/projects/%s/repositories?page_size=100", url.PathEscape(cfg.DefaultProject))
	repoBody, err := harborRequest(ctx, cfg.URL, cfg.Username, cfg.Password, repoPath)
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to fetch repositories: "+err.Error())
		return
	}

	var repos []HarborRepository
	if err := json.Unmarshal(repoBody, &repos); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to parse repositories")
		return
	}

	summary := HarborSummaryResponse{Repositories: len(repos)}

	// Fetch latest artifact for each repo concurrently.
	var wg sync.WaitGroup
	var mu sync.Mutex
	var errs int

	for _, repo := range repos {
		wg.Add(1)
		go func(repoName string) {
			defer wg.Done()
			// Extract repo name relative to the project.
			parts := strings.SplitN(repoName, "/", 2)
			relName := repoName
			if len(parts) == 2 {
				relName = parts[1]
			}
			artPath := fmt.Sprintf("/api/v2.0/projects/%s/repositories/%s/artifacts?with_scan_overview=true&page_size=1",
				url.PathEscape(cfg.DefaultProject), url.PathEscape(relName))
			artBody, err := harborRequest(ctx, cfg.URL, cfg.Username, cfg.Password, artPath)
			if err != nil {
				mu.Lock()
				errs++
				mu.Unlock()
				return
			}

			var rawArts []json.RawMessage
			if err := json.Unmarshal(artBody, &rawArts); err != nil || len(rawArts) == 0 {
				return
			}

			var full map[string]json.RawMessage
			if err := json.Unmarshal(rawArts[0], &full); err != nil {
				return
			}
			scanRaw, ok := full["scan_overview"]
			if !ok {
				return
			}
			vs := parseScanOverview(scanRaw)
			if vs == nil {
				return
			}

			mu.Lock()
			summary.Critical += vs.Critical
			summary.High += vs.High
			summary.Medium += vs.Medium
			summary.Low += vs.Low
			summary.Total += vs.Total
			mu.Unlock()
		}(repo.Name)
	}
	wg.Wait()

	if errs > 0 && errs == len(repos) {
		writeError(w, http.StatusBadGateway, "failed to fetch artifacts from all repositories")
		return
	}

	writeJSON(w, http.StatusOK, summary)
}
