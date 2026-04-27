// Package dispatcher executes self-service actions based on their configured type.
// Each action entity spec declares a "type" field (e.g. "webhook") and
// type-specific fields (e.g. "url"). The Manager picks the right dispatcher
// and runs it, updating the ActionRun's status and publishing events.
package dispatcher

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go2engle/gantry/internal/db"
	"github.com/go2engle/gantry/internal/entity"
	"github.com/go2engle/gantry/internal/events"
)

// Manager holds shared HTTP client and event bus, and dispatches action runs
// to the appropriate backend based on the action entity's spec.type.
type Manager struct {
	DB     *db.DB
	Events *events.Bus
	client *http.Client
}

// New creates a new Manager.
func New(database *db.DB, eventBus *events.Bus) *Manager {
	return &Manager{
		DB:     database,
		Events: eventBus,
		client: &http.Client{Timeout: 30 * time.Second},
	}
}

// Dispatch executes a pending action run asynchronously.
// It updates run status (running → success/failed) and publishes events.
// Call from a goroutine; the caller should have already persisted the run as "pending".
func (m *Manager) Dispatch(action *entity.Entity, run *db.ActionRun, secrets map[string]string) {
	ctx := context.Background()

	// Transition to running.
	run.Status = "running"
	if err := m.DB.UpdateActionRun(ctx, run); err == nil {
		m.publishRunEvent(run)
	}

	var execErr error
	var outputJSON string

	actionType, _ := action.Spec["type"].(string)
	switch actionType {
	case "webhook":
		outputJSON, execErr = m.runWebhook(action, run)
	case "github-action":
		outputJSON, execErr = m.runGitHubAction(ctx, action, run, secrets)
	default:
		// Unrecognized type — complete immediately with a note.
		outputJSON = fmt.Sprintf(`{"message":"action type %q has no executor; marked as succeeded","type":%q}`,
			actionType, actionType)
	}

	now := time.Now().UTC()
	run.CompletedAt = &now
	run.Outputs = outputJSON
	if execErr != nil {
		run.Status = "failed"
		run.Error = execErr.Error()
	} else {
		run.Status = "success"
	}

	_ = m.DB.UpdateActionRun(ctx, run)
	m.publishRunEvent(run)
}

// publishRunEvent emits an action.run.updated event over the event bus.
func (m *Manager) publishRunEvent(run *db.ActionRun) {
	m.Events.Publish(events.Event{
		Type: events.ActionRunUpdated,
		Data: map[string]any{
			"runId":      run.ID,
			"actionName": run.ActionName,
			"status":     run.Status,
		},
	})
}

