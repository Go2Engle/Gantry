package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go2engle/gantry/internal/db"
	"github.com/go2engle/gantry/internal/entity"
	"github.com/go2engle/gantry/internal/events"
)

type teamsPluginConfig struct {
	IncomingWebhookSecret string
	GantryBaseURL         string
	TitlePrefix           string
	NotifyOnStart         bool
	NotifyOnSuccess       bool
	NotifyOnFailure       bool
}

type teamsMessageFacts struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// InitTeamsNotifier subscribes the Teams plugin to action lifecycle events.
func (h *Handlers) InitTeamsNotifier() {
	h.teamsNotifierOnce.Do(func() {
		if h.Events == nil {
			return
		}

		h.Events.Subscribe(events.ActionTriggered, h.handleTeamsActionTriggered)
		h.Events.Subscribe(events.ActionRunUpdated, h.handleTeamsActionRunUpdated)
	})
}

func (h *Handlers) handleTeamsActionTriggered(event events.Event) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cfg, ok := h.loadTeamsPluginConfig(ctx)
	if !ok || !cfg.NotifyOnStart {
		return
	}

	runID, _ := event.Data["runId"].(string)
	actionName, _ := event.Data["actionName"].(string)
	triggeredBy, _ := event.Data["triggeredBy"].(string)

	run, actionEntity := h.lookupTeamsActionContext(ctx, runID, actionName)
	actionLabel := teamsActionLabel(actionEntity, actionName)

	facts := []teamsMessageFacts{
		{Name: "Action", Value: actionLabel},
		{Name: "Run ID", Value: runID},
	}
	if triggeredBy != "" {
		facts = append(facts, teamsMessageFacts{Name: "Triggered By", Value: triggeredBy})
	}
	if run != nil && run.StartedAt != nil {
		facts = append(facts, teamsMessageFacts{Name: "Started", Value: run.StartedAt.Format(time.RFC1123)})
	}

	if err := postTeamsWebhook(cfg, teamsWebhookPayload{
		Title:      fmt.Sprintf("%s Action started", cfg.titlePrefix()),
		Summary:    fmt.Sprintf("%s started action %s", cfg.titlePrefix(), actionLabel),
		Text:       fmt.Sprintf("Action `%s` has been queued in Gantry.", actionLabel),
		ThemeColor: "0078D4",
		Facts:      facts,
		ActionURL:  teamsActionURL(cfg.GantryBaseURL),
	}); err != nil {
		log.Printf("teams plugin: send action-start notification: %v", err)
	}
}

