package handlers

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go2engle/gantry/internal/api/middleware"
	"github.com/go2engle/gantry/internal/db"
	"github.com/go2engle/gantry/internal/entity"
	"github.com/go2engle/gantry/internal/events"
	ghplugin "github.com/go2engle/gantry/internal/plugins/github"
	"gopkg.in/yaml.v3"
)

// ListActions handles GET /actions. It returns all entities of kind "Action".
func (h *Handlers) ListActions(w http.ResponseWriter, r *http.Request) {
	entities, err := h.DB.ListEntities(r.Context(), "Action", "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list actions")
		return
	}
	if entities == nil {
		entities = []*entity.Entity{}
	}

	writeJSON(w, http.StatusOK, entities)
}

// executeActionRequest represents the JSON body for executing an action.
type executeActionRequest struct {
	Inputs  map[string]any    `json:"inputs,omitempty"`
	Secrets map[string]string `json:"secrets,omitempty"`
}

// ExecuteAction handles POST /actions/{name}/execute. It creates a new action
// run record in the database, publishes an ActionTriggered event, and kicks off
// asynchronous dispatch (webhook, etc.) that transitions the run through
// running → success/failed.
func (h *Handlers) ExecuteAction(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	// Verify the action entity exists and retrieve it for dispatch.
	actionEntity, err := h.DB.GetEntity(r.Context(), "Action", entity.DefaultNamespace, name)
	if err != nil {
		if errors.Is(err, entity.ErrEntityNotFound) {
			writeError(w, http.StatusNotFound, "action not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get action")
		return
	}

	// Parse optional inputs from the request body.
	var req executeActionRequest
	if r.Body != nil && r.ContentLength > 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
	}
	if err := h.validateExecuteActionSecrets(r, req.Secrets); err != nil {
		log.Printf("github action user token validation failed: %v", err)
		writeError(w, http.StatusForbidden, "GitHub user token does not match the authenticated Gantry user")
		return
	}

	// Serialize inputs for storage.
	inputsJSON := ""
	if req.Inputs != nil {
		b, err := json.Marshal(req.Inputs)
		if err != nil {
			writeError(w, http.StatusBadRequest, "failed to serialize inputs")
			return
		}
		inputsJSON = string(b)
	}

	// Determine who triggered the action.
	triggeredBy := ""
	claims := middleware.GetClaims(r.Context())
	if claims != nil {
		triggeredBy = claims.Username
	}

	now := time.Now().UTC()
	run := &db.ActionRun{
		ActionName:  name,
		Status:      "pending",
		Inputs:      inputsJSON,
		TriggeredBy: triggeredBy,
		StartedAt:   &now,
	}

	if err := h.DB.CreateActionRun(r.Context(), run); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create action run")
		return
	}

	// Publish triggered event.
	h.Events.Publish(events.Event{
		Type: events.ActionTriggered,
		Data: map[string]any{
			"actionName":  name,
			"runId":       run.ID,
			"triggeredBy": triggeredBy,
		},
	})

	// Asynchronously dispatch — updates run status as it progresses.
	go h.Dispatcher.Dispatch(actionEntity, run, req.Secrets)

	writeJSON(w, http.StatusCreated, run)
}

func (h *Handlers) validateExecuteActionSecrets(r *http.Request, secrets map[string]string) error {
	if secrets == nil {
		return nil
	}
	token := strings.TrimSpace(secrets["githubToken"])
	if token == "" {
		delete(secrets, "githubToken")
		return nil
	}
	secrets["githubToken"] = token

	claims := middleware.GetClaims(r.Context())
	if claims == nil || claims.UserID == "" {
		return fmt.Errorf("missing authenticated user claims")
	}

	ghUser, err := ghplugin.FetchUserWithToken(token)
	if err != nil {
		return fmt.Errorf("fetch GitHub user for action token: %w", err)
	}
	if ghUser == nil || strings.TrimSpace(ghUser.Login) == "" {
		return fmt.Errorf("GitHub token did not identify a user")
	}

	githubUsername := "github:" + ghUser.Login
	if strings.EqualFold(claims.Username, githubUsername) {
		return nil
	}

	currentUser, err := h.DB.GetUserByID(r.Context(), claims.UserID)
	if err != nil || currentUser == nil {
		return fmt.Errorf("current Gantry user %q not found", claims.UserID)
	}
	if strings.EqualFold(currentUser.Username, githubUsername) {
		return nil
	}

	if ghUser.Email != "" {
		usersByEmail, err := h.DB.GetUsersByEmail(r.Context(), ghUser.Email)
		if err == nil && len(usersByEmail) == 1 && usersByEmail[0].ID == currentUser.ID {
			return nil
		}
	}

	return fmt.Errorf("GitHub token belongs to %q, not Gantry user %q", ghUser.Login, currentUser.Username)
}