// runWebhook POSTs the action inputs to spec.url and captures the response body.
func (m *Manager) runWebhook(action *entity.Entity, run *db.ActionRun) (string, error) {
	rawURL, _ := action.Spec["url"].(string)
	if rawURL == "" {
		// Also check config.url
		if cfg, ok := action.Spec["config"].(map[string]any); ok {
			rawURL, _ = cfg["url"].(string)
		}
	}
	if rawURL == "" {
		return "", fmt.Errorf("webhook action %q has no url in spec or spec.config", action.Metadata.Name)
	}

	method := "POST"
	if m2, ok := action.Spec["method"].(string); ok && m2 != "" {
		method = m2
	}
	if cfg, ok := action.Spec["config"].(map[string]any); ok {
		if m2, ok := cfg["method"].(string); ok && m2 != "" {
			method = m2
		}
	}

	// Parse stored inputs.
	var inputs map[string]any
	if run.Inputs != "" {
		_ = json.Unmarshal([]byte(run.Inputs), &inputs)
	}

	payload, _ := json.Marshal(map[string]any{"inputs": inputs})
	req, err := http.NewRequest(method, rawURL, bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("building webhook request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Gantry/1.0")

	// Apply custom headers from spec.headers or spec.config.headers.
	applyHeaders := func(headersRaw any) {
		if headers, ok := headersRaw.(map[string]any); ok {
			for k, v := range headers {
				if vs, ok := v.(string); ok {
					req.Header.Set(k, vs)
				}
			}
		}
	}
	applyHeaders(action.Spec["headers"])
	if cfg, ok := action.Spec["config"].(map[string]any); ok {
		applyHeaders(cfg["headers"])
	}

	resp, err := m.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("webhook request failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16)) // 64 KiB max
	outputJSON, _ := json.Marshal(map[string]any{
		"statusCode": resp.StatusCode,
		"body":       string(body),
	})

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return string(outputJSON), fmt.Errorf("webhook returned HTTP %d", resp.StatusCode)
	}
	return string(outputJSON), nil
}

// runGitHubAction triggers a GitHub Actions workflow_dispatch event and waits
// briefly for the run to appear in the API.
func (m *Manager) runGitHubAction(ctx context.Context, action *entity.Entity, run *db.ActionRun, secrets map[string]string) (string, error) {
	cfg, _ := action.Spec["config"].(map[string]any)
	if cfg == nil {
		cfg = map[string]any{}
	}

	repoURL, _ := cfg["repoUrl"].(string)
	workflow, _ := cfg["workflow"].(string)
	ref, _ := cfg["ref"].(string)
	credentialMode, _ := cfg["credentialMode"].(string)

	if repoURL == "" || workflow == "" {
		return "", fmt.Errorf("github-action requires config.repoUrl and config.workflow")
	}
	if ref == "" {
		ref = "main"
	}

	owner, repo, err := parseGitHubURL(repoURL)
	if err != nil {
		return "", fmt.Errorf("invalid repoUrl: %w", err)
	}

	// Get token — action config takes priority, then user-scoped per-run
	// credentials, then plugin config when allowed.
	token, _ := cfg["token"].(string)
	tokenSource := "action"
	if token == "" {
		token, tokenSource, err = m.resolveGitHubActionToken(ctx, credentialMode, secrets)
		if err != nil {
			return "", err
		}
	}

	// Parse stored inputs and convert to strings (GitHub Actions requires strings).
	var inputs map[string]any
	if run.Inputs != "" {
		_ = json.Unmarshal([]byte(run.Inputs), &inputs)
	}
	stringInputs := map[string]string{}
	for k, v := range inputs {
		stringInputs[k] = fmt.Sprintf("%v", v)
	}

	// Dispatch the workflow.
	dispatchURL := fmt.Sprintf("https://api.github.com/repos/%s/%s/actions/workflows/%s/dispatches", owner, repo, workflow)
	payload, _ := json.Marshal(map[string]any{
		"ref":    ref,
		"inputs": stringInputs,
	})

	req, err := http.NewRequest(http.MethodPost, dispatchURL, bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("building dispatch request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Gantry/1.0")

	dispatched := time.Now().UTC()

	resp, err := m.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("dispatching workflow: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 204 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		var ghErr struct {
			Message string `json:"message"`
		}
		json.Unmarshal(body, &ghErr)
		msg := ghErr.Message
		if msg == "" {
			msg = string(body)
		}
		return "", fmt.Errorf("GitHub API returned HTTP %d: %s", resp.StatusCode, msg)
	}

	// Wait a moment then try to locate the new run for its URL.
	time.Sleep(3 * time.Second)
	runURL := m.findLatestWorkflowRun(token, owner, repo, dispatched)

	repoHTMLURL := fmt.Sprintf("https://github.com/%s/%s", owner, repo)
	out, _ := json.Marshal(map[string]any{
		"message":        "GitHub Actions workflow dispatched successfully",
		"repo":           repoHTMLURL,
		"workflow":       workflow,
		"ref":            ref,
		"runUrl":         runURL,
		"credentialMode": credentialModeForOutput(credentialMode),
		"tokenSource":    tokenSource,
	})
	return string(out), nil
}

func credentialModeForOutput(mode string) string {
	switch mode {
	case "user":
		return "user"
	case "":
		return "unset"
	default:
		return "service_account"
	}
}

func (m *Manager) resolveGitHubActionToken(ctx context.Context, credentialMode string, secrets map[string]string) (string, string, error) {
	if credentialMode == "user" {
		dispatchAsUser, fallback := m.githubUserDispatchPolicy(ctx)
		if !dispatchAsUser {
			return "", "", fmt.Errorf("GitHub user-attributed action dispatch is not enabled")
		}
		if secrets != nil {
			if token := strings.TrimSpace(secrets["githubToken"]); token != "" {
				return token, "user", nil
			}
		}
		if fallback != "service_account" {
			return "", "", fmt.Errorf("GitHub user authorization required for this action; complete the OAuth popup or re-authorize GitHub")
		}
		token, err := m.getGitHubToken(ctx)
		if err != nil {
			return "", "", fmt.Errorf("GitHub user authorization was not provided and no service account fallback is available: %w", err)
		}
		return token, "service_account_fallback", nil
	}

	token, err := m.getGitHubToken(ctx)
	if err != nil {
		return "", "", fmt.Errorf("no GitHub token available (configure the GitHub plugin or set config.token): %w", err)
	}
	return token, "service_account", nil
}

func (m *Manager) githubUserDispatchPolicy(ctx context.Context) (bool, string) {
	plugin, err := m.DB.GetPlugin(ctx, "github")
	if err != nil || plugin == nil || !plugin.Enabled || plugin.Config == nil {
		return false, "reject"
	}
	dispatchAsUser, _ := plugin.Config["dispatchAsUser"].(bool)
	fallback, _ := plugin.Config["dispatchFallback"].(string)
	if fallback == "" {
		fallback = "reject"
	}
	return dispatchAsUser, fallback
}

// getGitHubToken retrieves the personal access token from the GitHub plugin config.
func (m *Manager) getGitHubToken(ctx context.Context) (string, error) {
	plugin, err := m.DB.GetPlugin(ctx, "github")
	if err != nil {
		return "", fmt.Errorf("github plugin not installed")
	}
	if !plugin.Enabled {
		return "", fmt.Errorf("github plugin is disabled")
	}
	if plugin.Config == nil {
		return "", fmt.Errorf("github plugin has no configuration")
	}
	token, _ := plugin.Config["personalAccessToken"].(string)
	if token == "" {
		return "", fmt.Errorf("personalAccessToken not set in GitHub plugin config")
	}
	return token, nil
}

// findLatestWorkflowRun polls the GitHub API for the most recent workflow_dispatch
// run created after the dispatch timestamp and returns its HTML URL.
func (m *Manager) findLatestWorkflowRun(token, owner, repo string, after time.Time) string {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/actions/runs?event=workflow_dispatch&per_page=10", owner, repo)
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return ""
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := m.client.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()

	var result struct {
		WorkflowRuns []struct {
			HTMLURL   string `json:"html_url"`
			CreatedAt string `json:"created_at"`
		} `json:"workflow_runs"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return ""
	}

	for _, r := range result.WorkflowRuns {
		t, err := time.Parse(time.RFC3339, r.CreatedAt)
		if err != nil {
			continue
		}
		if t.After(after.Add(-10 * time.Second)) {
			return r.HTMLURL
		}
	}
	return ""
}

// parseGitHubURL parses a GitHub repository URL and returns owner and repo.
// Handles https://github.com/owner/repo and github.com/owner/repo forms.
func parseGitHubURL(rawURL string) (owner, repo string, err error) {
	u := strings.TrimPrefix(rawURL, "https://")
	u = strings.TrimPrefix(u, "http://")
	u = strings.TrimPrefix(u, "github.com/")
	u = strings.TrimSuffix(u, ".git")

	parts := strings.SplitN(strings.Trim(u, "/"), "/", 3)
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return "", "", fmt.Errorf("invalid GitHub URL: %s", rawURL)
	}
	return parts[0], parts[1], nil
}