func (h *Handlers) handleTeamsActionRunUpdated(event events.Event) {
	status, _ := event.Data["status"].(string)
	if status != "success" && status != "failed" {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cfg, ok := h.loadTeamsPluginConfig(ctx)
	if !ok {
		return
	}
	if status == "success" && !cfg.NotifyOnSuccess {
		return
	}
	if status == "failed" && !cfg.NotifyOnFailure {
		return
	}

	runID, _ := event.Data["runId"].(string)
	actionName, _ := event.Data["actionName"].(string)

	run, actionEntity := h.lookupTeamsActionContext(ctx, runID, actionName)
	actionLabel := teamsActionLabel(actionEntity, actionName)

	title := "Action succeeded"
	summary := fmt.Sprintf("%s completed action %s successfully", cfg.titlePrefix(), actionLabel)
	text := fmt.Sprintf("Action `%s` completed successfully in Gantry.", actionLabel)
	themeColor := "107C10"
	if status == "failed" {
		title = "Action failed"
		summary = fmt.Sprintf("%s action %s failed", cfg.titlePrefix(), actionLabel)
		text = fmt.Sprintf("Action `%s` failed in Gantry.", actionLabel)
		themeColor = "D13438"
	}

	facts := []teamsMessageFacts{
		{Name: "Action", Value: actionLabel},
		{Name: "Run ID", Value: runID},
		{Name: "Status", Value: strings.ToUpper(status)},
	}
	if run != nil {
		if run.TriggeredBy != "" {
			facts = append(facts, teamsMessageFacts{Name: "Triggered By", Value: run.TriggeredBy})
		}
		if run.CompletedAt != nil {
			facts = append(facts, teamsMessageFacts{Name: "Completed", Value: run.CompletedAt.Format(time.RFC1123)})
		}
		if status == "failed" && run.Error != "" {
			text += fmt.Sprintf("\n\nError: `%s`", teamsTrim(run.Error, 400))
		}
	}

	if err := postTeamsWebhook(cfg, teamsWebhookPayload{
		Title:      fmt.Sprintf("%s %s", cfg.titlePrefix(), title),
		Summary:    summary,
		Text:       text,
		ThemeColor: themeColor,
		Facts:      facts,
		ActionURL:  teamsActionURL(cfg.GantryBaseURL),
	}); err != nil {
		log.Printf("teams plugin: send action-%s notification: %v", status, err)
	}
}

func (h *Handlers) loadTeamsPluginConfig(ctx context.Context) (teamsPluginConfig, bool) {
	cfg := teamsPluginConfig{
		NotifyOnStart:   true,
		NotifyOnSuccess: true,
		NotifyOnFailure: true,
		TitlePrefix:     "Gantry",
	}

	now := time.Now()

	h.teamsCfgMu.RLock()
	if now.Before(h.cachedTeamsExpiry) {
		cachedCfg := h.cachedTeamsConfig
		cachedOK := h.cachedTeamsOK
		h.teamsCfgMu.RUnlock()
		return cachedCfg, cachedOK
	}
	h.teamsCfgMu.RUnlock()

	h.teamsCfgMu.Lock()
	defer h.teamsCfgMu.Unlock()

	now = time.Now()
	if now.Before(h.cachedTeamsExpiry) {
		return h.cachedTeamsConfig, h.cachedTeamsOK
	}

	plugin, err := h.DB.GetPlugin(ctx, "teams")
	if err != nil {
		log.Printf("teams plugin: failed to load plugin config: %v", err)
		h.cachedTeamsConfig = cfg
		h.cachedTeamsOK = false
		h.cachedTeamsExpiry = time.Time{}
		return cfg, false
	}
	if plugin == nil || !plugin.Enabled || plugin.Config == nil {
		h.cachedTeamsConfig = cfg
		h.cachedTeamsOK = false
		h.cachedTeamsExpiry = now.Add(60 * time.Second)
		return cfg, false
	}

	cfg.IncomingWebhookSecret, _ = plugin.Config["incomingWebhookSecret"].(string)
	cfg.GantryBaseURL, _ = plugin.Config["gantryBaseUrl"].(string)
	cfg.TitlePrefix, _ = plugin.Config["titlePrefix"].(string)
	if cfg.TitlePrefix == "" {
		cfg.TitlePrefix = "Gantry"
	}
	cfg.GantryBaseURL = strings.TrimRight(cfg.GantryBaseURL, "/")

	if v, ok := plugin.Config["notifyOnStart"].(bool); ok {
		cfg.NotifyOnStart = v
	}
	if v, ok := plugin.Config["notifyOnSuccess"].(bool); ok {
		cfg.NotifyOnSuccess = v
	}
	if v, ok := plugin.Config["notifyOnFailure"].(bool); ok {
		cfg.NotifyOnFailure = v
	}

	h.cachedTeamsConfig = cfg
	h.cachedTeamsOK = cfg.IncomingWebhookSecret != ""
	h.cachedTeamsExpiry = now.Add(60 * time.Second)

	return cfg, h.cachedTeamsOK
}

func (h *Handlers) lookupTeamsActionContext(ctx context.Context, runID, actionName string) (*db.ActionRun, *entity.Entity) {
	var run *db.ActionRun
	if runID != "" {
		r, err := h.DB.GetActionRun(ctx, runID)
		if err == nil {
			run = r
		}
	}

	var actionEntity *entity.Entity
	if actionName != "" {
		e, err := h.DB.GetEntity(ctx, "Action", entity.DefaultNamespace, actionName)
		if err == nil {
			actionEntity = e
		}
	}

	return run, actionEntity
}

func teamsActionLabel(actionEntity *entity.Entity, fallback string) string {
	if actionEntity != nil {
		if actionEntity.Metadata.Title != "" {
			return actionEntity.Metadata.Title
		}
		if actionEntity.Metadata.Name != "" {
			return actionEntity.Metadata.Name
		}
	}
	if fallback != "" {
		return fallback
	}
	return "unknown-action"
}

func (c teamsPluginConfig) titlePrefix() string {
	if c.TitlePrefix == "" {
		return "Gantry"
	}
	return c.TitlePrefix
}

func teamsTrim(value string, max int) string {
	value = strings.TrimSpace(value)
	if len(value) <= max {
		return value
	}
	return strings.TrimSpace(value[:max-3]) + "..."
}

func teamsActionURL(baseURL string) string {
	if baseURL == "" {
		return ""
	}
	return baseURL + "/actions"
}

type teamsWebhookPayload struct {
	Title      string
	Summary    string
	Text       string
	ThemeColor string
	Facts      []teamsMessageFacts
	ActionURL  string
}

func postTeamsWebhook(cfg teamsPluginConfig, payload teamsWebhookPayload) error {
	body := map[string]any{
		"@type":    "MessageCard",
		"@context": "https://schema.org/extensions",
		"summary":  payload.Summary,
		"title":    payload.Title,
		"text":     payload.Text,
	}
	if payload.ThemeColor != "" {
		body["themeColor"] = payload.ThemeColor
	}
	if len(payload.Facts) > 0 {
		body["sections"] = []map[string]any{
			{
				"facts": payload.Facts,
			},
		}
	}
	if payload.ActionURL != "" {
		body["potentialAction"] = []map[string]any{
			{
				"@type": "OpenUri",
				"name":  "Open Gantry",
				"targets": []map[string]string{
					{"os": "default", "uri": payload.ActionURL},
				},
			},
		}
	}

	data, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	parsed, err := url.Parse(cfg.IncomingWebhookSecret)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return errors.New("teams webhook URL must be an absolute https URL")
	}

	req, err := http.NewRequest(http.MethodPost, parsed.String(), bytes.NewReader(data))
	if err != nil {
		return errors.New("build request failed")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Gantry/1.0 TeamsNotifier")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return errors.New("post webhook failed")
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("teams webhook returned HTTP %d", resp.StatusCode)
	}
	return nil
}
