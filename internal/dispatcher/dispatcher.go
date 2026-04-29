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
	"net/url"
	"strings"
	"time"

	"github.com/go2engle/gantry/internal/db"
	"github.com/go2engle/gantry/internal/entity"
	"github.com/go2engle/gantry/internal/events"
)

// Manager holds shared HTTP client and event bus, and dispatches action runs
// to the appropriate backend based on the action entity's spec.type.
type Manager struct {
	DB                 *db.DB
	Events             *events.Bus
	client             *http.Client
	githubAPIBaseURL   string
	githubPollInterval time.Duration
	githubPollTimeout  time.Duration
}

// New creates a new Manager.
func New(database *db.DB, eventBus *events.Bus) *Manager {
	return &Manager{
		DB:                 database,
		Events:             eventBus,
		client:             &http.Client{Timeout: 30 * time.Second},
		githubAPIBaseURL:   "https://api.github.com",
		githubPollInterval: 10 * time.Second,
		githubPollTimeout:  60 * time.Minute,
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
// for the resulting workflow run to complete.
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
	timeout := githubPollTimeoutFromConfig(cfg, m.githubPollTimeout)

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
	workflowID := url.PathEscape(workflow)
	dispatchURL := fmt.Sprintf("%s/repos/%s/%s/actions/workflows/%s/dispatches", m.githubAPIBaseURL, owner, repo, workflowID)
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

	repoHTMLURL := fmt.Sprintf("https://github.com/%s/%s", owner, repo)
	initialOutput := githubActionOutput{
		Message:        "GitHub Actions workflow dispatched; waiting for workflow run to complete",
		Repo:           repoHTMLURL,
		Workflow:       workflow,
		Ref:            ref,
		CredentialMode: credentialModeForOutput(credentialMode),
		TokenSource:    tokenSource,
	}
	m.updateGitHubActionRunOutput(ctx, run, initialOutput)

	workflowRun, err := m.waitForWorkflowRun(ctx, token, owner, repo, workflowID, ref, dispatched, timeout)
	if err != nil {
		out, _ := json.Marshal(githubActionOutput{
			Message:        "GitHub Actions workflow dispatched, but Gantry could not confirm its final result",
			Repo:           repoHTMLURL,
			Workflow:       workflow,
			Ref:            ref,
			RunURL:         workflowRun.HTMLURL,
			RunID:          workflowRun.ID,
			RunNumber:      workflowRun.RunNumber,
			Status:         workflowRun.Status,
			Conclusion:     workflowRun.Conclusion,
			CredentialMode: credentialModeForOutput(credentialMode),
			TokenSource:    tokenSource,
		})
		return string(out), err
	}

	finalOutput := githubActionOutput{
		Message:        "GitHub Actions workflow completed",
		Repo:           repoHTMLURL,
		Workflow:       workflow,
		Ref:            ref,
		RunURL:         workflowRun.HTMLURL,
		RunID:          workflowRun.ID,
		RunNumber:      workflowRun.RunNumber,
		Status:         workflowRun.Status,
		Conclusion:     workflowRun.Conclusion,
		CredentialMode: credentialModeForOutput(credentialMode),
		TokenSource:    tokenSource,
	}
	out, _ := json.Marshal(finalOutput)
	if workflowRun.Conclusion != "success" {
		conclusion := workflowRun.Conclusion
		if conclusion == "" {
			conclusion = workflowRun.Status
		}
		return string(out), fmt.Errorf("GitHub Actions workflow completed with conclusion %q", conclusion)
	}
	return string(out), nil
}

type githubActionOutput struct {
	Message        string `json:"message"`
	Repo           string `json:"repo"`
	Workflow       string `json:"workflow"`
	Ref            string `json:"ref"`
	RunURL         string `json:"runUrl,omitempty"`
	RunID          int64  `json:"runId,omitempty"`
	RunNumber      int    `json:"runNumber,omitempty"`
	Status         string `json:"status,omitempty"`
	Conclusion     string `json:"conclusion,omitempty"`
	CredentialMode string `json:"credentialMode"`
	TokenSource    string `json:"tokenSource"`
}

type githubWorkflowRun struct {
	ID         int64  `json:"id"`
	HTMLURL    string `json:"html_url"`
	Status     string `json:"status"`
	Conclusion string `json:"conclusion"`
	CreatedAt  string `json:"created_at"`
	HeadBranch string `json:"head_branch"`
	RunNumber  int    `json:"run_number"`
}

func githubPollTimeoutFromConfig(cfg map[string]any, fallback time.Duration) time.Duration {
	raw, ok := cfg["timeoutMinutes"]
	if !ok {
		return fallback
	}

	var minutes float64
	switch v := raw.(type) {
	case float64:
		minutes = v
	case int:
		minutes = float64(v)
	case json.Number:
		n, err := v.Float64()
		if err == nil {
			minutes = n
		}
	}
	if minutes <= 0 {
		return fallback
	}
	return time.Duration(minutes * float64(time.Minute))
}

func (m *Manager) updateGitHubActionRunOutput(ctx context.Context, run *db.ActionRun, output githubActionOutput) {
	b, err := json.Marshal(output)
	if err != nil {
		return
	}
	run.Outputs = string(b)
	if err := m.DB.UpdateActionRun(ctx, run); err == nil {
		m.publishRunEvent(run)
	}
}

func (m *Manager) waitForWorkflowRun(ctx context.Context, token, owner, repo, workflowID, ref string, dispatched time.Time, timeout time.Duration) (githubWorkflowRun, error) {
	if timeout <= 0 {
		timeout = 60 * time.Minute
	}
	interval := m.githubPollInterval
	if interval <= 0 {
		interval = 10 * time.Second
	}

	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	var lastRun *githubWorkflowRun
	for {
		var (
			workflowRun *githubWorkflowRun
			err         error
		)
		if lastRun == nil {
			workflowRun, err = m.findWorkflowRun(ctx, token, owner, repo, workflowID, ref, dispatched)
		} else {
			latest, getErr := m.getWorkflowRun(ctx, token, owner, repo, lastRun.ID)
			if getErr == nil {
				workflowRun = &latest
			}
			err = getErr
		}
		if err != nil && ctx.Err() == nil {
			return githubWorkflowRun{}, err
		}
		if workflowRun != nil {
			lastRun = workflowRun
			if workflowRun.Status == "completed" {
				return *workflowRun, nil
			}
		}

		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			if lastRun != nil {
				return *lastRun, fmt.Errorf("timed out waiting for GitHub Actions workflow run %d to complete", lastRun.ID)
			}
			return githubWorkflowRun{}, fmt.Errorf("timed out waiting for GitHub Actions workflow run to appear")
		case <-timer.C:
		}
	}
}