// ListAllActionRuns handles GET /actions/runs. It returns recent runs across
// all actions, ordered by most recent first.
func (h *Handlers) ListAllActionRuns(w http.ResponseWriter, r *http.Request) {
	runs, err := h.DB.ListActionRuns(r.Context(), "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list action runs")
		return
	}
	if runs == nil {
		runs = []*db.ActionRun{}
	}
	writeJSON(w, http.StatusOK, runs)
}

// ListActionRuns handles GET /actions/{name}/runs. It returns all runs for a
// given action, ordered by most recent first.
func (h *Handlers) ListActionRuns(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	runs, err := h.DB.ListActionRuns(r.Context(), name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list action runs")
		return
	}
	if runs == nil {
		runs = []*db.ActionRun{}
	}

	writeJSON(w, http.StatusOK, runs)
}

// GetActionRun handles GET /actions/{name}/runs/{id}. It returns a specific
// action run by its ID.
func (h *Handlers) GetActionRun(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	run, err := h.DB.GetActionRun(r.Context(), id)
	if err != nil {
		if errors.Is(err, entity.ErrEntityNotFound) {
			writeError(w, http.StatusNotFound, "action run not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get action run")
		return
	}

	writeJSON(w, http.StatusOK, run)
}

// GitHubWorkflow is the frontend-facing representation of a GitHub Actions workflow.
type GitHubWorkflow struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Path  string `json:"path"`
	State string `json:"state"`
}

// WorkflowInputDef is the parsed definition of a workflow_dispatch input.
type WorkflowInputDef struct {
	Name        string   `json:"name"`
	Title       string   `json:"title"`
	Type        string   `json:"type"`
	Description string   `json:"description"`
	Required    bool     `json:"required"`
	Default     string   `json:"default"`
	Options     []string `json:"options,omitempty"`
}

// GetGitHubWorkflows handles GET /actions/github-workflows?repo=<url>.
// It lists active workflow_dispatch-capable workflows in the given GitHub repo.
func (h *Handlers) GetGitHubWorkflows(w http.ResponseWriter, r *http.Request) {
	repoURL := r.URL.Query().Get("repo")
	if repoURL == "" {
		writeError(w, http.StatusBadRequest, "repo query parameter is required")
		return
	}

	token, err := h.githubTokenFromPlugin(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	owner, repo, err := parseGitHubRepoURL(repoURL)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	workflows, err := fetchGitHubWorkflows(token, owner, repo)
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("GitHub API error: %s", err.Error()))
		return
	}

	writeJSON(w, http.StatusOK, workflows)
}

// GetGitHubWorkflowInputs handles GET /actions/github-workflow-inputs?repo=<url>&workflow=<file>.
// It fetches the workflow YAML and parses its workflow_dispatch inputs.
func (h *Handlers) GetGitHubWorkflowInputs(w http.ResponseWriter, r *http.Request) {
	repoURL := r.URL.Query().Get("repo")
	workflowFile := r.URL.Query().Get("workflow")
	if repoURL == "" || workflowFile == "" {
		writeError(w, http.StatusBadRequest, "repo and workflow query parameters are required")
		return
	}

	token, err := h.githubTokenFromPlugin(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	owner, repo, err := parseGitHubRepoURL(repoURL)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	inputs, err := fetchWorkflowInputs(token, owner, repo, workflowFile)
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("GitHub API error: %s", err.Error()))
		return
	}

	writeJSON(w, http.StatusOK, inputs)
}

// githubTokenFromPlugin retrieves the GitHub PAT from the installed github plugin.
func (h *Handlers) githubTokenFromPlugin(r *http.Request) (string, error) {
	plugin, err := h.DB.GetPlugin(r.Context(), "github")
	if err != nil {
		return "", fmt.Errorf("GitHub plugin is not installed")
	}
	if !plugin.Enabled {
		return "", fmt.Errorf("GitHub plugin is not enabled")
	}
	if plugin.Config == nil {
		return "", fmt.Errorf("GitHub plugin has no configuration")
	}
	token, _ := plugin.Config["personalAccessToken"].(string)
	if token == "" {
		return "", fmt.Errorf("personalAccessToken is not set in GitHub plugin config")
	}
	return token, nil
}

// parseGitHubRepoURL extracts owner and repo from a GitHub URL.
func parseGitHubRepoURL(rawURL string) (owner, repo string, err error) {
	u := strings.TrimPrefix(rawURL, "https://")
	u = strings.TrimPrefix(u, "http://")
	u = strings.TrimPrefix(u, "github.com/")
	u = strings.TrimSuffix(u, ".git")
	parts := strings.SplitN(strings.Trim(u, "/"), "/", 3)
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return "", "", fmt.Errorf("invalid GitHub repository URL: %s", rawURL)
	}
	return parts[0], parts[1], nil
}

