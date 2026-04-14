package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Shared HTTP client for all Nexus API requests.
var nexusHTTPClient = &http.Client{Timeout: 15 * time.Second}

// Nexus response types.

type NexusAsset struct {
	DownloadURL string `json:"downloadUrl"`
	Path        string `json:"path"`
	ID          string `json:"id"`
	Repository  string `json:"repository"`
	Format      string `json:"format"`
	ContentType string `json:"contentType"`
	LastModified string `json:"lastModified"`
	FileSize    int64  `json:"fileSize"`
}

type NexusComponent struct {
	ID         string       `json:"id"`
	Repository string       `json:"repository"`
	Format     string       `json:"format"`
	Group      string       `json:"group"`
	Name       string       `json:"name"`
	Version    string       `json:"version"`
	Assets     []NexusAsset `json:"assets"`
}

type nexusSearchResponse struct {
	Items             []json.RawMessage `json:"items"`
	ContinuationToken string           `json:"continuationToken"`
}

// In-memory cache for Nexus API responses.
var (
	nexusCacheMu      sync.RWMutex
	nexusCacheEntries map[string]nexusCacheEntry
)

type nexusCacheEntry struct {
	data      []byte
	expiresAt time.Time
}

func nexusCacheGet(key string) ([]byte, bool) {
	nexusCacheMu.RLock()
	defer nexusCacheMu.RUnlock()
	if nexusCacheEntries == nil {
		return nil, false
	}
	entry, ok := nexusCacheEntries[key]
	if !ok || time.Now().After(entry.expiresAt) {
		return nil, false
	}
	return entry.data, true
}

const maxNexusCacheEntries = 200

func nexusCacheSet(key string, data []byte) {
	nexusCacheMu.Lock()
	defer nexusCacheMu.Unlock()
	if nexusCacheEntries == nil {
		nexusCacheEntries = make(map[string]nexusCacheEntry)
	}
	nexusCacheEntries[key] = nexusCacheEntry{
		data:      data,
		expiresAt: time.Now().Add(60 * time.Second),
	}
	// Evict if over capacity: remove expired first, then oldest entries.
	if len(nexusCacheEntries) > maxNexusCacheEntries {
		now := time.Now()
		for k, v := range nexusCacheEntries {
			if now.After(v.expiresAt) {
				delete(nexusCacheEntries, k)
			}
		}
		// If still over capacity, remove nearest-expiry entries.
		for len(nexusCacheEntries) > maxNexusCacheEntries {
			var oldestKey string
			var oldestExp time.Time
			for k, v := range nexusCacheEntries {
				if oldestKey == "" || v.expiresAt.Before(oldestExp) {
					oldestKey = k
					oldestExp = v.expiresAt
				}
			}
			delete(nexusCacheEntries, oldestKey)
		}
	}
}

func nexusRequest(ctx context.Context, baseURL, username, password, path string) ([]byte, error) {
	reqURL := baseURL + path

	// Check cache first.
	if cached, ok := nexusCacheGet(reqURL); ok {
		return cached, nil
	}

	req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Gantry/1.0 NexusRepositoryManager")
	req.Header.Set("Accept", "application/json")
	if username != "" && password != "" {
		req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(username+":"+password)))
	}

	resp, err := nexusHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	const maxBody = 2 << 20 // 2 MiB
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxBody {
		return nil, fmt.Errorf("nexus API response exceeded %d bytes", maxBody)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		excerpt := string(body)
		if len(excerpt) > 200 {
			excerpt = excerpt[:200] + "…(truncated)"
		}
		return nil, fmt.Errorf("nexus API returned %d: %s", resp.StatusCode, excerpt)
	}

	nexusCacheSet(reqURL, body)
	return body, nil
}

type nexusPluginConfig struct {
	URL               string
	Username          string
	Password          string
	DefaultRepository string
}

func getNexusConfig(cfg map[string]any) (nexusPluginConfig, error) {
	c := nexusPluginConfig{}
	if cfg == nil {
		return c, fmt.Errorf("nexus plugin has no configuration")
	}
	c.URL, _ = cfg["url"].(string)
	c.Username, _ = cfg["username"].(string)
	c.Password, _ = cfg["password"].(string)
	c.DefaultRepository, _ = cfg["defaultRepository"].(string)
	if c.URL == "" {
		return c, fmt.Errorf("nexus plugin requires url")
	}
	// Normalise: strip trailing slashes so callers can just append /service/rest/...
	c.URL = strings.TrimRight(c.URL, "/")
	return c, nil
}

// nexusPaginatedSearch fetches all pages of a Nexus search endpoint,
// following continuationToken until exhausted. maxPages caps the loop to
// prevent runaway requests against very large result sets.
func nexusPaginatedSearch(ctx context.Context, cfg nexusPluginConfig, basePath string) ([]json.RawMessage, error) {
	const maxPages = 20
	var allItems []json.RawMessage
	path := basePath

	for page := 0; page < maxPages; page++ {
		body, err := nexusRequest(ctx, cfg.URL, cfg.Username, cfg.Password, path)
		if err != nil {
			return nil, err
		}
		var resp nexusSearchResponse
		if err := json.Unmarshal(body, &resp); err != nil {
			return nil, fmt.Errorf("failed to parse nexus response: %w", err)
		}
		allItems = append(allItems, resp.Items...)
		if resp.ContinuationToken == "" {
			break
		}
		// Append continuationToken query param.
		sep := "?"
		if strings.Contains(basePath, "?") {
			sep = "&"
		}
		path = basePath + sep + "continuationToken=" + url.QueryEscape(resp.ContinuationToken)
	}
	return allItems, nil
}