func (m *Manager) findWorkflowRun(ctx context.Context, token, owner, repo, workflowID, ref string, after time.Time) (*githubWorkflowRun, error) {
	endpoint := fmt.Sprintf("%s/repos/%s/%s/actions/workflows/%s/runs?event=workflow_dispatch&per_page=20", m.githubAPIBaseURL, owner, repo, workflowID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("building workflow run lookup request: %w", err)
	}
	setGitHubHeaders(req, token)

	resp, err := m.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("looking up workflow run: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("GitHub workflow run lookup returned HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var result struct {
		WorkflowRuns []githubWorkflowRun `json:"workflow_runs"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decoding workflow run lookup response: %w", err)
	}

	after = after.Add(-10 * time.Second)
	for _, workflowRun := range result.WorkflowRuns {
		createdAt, err := time.Parse(time.RFC3339, workflowRun.CreatedAt)
		if err != nil || createdAt.Before(after) {
			continue
		}
		if ref != "" && workflowRun.HeadBranch != "" && !githubRefMatches(ref, workflowRun.HeadBranch) {
			continue
		}
		matchedRun := workflowRun
		return &matchedRun, nil
	}
	return nil, nil
}

func (m *Manager) getWorkflowRun(ctx context.Context, token, owner, repo string, runID int64) (githubWorkflowRun, error) {
	endpoint := fmt.Sprintf("%s/repos/%s/%s/actions/runs/%d", m.githubAPIBaseURL, owner, repo, runID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return githubWorkflowRun{}, fmt.Errorf("building workflow run status request: %w", err)
	}
	setGitHubHeaders(req, token)

	resp, err := m.client.Do(req)
	if err != nil {
		return githubWorkflowRun{}, fmt.Errorf("checking workflow run status: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return githubWorkflowRun{}, fmt.Errorf("GitHub workflow run status returned HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var workflowRun githubWorkflowRun
	if err := json.NewDecoder(resp.Body).Decode(&workflowRun); err != nil {
		return githubWorkflowRun{}, fmt.Errorf("decoding workflow run status response: %w", err)
	}
	return workflowRun, nil
}

func githubRefMatches(ref, headBranch string) bool {
	ref = strings.TrimPrefix(ref, "refs/heads/")
	return ref == headBranch
}

func setGitHubHeaders(req *http.Request, token string) {
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "Gantry/1.0")
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