// fetchGitHubWorkflows calls the GitHub Actions API to list workflows in a repo.
func fetchGitHubWorkflows(token, owner, repo string) ([]GitHubWorkflow, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/actions/workflows?per_page=100", owner, repo)
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		var ghErr struct {
			Message string `json:"message"`
		}
		json.NewDecoder(resp.Body).Decode(&ghErr)
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, ghErr.Message)
	}

	var result struct {
		Workflows []struct {
			ID    int64  `json:"id"`
			Name  string `json:"name"`
			Path  string `json:"path"`
			State string `json:"state"`
		} `json:"workflows"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("parsing response: %w", err)
	}

	var workflows []GitHubWorkflow
	for _, wf := range result.Workflows {
		if wf.State == "active" {
			// Extract filename from path (.github/workflows/deploy.yml → deploy.yml)
			path := wf.Path
			if idx := strings.LastIndex(path, "/"); idx >= 0 {
				path = path[idx+1:]
			}
			workflows = append(workflows, GitHubWorkflow{
				ID:    wf.ID,
				Name:  wf.Name,
				Path:  path,
				State: wf.State,
			})
		}
	}
	if workflows == nil {
		workflows = []GitHubWorkflow{}
	}
	return workflows, nil
}

// fetchWorkflowInputs downloads a workflow YAML file from GitHub and parses
// the on.workflow_dispatch.inputs section into WorkflowInputDef records.
func fetchWorkflowInputs(token, owner, repo, workflowFile string) ([]WorkflowInputDef, error) {
	// Fetch file content via GitHub Contents API.
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/contents/.github/workflows/%s",
		owner, repo, workflowFile)
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		var ghErr struct {
			Message string `json:"message"`
		}
		json.NewDecoder(resp.Body).Decode(&ghErr)
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, ghErr.Message)
	}

	var fileResp struct {
		Content  string `json:"content"`
		Encoding string `json:"encoding"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&fileResp); err != nil {
		return nil, fmt.Errorf("parsing file response: %w", err)
	}

	// Decode base64 content.
	if fileResp.Encoding != "base64" {
		return nil, fmt.Errorf("unexpected encoding: %s", fileResp.Encoding)
	}
	cleaned := strings.ReplaceAll(fileResp.Content, "\n", "")
	content, err := base64.StdEncoding.DecodeString(cleaned)
	if err != nil {
		return nil, fmt.Errorf("decoding file content: %w", err)
	}

	// Parse YAML into a generic map.
	var workflow map[string]any
	if err := yaml.Unmarshal(content, &workflow); err != nil {
		return nil, fmt.Errorf("parsing workflow YAML: %w", err)
	}

	// Navigate: on → workflow_dispatch → inputs
	rawOn, _ := workflow["on"]
	inputs := extractWorkflowDispatchInputs(rawOn)
	if inputs == nil {
		inputs = []WorkflowInputDef{}
	}
	return inputs, nil
}

// extractWorkflowDispatchInputs navigates the YAML "on" value to find
// workflow_dispatch.inputs and converts them to WorkflowInputDef records.
func extractWorkflowDispatchInputs(rawOn any) []WorkflowInputDef {
	// "on" can be a string ("push"), a list, or a map.
	onMap, ok := rawOn.(map[string]any)
	if !ok {
		return nil
	}
	wdRaw, ok := onMap["workflow_dispatch"]
	if !ok {
		return nil
	}
	wdMap, ok := wdRaw.(map[string]any)
	if !ok {
		// workflow_dispatch with no inputs (just a key with null value).
		return []WorkflowInputDef{}
	}
	inputsRaw, ok := wdMap["inputs"]
	if !ok {
		return []WorkflowInputDef{}
	}
	inputsMap, ok := inputsRaw.(map[string]any)
	if !ok {
		return []WorkflowInputDef{}
	}

	var result []WorkflowInputDef
	for name, defRaw := range inputsMap {
		def, _ := defRaw.(map[string]any)
		if def == nil {
			def = map[string]any{}
		}

		inputType := stringVal(def, "type")
		// Map GitHub input types to Gantry input types.
		switch inputType {
		case "choice":
			inputType = "select"
		case "boolean":
			inputType = "boolean"
		case "number":
			inputType = "number"
		case "environment":
			inputType = "string"
		default:
			inputType = "string"
		}

		var options []string
		if optsRaw, ok := def["options"]; ok {
			if optsList, ok := optsRaw.([]any); ok {
				for _, o := range optsList {
					if s, ok := o.(string); ok {
						options = append(options, s)
					}
				}
			}
		}

		required := false
		if r, ok := def["required"]; ok {
			switch v := r.(type) {
			case bool:
				required = v
			}
		}

		defaultVal := ""
		if def["default"] != nil {
			defaultVal = fmt.Sprintf("%v", def["default"])
		}

		result = append(result, WorkflowInputDef{
			Name:        name,
			Title:       toTitle(name),
			Type:        inputType,
			Description: stringVal(def, "description"),
			Required:    required,
			Default:     defaultVal,
			Options:     options,
		})
	}
	return result
}

func stringVal(m map[string]any, key string) string {
	v, _ := m[key].(string)
	return v
}

// toTitle converts a snake_case or camelCase name to a human-readable title.
func toTitle(s string) string {
	s = strings.ReplaceAll(s, "_", " ")
	s = strings.ReplaceAll(s, "-", " ")
	if len(s) == 0 {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}
