// Package api provides the HTTP server and routing for the Gantry API.
package api

import (
	"context"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/go2engle/gantry/internal/api/handlers"
	"github.com/go2engle/gantry/internal/api/middleware"
	"github.com/go2engle/gantry/internal/api/websocket"
	"github.com/go2engle/gantry/internal/auth"
	"github.com/go2engle/gantry/internal/config"
	"github.com/go2engle/gantry/internal/db"
	"github.com/go2engle/gantry/internal/dispatcher"
	"github.com/go2engle/gantry/internal/entity"
	"github.com/go2engle/gantry/internal/events"
	"github.com/go2engle/gantry/internal/metrics"
	"github.com/go2engle/gantry/internal/search"
	"github.com/go2engle/gantry/web"
)

// Server is the Gantry HTTP server.
type Server struct {
	config   *config.Config
	handler  http.Handler
	port     int
	Handlers *handlers.Handlers
}

// NewServer creates a new Gantry API server with all routes configured.
func NewServer(cfg *config.Config, database *db.DB, authSvc *auth.Service, eventBus *events.Bus, validator *entity.SchemaValidator, searchSvc *search.Service, wsHub *websocket.Hub, version string) *Server {
	r := chi.NewRouter()

	// Core middleware.
	r.Use(chimiddleware.RequestID)
	r.Use(chimiddleware.RealIP)
	r.Use(chimiddleware.Recoverer)
	r.Use(middleware.RequestLogger)

	// CORS middleware.
	if cfg.DevMode {
		r.Use(cors.Handler(cors.Options{
			AllowedOrigins:   []string{"*"},
			AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
			AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
			ExposedHeaders:   []string{"Link"},
			AllowCredentials: true,
			MaxAge:           300,
		}))
	} else {
		r.Use(cors.Handler(cors.Options{
			AllowedOrigins:   []string{""}, // same-origin only
			AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
			AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
			ExposedHeaders:   []string{"Link"},
			AllowCredentials: true,
			MaxAge:           300,
		}))
	}

	// Build handlers.
	h := &handlers.Handlers{
		DB:         database,
		Auth:       authSvc,
		Events:     eventBus,
		Validator:  validator,
		SearchSvc:  searchSvc,
		Dispatcher: dispatcher.New(database, eventBus),
		DataDir:    cfg.DataDir,
		Version:    version,
	}
	h.InitTeamsNotifier()

	// Health check routes (public).
	r.Get("/healthz", h.Healthz)
	r.Get("/readyz", h.Readyz)

	// Prometheus metrics (public -- scrape targets typically don't send auth).
	r.Handle("/metrics", metrics.Handler(func() {
		counts, err := database.CountEntitiesByKind(context.Background())
		if err == nil {
			for kind, count := range counts {
				metrics.EntitiesTotal.Set(map[string]string{"kind": kind}, count)
			}
		}
	}))

	// API v1 routes.
	r.Route("/api/v1", func(api chi.Router) {
		api.Use(middleware.RateLimit)
		// Public endpoints.
		api.Get("/version", h.GetVersion)
		api.Post("/auth/login", h.Login)
		// GitHub SSO — public; used by login page and OAuth redirect flow.
		api.Get("/auth/github/config", h.GetGitHubSSOConfig)
		api.Get("/auth/github", h.GitHubOAuthBegin)
		api.Get("/auth/github/callback", h.GitHubOAuthCallback)

		// Authenticated routes.
		api.Group(func(protected chi.Router) {
			protected.Use(middleware.RequireAuth(authSvc, database))

			// Auth endpoints.
			protected.Get("/auth/me", h.GetMe)
			protected.Post("/auth/logout", h.Logout)
			protected.Put("/auth/me/password", h.ChangePassword)
			protected.With(middleware.RequireRole("admin")).Post("/auth/register", h.Register)

			// User management (admin only).
			protected.With(middleware.RequireRole("admin")).Get("/auth/users", h.ListUsers)
			protected.With(middleware.RequireRole("admin")).Put("/auth/users/{id}", h.UpdateUser)
			protected.With(middleware.RequireRole("admin")).Put("/auth/users/{id}/password", h.ResetPassword)
			protected.With(middleware.RequireRole("admin")).Delete("/auth/users/{id}", h.DeleteUser)

			// API key management.
			protected.Get("/auth/apikeys", h.ListAPIKeys)
			protected.Post("/auth/apikeys", h.CreateAPIKey)
			protected.Delete("/auth/apikeys/{id}", h.RevokeAPIKey)

			// Groups. Read: platform-engineer+. Write: admin only.
			protected.With(middleware.RequireRole("platform-engineer")).Get("/groups", h.ListGroups)
			protected.With(middleware.RequireRole("admin")).Post("/groups", h.CreateGroup)
			protected.With(middleware.RequireRole("platform-engineer")).Get("/groups/{id}", h.GetGroupDetail)
			protected.With(middleware.RequireRole("admin")).Put("/groups/{id}", h.UpdateGroup)
			protected.With(middleware.RequireRole("admin")).Delete("/groups/{id}", h.DeleteGroup)
			protected.With(middleware.RequireRole("platform-engineer")).Get("/groups/{id}/members", h.ListGroupMembers)
			protected.With(middleware.RequireRole("admin")).Post("/groups/{id}/members", h.AddGroupMember)
			protected.With(middleware.RequireRole("admin")).Delete("/groups/{id}/members/{userId}", h.RemoveGroupMember)

			// RBAC roles. Admin only.
			protected.With(middleware.RequireRole("admin")).Get("/rbac/roles", h.ListRoles)
			protected.With(middleware.RequireRole("admin")).Post("/rbac/roles", h.CreateRole)
			protected.With(middleware.RequireRole("admin")).Get("/rbac/roles/{id}", h.GetRoleByID)
			protected.With(middleware.RequireRole("admin")).Put("/rbac/roles/{id}", h.UpdateRole)
			protected.With(middleware.RequireRole("admin")).Delete("/rbac/roles/{id}", h.DeleteRole)

			// RBAC rules. Admin only (except effective permissions for self).
			protected.With(middleware.RequireRole("admin")).Get("/rbac/rules", h.ListPermissionRules)
			protected.With(middleware.RequireRole("admin")).Post("/rbac/rules", h.CreatePermissionRule)
			protected.With(middleware.RequireRole("admin")).Delete("/rbac/rules/{id}", h.DeletePermissionRule)
			protected.Get("/rbac/effective/{userId}", h.GetEffectivePermissions)
			protected.With(middleware.RequireRole("admin")).Get("/rbac/export", h.ExportRBACConfig)
			protected.With(middleware.RequireRole("admin")).Post("/rbac/import", h.ImportRBACConfig)

			// Entity CRUD. Read: any authenticated user. Write: developer+.
			protected.Get("/entities", h.ListEntities)
			protected.Get("/entities/{kind}", h.ListEntitiesByKind)
			protected.Get("/entities/{kind}/{name}", h.GetEntity)
			protected.With(middleware.RequireRole("developer")).Post("/entities", h.CreateEntity)
			protected.With(middleware.RequireRole("developer")).Put("/entities/{kind}/{name}", h.UpdateEntity)
			protected.With(middleware.RequireRole("developer")).Delete("/entities/{kind}/{name}", h.DeleteEntity)

			// Search.
			protected.Get("/search", h.Search)

			// Relationship graph.
			protected.Get("/graph/{kind}/{name}", h.GetEntityGraph)

			// Schemas.
			protected.Get("/schemas", h.ListSchemas)
			protected.Get("/schemas/{kind}", h.GetSchema)

			// Actions. Execute: developer+.
			protected.Get("/actions", h.ListActions)
			// GitHub-specific action helper endpoints (before {name} wildcard routes).
			protected.Get("/actions/github-workflows", h.GetGitHubWorkflows)
			protected.Get("/actions/github-workflow-inputs", h.GetGitHubWorkflowInputs)
			protected.Get("/actions/runs", h.ListAllActionRuns)
			protected.With(middleware.RequireRole("developer")).Post("/actions/{name}/execute", h.ExecuteAction)
			protected.Get("/actions/{name}/runs", h.ListActionRuns)
			protected.Get("/actions/{name}/runs/{id}", h.GetActionRun)

			// Dashboard config. Read: any authenticated user. Write: admin only.
			protected.Get("/dashboard/config", h.GetDashboardConfig)
			protected.With(middleware.RequireRole("admin")).Put("/dashboard/config", h.SetDashboardConfig)

			// User browsing history (per-user, not shared).
			protected.Get("/history", h.GetHistory)
			protected.Post("/history", h.RecordHistory)

			// Audit log (admin only).
			protected.With(middleware.RequireRole("admin")).Get("/audit", h.ListAuditEntries)

			// Health check proxy (fetches external health URLs for the frontend).
			protected.Get("/health-check", h.HealthCheckProxy)

			// Plugin marketplace. Sensitive plugin detail/config reads and writes require developer+.
			protected.Get("/plugins", h.ListPlugins)
			// Kubernetes-specific plugin endpoints (before generic {name} routes).
			protected.Get("/plugins/kubernetes/workload/{appName}", h.GetKubernetesWorkload)
			protected.Get("/plugins/kubernetes/pods/{namespace}/{pod}/containers/{container}/logs", h.StreamKubernetesPodLogs)
			// GitHub-specific plugin endpoints.
			protected.Get("/plugins/github/repo", h.GetGitHubRepo)
			// Status Monitor plugin endpoints.
			protected.Get("/plugins/status-monitor/statuses", h.GetStatusMonitorStatuses)
			protected.Get("/plugins/status-monitor/providers", h.GetStatusMonitorProviders)
			// GitOps plugin endpoints (admin only).
			protected.With(middleware.RequireRole("admin")).Get("/plugins/gitops/status", h.GetGitOpsStatus)
			protected.With(middleware.RequireRole("admin")).Get("/plugins/gitops/history", h.GetGitOpsHistory)
			protected.With(middleware.RequireRole("admin")).Get("/plugins/gitops/files", h.GetGitOpsFiles)
			protected.With(middleware.RequireRole("admin")).Get("/plugins/gitops/file-content", h.GetGitOpsFileContent)
			protected.With(middleware.RequireRole("admin")).Post("/plugins/gitops/sync", h.TriggerGitOpsSync)
			protected.With(middleware.RequireRole("admin")).Post("/plugins/gitops/pull", h.TriggerGitOpsPull)
			protected.With(middleware.RequireRole("admin")).Post("/plugins/gitops/bidisync", h.TriggerGitOpsBidirectionalSync)
			// Harbor plugin endpoints.
			protected.Get("/plugins/harbor/repositories", h.GetHarborRepositories)
			protected.Get("/plugins/harbor/artifacts", h.GetHarborArtifacts)
			protected.Get("/plugins/harbor/vulnerabilities", h.GetHarborVulnerabilities)
			protected.Get("/plugins/harbor/summary", h.GetHarborSummary)
			// ArgoCD-specific plugin endpoints.
			protected.Get("/plugins/argocd/entity-apps", h.GetArgoCDEntityApps)
			protected.Get("/plugins/argocd/apps/{appName}", h.GetArgoCDApp)
			protected.With(middleware.RequireRole("developer")).Post("/plugins/argocd/apps/{appName}/sync", h.SyncArgoCDApp)
			protected.With(middleware.RequireRole("developer")).Post("/plugins/argocd/apps/{appName}/refresh", h.RefreshArgoCDApp)
			protected.With(middleware.RequireRole("platform-engineer")).Get("/plugins/{name}", h.GetPlugin)
			protected.With(middleware.RequireRole("platform-engineer")).Put("/plugins/{name}/enable", h.EnablePlugin)
			protected.With(middleware.RequireRole("platform-engineer")).Get("/plugins/{name}/config", h.GetPluginConfig)
			protected.With(middleware.RequireRole("platform-engineer")).Put("/plugins/{name}/config", h.UpdatePluginConfig)
			protected.With(middleware.RequireRole("platform-engineer")).Post("/plugins/{name}/sync", h.SyncPlugin)
		})

		// WebSocket. Browsers authenticate via same-origin session cookies; other
		// clients can still use Authorization headers.
		api.With(middleware.RequireWebSocketAuth(authSvc, database)).Get("/ws", wsHub.ServeWS)
	})

	// Serve frontend static files.
	// In dev mode, prefer the on-disk web/dist directory for hot-reload.
	// In production, use the embedded filesystem built into the binary.
	webDir := filepath.Join("web", "dist")
	if info, err := os.Stat(webDir); err == nil && info.IsDir() {
		spaHandler := spaFileServer(http.Dir(webDir))
		r.NotFound(spaHandler.ServeHTTP)
	} else if distFS, err := fs.Sub(web.DistFS, "dist"); err == nil {
		// Check that the embedded FS actually has content (index.html).
		if _, err := distFS.Open("index.html"); err == nil {
			spaHandler := spaFileServer(http.FS(distFS))
			r.NotFound(spaHandler.ServeHTTP)
		}
	}

	return &Server{
		config:   cfg,
		handler:  r,
		port:     cfg.Port,
		Handlers: h,
	}
}

// Router returns the HTTP handler for use with a custom http.Server.
func (s *Server) Router() http.Handler {
	return s.handler
}

// Start begins listening for HTTP requests on the configured port.
func (s *Server) Start() error {
	addr := fmt.Sprintf(":%d", s.port)
	return http.ListenAndServe(addr, s.handler)
}

// spaFileServer returns an http.Handler that serves static files from root.
// If a requested file does not exist, it falls back to serving index.html
// to support single-page application (SPA) client-side routing.
func spaFileServer(root http.FileSystem) http.Handler {
	fs := http.FileServer(root)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Try to open the requested file.
		path := filepath.Clean(r.URL.Path)
		if path == "" {
			path = "/"
		}

		f, err := root.Open(path)
		if err != nil {
			// File not found -- serve index.html for SPA routing.
			r.URL.Path = "/"
			fs.ServeHTTP(w, r)
			return
		}
		f.Close()

		// File exists -- serve it normally.
		fs.ServeHTTP(w, r)
	})
}