// ensureNexusConfig checks the nexus plugin is installed, enabled, and configured.
func (h *Handlers) ensureNexusConfig(w http.ResponseWriter, r *http.Request) (nexusPluginConfig, error) {
	p, err := h.DB.GetPlugin(r.Context(), "nexus-repository-manager")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "plugin lookup failed")
		return nexusPluginConfig{}, fmt.Errorf("plugin lookup failed: %w", err)
	}
	if p == nil {
		writeError(w, http.StatusNotFound, "nexus-repository-manager plugin not installed")
		return nexusPluginConfig{}, fmt.Errorf("not installed")
	}
	if !p.Enabled {
		writeError(w, http.StatusBadRequest, "nexus-repository-manager plugin is not enabled")
		return nexusPluginConfig{}, fmt.Errorf("not enabled")
	}
	cfg, err := getNexusConfig(p.Config)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return nexusPluginConfig{}, err
	}
	return cfg, nil
}

// NexusRepository represents a Nexus repository from the repositories API.
// Note: the v1/repositories list endpoint does not include online status.
type NexusRepository struct {
	Name   string `json:"name"`
	Format string `json:"format"`
	Type   string `json:"type"`
	URL    string `json:"url"`
}

// GetNexusRepositories lists all repositories from Nexus Repository Manager.
func (h *Handlers) GetNexusRepositories(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.ensureNexusConfig(w, r)
	if err != nil {
		return
	}

	body, err := nexusRequest(r.Context(), cfg.URL, cfg.Username, cfg.Password, "/service/rest/v1/repositories")
	if err != nil {
		log.Printf("[nexus] failed to fetch repositories: %v", err)
		writeError(w, http.StatusBadGateway, "failed to fetch repositories from Nexus")
		return
	}

	var repos []NexusRepository
	if err := json.Unmarshal(body, &repos); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to parse repositories response")
		return
	}
	if repos == nil {
		repos = []NexusRepository{}
	}
	writeJSON(w, http.StatusOK, repos)
}

// GetNexusComponents searches for components in Nexus Repository Manager.
func (h *Handlers) GetNexusComponents(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.ensureNexusConfig(w, r)
	if err != nil {
		return
	}

	name := r.URL.Query().Get("name")
	repository := r.URL.Query().Get("repository")
	group := r.URL.Query().Get("group")
	format := r.URL.Query().Get("format")

	if repository == "" {
		repository = cfg.DefaultRepository
	}

	// If only a repository filter is set (no search criteria), use the
	// /components browse endpoint which works without credentials and doesn't
	// require any additional filters. Fall back to /search when name/group/format
	// are provided so wildcard matching still works.
	var basePath string
	if name == "" && group == "" && format == "" && repository != "" {
		basePath = "/service/rest/v1/components?repository=" + url.QueryEscape(repository)
	} else {
		params := url.Values{}
		if name != "" {
			// Wrap in wildcards for partial matching.
			if name[0] != '*' {
				name = "*" + name
			}
			if name[len(name)-1] != '*' {
				name = name + "*"
			}
			params.Set("name", name)
		}
		if repository != "" {
			params.Set("repository", repository)
		}
		if group != "" {
			params.Set("group", group)
		}
		if format != "" {
			params.Set("format", format)
		}
		basePath = "/service/rest/v1/search?" + params.Encode()
	}

	allItems, err := nexusPaginatedSearch(r.Context(), cfg, basePath)
	if err != nil {
		log.Printf("[nexus] failed to fetch components (path=%s): %v", basePath, err)
		writeError(w, http.StatusBadGateway, "failed to fetch components from Nexus")
		return
	}

	components := make([]NexusComponent, 0, len(allItems))
	for _, raw := range allItems {
		var c NexusComponent
		if err := json.Unmarshal(raw, &c); err != nil {
			log.Printf("[nexus] skipping component: unmarshal error: %v", err)
			continue
		}
		if c.Assets == nil {
			c.Assets = []NexusAsset{}
		}
		components = append(components, c)
	}

	writeJSON(w, http.StatusOK, components)
}

// GetNexusAssets searches for assets in Nexus Repository Manager.
func (h *Handlers) GetNexusAssets(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.ensureNexusConfig(w, r)
	if err != nil {
		return
	}

	name := r.URL.Query().Get("name")
	repository := r.URL.Query().Get("repository")

	if repository == "" {
		repository = cfg.DefaultRepository
	}

	params := url.Values{}
	if name != "" {
		if name[0] != '*' {
			name = "*" + name
		}
		if name[len(name)-1] != '*' {
			name = name + "*"
		}
		params.Set("name", name)
	}
	if repository != "" {
		params.Set("repository", repository)
	}

	basePath := "/service/rest/v1/search/assets?" + params.Encode()
	allItems, err := nexusPaginatedSearch(r.Context(), cfg, basePath)
	if err != nil {
		log.Printf("[nexus] failed to fetch assets (path=%s): %v", basePath, err)
		writeError(w, http.StatusBadGateway, "failed to fetch assets from Nexus")
		return
	}

	assets := make([]NexusAsset, 0, len(allItems))
	for _, raw := range allItems {
		var a NexusAsset
		if err := json.Unmarshal(raw, &a); err != nil {
			log.Printf("[nexus] skipping asset: unmarshal error: %v", err)
			continue
		}
		assets = append(assets, a)
	}

	writeJSON(w, http.StatusOK, assets)
}
