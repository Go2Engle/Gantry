package dispatcher

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go2engle/gantry/internal/config"
	"github.com/go2engle/gantry/internal/db"
	"github.com/go2engle/gantry/internal/entity"
	"github.com/go2engle/gantry/internal/events"
)

func TestDispatchGitHubActionReflectsFailedWorkflowConclusion(t *testing.T) {
	database := newDispatcherTestDB(t)
	now := time.Now().UTC()
	workflowRun := githubWorkflowRun{
		ID:         12345,
		HTMLURL:    "https://github.com/acme/widget/actions/runs/12345",
		Status:     "completed",
		Conclusion: "failure",
		CreatedAt:  now.Format(time.RFC3339),
		HeadBranch: "main",
		RunNumber:  7,
	}

	manager := New(database, events.New())
	manager.githubAPIBaseURL = "https://api.github.test"
	manager.githubPollInterval = time.Millisecond
	manager.githubPollTimeout = time.Second
	manager.client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/repos/acme/widget/actions/workflows/deploy.yml/dispatches":
			return testResponse(http.StatusNoContent, nil), nil
		case r.Method == http.MethodGet && r.URL.Path == "/repos/acme/widget/actions/workflows/deploy.yml/runs":
			return testResponse(http.StatusOK, map[string]any{"workflow_runs": []githubWorkflowRun{workflowRun}}), nil
		default:
			t.Fatalf("unexpected GitHub API request: %s %s", r.Method, r.URL.String())
			return nil, nil
		}
	})}

	action := &entity.Entity{
		Kind: "Action",
		Metadata: entity.EntityMetadata{
			Name: "deploy",
		},
		Spec: map[string]any{
			"type": "github-action",
			"config": map[string]any{
				"repoUrl":  "https://github.com/acme/widget",
				"workflow": "deploy.yml",
				"ref":      "main",
				"token":    "test-token",
			},
		},
	}
	run := &db.ActionRun{
		ActionName:  "deploy",
		Status:      "pending",
		TriggeredBy: "tester",
		StartedAt:   &now,
	}
	if err := database.CreateActionRun(context.Background(), run); err != nil {
		t.Fatalf("CreateActionRun() error = %v", err)
	}

	manager.Dispatch(action, run, nil)

	storedRun, err := database.GetActionRun(context.Background(), run.ID)
	if err != nil {
		t.Fatalf("GetActionRun() error = %v", err)
	}
	if storedRun.Status != "failed" {
		t.Fatalf("stored run status = %q, want failed", storedRun.Status)
	}
	if !strings.Contains(storedRun.Error, `conclusion "failure"`) {
		t.Fatalf("stored run error = %q, want GitHub failure conclusion", storedRun.Error)
	}

	var output githubActionOutput
	if err := json.Unmarshal([]byte(storedRun.Outputs), &output); err != nil {
		t.Fatalf("unmarshal outputs: %v", err)
	}
	if output.RunURL != workflowRun.HTMLURL {
		t.Fatalf("output run URL = %q, want %q", output.RunURL, workflowRun.HTMLURL)
	}
	if output.Conclusion != "failure" {
		t.Fatalf("output conclusion = %q, want failure", output.Conclusion)
	}
}

func TestDispatchGitHubActionPollsWorkflowRunUntilSuccess(t *testing.T) {
	database := newDispatcherTestDB(t)
	now := time.Now().UTC()
	inProgressRun := githubWorkflowRun{
		ID:         54321,
		HTMLURL:    "https://github.com/acme/widget/actions/runs/54321",
		Status:     "in_progress",
		CreatedAt:  now.Format(time.RFC3339),
		HeadBranch: "main",
		RunNumber:  8,
	}
	completedRun := inProgressRun
	completedRun.Status = "completed"
	completedRun.Conclusion = "success"

	statusPolls := 0
	manager := New(database, events.New())
	manager.githubAPIBaseURL = "https://api.github.test"
	manager.githubPollInterval = time.Millisecond
	manager.githubPollTimeout = time.Second
	manager.client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/repos/acme/widget/actions/workflows/deploy.yml/dispatches":
			return testResponse(http.StatusNoContent, nil), nil
		case r.Method == http.MethodGet && r.URL.Path == "/repos/acme/widget/actions/workflows/deploy.yml/runs":
			return testResponse(http.StatusOK, map[string]any{"workflow_runs": []githubWorkflowRun{inProgressRun}}), nil
		case r.Method == http.MethodGet && r.URL.Path == "/repos/acme/widget/actions/runs/54321":
			statusPolls++
			return testResponse(http.StatusOK, completedRun), nil
		default:
			t.Fatalf("unexpected GitHub API request: %s %s", r.Method, r.URL.String())
			return nil, nil
		}
	})}

	action := &entity.Entity{
		Kind: "Action",
		Metadata: entity.EntityMetadata{
			Name: "deploy",
		},
		Spec: map[string]any{
			"type": "github-action",
			"config": map[string]any{
				"repoUrl":  "https://github.com/acme/widget",
				"workflow": "deploy.yml",
				"ref":      "main",
				"token":    "test-token",
			},
		},
	}
	run := &db.ActionRun{
		ActionName:  "deploy",
		Status:      "pending",
		TriggeredBy: "tester",
		StartedAt:   &now,
	}
	if err := database.CreateActionRun(context.Background(), run); err != nil {
		t.Fatalf("CreateActionRun() error = %v", err)
	}

	manager.Dispatch(action, run, nil)

	if statusPolls == 0 {
		t.Fatal("expected Gantry to poll the exact workflow run after locating it")
	}
	storedRun, err := database.GetActionRun(context.Background(), run.ID)
	if err != nil {
		t.Fatalf("GetActionRun() error = %v", err)
	}
	if storedRun.Status != "success" {
		t.Fatalf("stored run status = %q, want success", storedRun.Status)
	}

	var output githubActionOutput
	if err := json.Unmarshal([]byte(storedRun.Outputs), &output); err != nil {
		t.Fatalf("unmarshal outputs: %v", err)
	}
	if output.RunID != completedRun.ID {
		t.Fatalf("output run ID = %d, want %d", output.RunID, completedRun.ID)
	}
	if output.Conclusion != "success" {
		t.Fatalf("output conclusion = %q, want success", output.Conclusion)
	}
}

func newDispatcherTestDB(t *testing.T) *db.DB {
	t.Helper()

	dataDir := t.TempDir()
	cfg := config.Default()
	cfg.DataDir = dataDir
	cfg.DBDSN = filepath.Join(dataDir, "gantry.db")

	database, err := db.New(cfg)
	if err != nil {
		t.Fatalf("db.New() error = %v", err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Fatalf("Close() error = %v", err)
		}
	})
	if err := database.Migrate(); err != nil {
		t.Fatalf("Migrate() error = %v", err)
	}
	return database
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func testResponse(status int, value any) *http.Response {
	var body io.ReadCloser = http.NoBody
	if value != nil {
		var buf bytes.Buffer
		if err := json.NewEncoder(&buf).Encode(value); err != nil {
			panic(err)
		}
		body = io.NopCloser(&buf)
	}
	return &http.Response{
		StatusCode: status,
		Header:     make(http.Header),
		Body:       body,
	}
}
