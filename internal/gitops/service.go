package gitops

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/go-git/go-git/v5"
	gitconfig "github.com/go-git/go-git/v5/config"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/object"
	"github.com/go-git/go-git/v5/plumbing/transport"
	githttp "github.com/go-git/go-git/v5/plumbing/transport/http"
	"github.com/go2engle/gantry/internal/db"
	"github.com/go2engle/gantry/internal/entity"
)

// Config holds the configuration for the GitOps service.
type Config struct {
	RepoURL           string
	Branch            string
	AuthToken         string
	BasePath          string
	AutoPush          bool
	CommitAuthorName  string
	CommitAuthorEmail string
	SyncInterval      string
	DataDir           string
}

// SyncStatus represents the current state of the GitOps sync.
type SyncStatus struct {
	Connected    bool   `json:"connected"`
	RepoURL      string `json:"repoUrl,omitempty"`
	Branch       string `json:"branch,omitempty"`
	LastCommit   string `json:"lastCommit,omitempty"`
	LastCommitAt string `json:"lastCommitAt,omitempty"`
	LastPushAt   string `json:"lastPushAt,omitempty"`
	LastPullAt   string `json:"lastPullAt,omitempty"`
	LastError    string `json:"lastError,omitempty"`
	PendingFiles int    `json:"pendingFiles"`
}

// SyncHistoryEntry records a single sync operation.
type SyncHistoryEntry struct {
	ID        string `json:"id"`
	Timestamp string `json:"timestamp"`
	Direction string `json:"direction"` // "push" or "pull"
	Commit    string `json:"commit,omitempty"`
	Message   string `json:"message"`
	Files     int    `json:"files"`
	Error     string `json:"error,omitempty"`
}

// FileEntry represents an entity file tracked in the Git repo.
type FileEntry struct {
	Path      string `json:"path"`
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Error     string `json:"error,omitempty"`
}

// PullResult holds the result of a pull + reconcile operation.
type PullResult struct {
	Created      int      `json:"created"`
	Updated      int      `json:"updated"`
	Deleted      int      `json:"deleted"`
	Errors       int      `json:"errors"`
	ErrorDetails []string `json:"errorDetails,omitempty"`
}

type batchItem struct {
	Kind      string
	Namespace string
	Name      string
	Action    string // "write" or "delete"
}

// ChangeRef identifies an entity change to be queued for GitOps processing.
// Used with QueueChanges for batch enqueue operations.
type ChangeRef struct {
	Kind      string
	Namespace string
	Name      string
	Action    string // "write" or "delete"
}

const (
	maxHistory          = 100
	batchDelay          = 2 * time.Second
	defaultBranch       = "main"
	maxPullErrorDetails = 5
)

// Service manages bidirectional Git synchronization for Gantry entities.
type Service struct {
	config Config
	repo   *git.Repository
	db     *db.DB

	mu     sync.Mutex // serializes all git operations
	status SyncStatus

	historyMu sync.Mutex
	history   []SyncHistoryEntry

	batchMu    sync.Mutex
	batchTimer *time.Timer
	batchItems map[string]batchItem // keyed by kind/ns/name to deduplicate

	syncing  bool // true during pull reconciliation to suppress push
	stopCh   chan struct{}
	stopOnce sync.Once
}

// ConfigFromPlugin extracts a gitops Config from a plugin's config map.
func ConfigFromPlugin(pluginConfig map[string]any, dataDir string) Config {
	getString := func(key, def string) string {
		if v, ok := pluginConfig[key].(string); ok && v != "" {
			return v
		}
		return def
	}
	getBool := func(key string, def bool) bool {
		if v, ok := pluginConfig[key].(bool); ok {
			return v
		}
		return def
	}

	return Config{
		RepoURL:           getString("repoUrl", ""),
		Branch:            getString("branch", defaultBranch),
		AuthToken:         getString("authToken", ""),
		BasePath:          strings.TrimSuffix(getString("basePath", ""), "/"),
		AutoPush:          getBool("autoPush", true),
		CommitAuthorName:  getString("commitAuthorName", "Gantry GitOps"),
		CommitAuthorEmail: getString("commitAuthorEmail", "gantry@localhost"),
		SyncInterval:      getString("syncInterval", ""),
		DataDir:           filepath.Join(dataDir, "gitops"),
	}
}

// New creates a new GitOps service. It clones the repo if not already present
// or opens an existing local clone.
func New(cfg Config, database *db.DB) (*Service, error) {
	if cfg.RepoURL == "" {
		return nil, fmt.Errorf("gitops: repository URL is required")
	}
	if cfg.Branch == "" {
		cfg.Branch = defaultBranch
	}

	s := &Service{
		config:     cfg,
		db:         database,
		batchItems: make(map[string]batchItem),
		stopCh:     make(chan struct{}),
		status: SyncStatus{
			RepoURL: cfg.RepoURL,
			Branch:  cfg.Branch,
		},
	}

	// Restore sync history from previous runs.
	s.loadHistory()

	if err := s.ensureRepo(); err != nil {
		s.status.LastError = err.Error()
		return s, nil // return service even on clone failure so status is visible
	}

	s.status.Connected = true
	s.updateLastCommit()

	return s, nil
}

// ensureRepo clones the repo or opens an existing clone.
func (s *Service) ensureRepo() error {
	if err := os.MkdirAll(s.config.DataDir, 0o755); err != nil {
		return fmt.Errorf("creating data dir: %w", err)
	}

	repoPath := filepath.Join(s.config.DataDir, "repo")

	// Try opening existing repo first.
	repo, err := git.PlainOpen(repoPath)
	if err == nil {
		s.repo = repo
		return s.pullLatest()
	}

	// Clone fresh.
	opts := &git.CloneOptions{
		URL:           s.config.RepoURL,
		ReferenceName: plumbing.NewBranchReferenceName(s.config.Branch),
		SingleBranch:  true,
		Auth:          s.authMethod(),
	}

	repo, err = git.PlainClone(repoPath, false, opts)
	if err != nil {
		// Handle empty remote repository — init locally and add remote.
		if errors.Is(err, transport.ErrEmptyRemoteRepository) {
			return s.initEmptyRepo(repoPath)
		}
		return fmt.Errorf("cloning repository: %w", err)
	}

	s.repo = repo
	return nil
}

// initEmptyRepo sets up a local repo with the remote configured, for use when
// the remote repository has no commits yet.
func (s *Service) initEmptyRepo(repoPath string) error {
	os.RemoveAll(repoPath) // clean up any partial clone

	repo, err := git.PlainInit(repoPath, false)
	if err != nil {
		return fmt.Errorf("initializing empty repo: %w", err)
	}

	_, err = repo.CreateRemote(&gitconfig.RemoteConfig{
		Name: "origin",
		URLs: []string{s.config.RepoURL},
	})
	if err != nil {
		return fmt.Errorf("adding remote: %w", err)
	}

	// Set HEAD to the configured branch so first commit lands on the right branch.
	ref := plumbing.NewSymbolicReference(plumbing.HEAD, plumbing.NewBranchReferenceName(s.config.Branch))
	if err := repo.Storer.SetReference(ref); err != nil {
		return fmt.Errorf("setting HEAD to branch %s: %w", s.config.Branch, err)
	}

	s.repo = repo
	return nil
}

func (s *Service) authMethod() *githttp.BasicAuth {
	if s.config.AuthToken == "" {
		return nil
	}
	return &githttp.BasicAuth{
		Username: "gantry", // username is ignored for PAT auth
		Password: s.config.AuthToken,
	}
}

// pullLatest fetches and merges the latest changes from the remote.
func (s *Service) pullLatest() error {
	w, err := s.repo.Worktree()
	if err != nil {
		return fmt.Errorf("getting worktree: %w", err)
	}

	err = w.Pull(&git.PullOptions{
		RemoteName:    "origin",
		ReferenceName: plumbing.NewBranchReferenceName(s.config.Branch),
		Auth:          s.authMethod(),
		Force:         true,
	})

	if err == nil || err == git.NoErrAlreadyUpToDate {
		return nil
	}

	// Empty remote — nothing to pull.
	if errors.Is(err, transport.ErrEmptyRemoteRepository) {
		return nil
	}

	// Local branch doesn't exist yet (repo was initialized from an empty remote
	// and this is the first pull after the remote got commits). Fall back to
	// fetch + checkout.
	if errors.Is(err, plumbing.ErrReferenceNotFound) {
		return s.fetchAndCheckout()
	}

	return fmt.Errorf("pulling from remote: %w", err)
}

// fetchAndCheckout handles the first pull for repos initialized from an empty
// remote. It fetches from origin, creates a local branch from the remote ref,
// and checks out the worktree.
func (s *Service) fetchAndCheckout() error {
	branchRefName := plumbing.NewBranchReferenceName(s.config.Branch)

	err := s.repo.Fetch(&git.FetchOptions{
		RemoteName: "origin",
		Auth:       s.authMethod(),
		RefSpecs: []gitconfig.RefSpec{
			gitconfig.RefSpec("refs/heads/" + s.config.Branch + ":refs/remotes/origin/" + s.config.Branch),
		},
	})
	if err != nil && err != git.NoErrAlreadyUpToDate {
		if errors.Is(err, transport.ErrEmptyRemoteRepository) {
			return nil
		}
		return fmt.Errorf("fetching from remote: %w", err)
	}

	// Resolve the remote tracking ref.
	remoteRef, err := s.repo.Reference(plumbing.NewRemoteReferenceName("origin", s.config.Branch), true)
	if err != nil {
		return nil // remote branch doesn't exist yet
	}

	// Create (or update) the local branch to point at the same commit.
	localRef := plumbing.NewHashReference(branchRefName, remoteRef.Hash())
	if err := s.repo.Storer.SetReference(localRef); err != nil {
		return fmt.Errorf("creating local branch: %w", err)
	}

	// Checkout to populate the worktree with the files.
	w, err := s.repo.Worktree()
	if err != nil {
		return fmt.Errorf("getting worktree: %w", err)
	}
	return w.Checkout(&git.CheckoutOptions{
		Branch: branchRefName,
		Force:  true,
	})
}

func (s *Service) push() error {
	if !s.config.AutoPush {
		return nil
	}

	err := s.repo.Push(&git.PushOptions{
		RemoteName: "origin",
		Auth:       s.authMethod(),
		RefSpecs: []gitconfig.RefSpec{
			gitconfig.RefSpec("refs/heads/" + s.config.Branch + ":refs/heads/" + s.config.Branch),
		},
	})
	if err != nil && err != git.NoErrAlreadyUpToDate {
		return fmt.Errorf("pushing to remote: %w", err)
	}

	s.status.LastPushAt = time.Now().UTC().Format(time.RFC3339)
	return nil
}

func (s *Service) updateLastCommit() {
	if s.repo == nil {
		return
	}
	ref, err := s.repo.Head()
	if err != nil {
		return
	}
	commit, err := s.repo.CommitObject(ref.Hash())
	if err != nil {
		return
	}
	s.status.LastCommit = ref.Hash().String()[:12]
	s.status.LastCommitAt = commit.Author.When.UTC().Format(time.RFC3339)
}

// WriteEntity serializes an entity and writes it to the local repo.
func (s *Service) WriteEntity(e *entity.Entity) error {
	data, err := SerializeEntity(e)
	if err != nil {
		return err
	}

	relPath := EntityFilePath(s.config.BasePath, e.Kind, e.Metadata.Namespace, e.Metadata.Name)
	w, err := s.repo.Worktree()
	if err != nil {
		return fmt.Errorf("getting worktree: %w", err)
	}

	absPath := filepath.Join(w.Filesystem.Root(), relPath)
	if err := os.MkdirAll(filepath.Dir(absPath), 0o755); err != nil {
		return fmt.Errorf("creating directories: %w", err)
	}

	if err := os.WriteFile(absPath, data, 0o644); err != nil {
		return fmt.Errorf("writing file: %w", err)
	}

	if _, err := w.Add(relPath); err != nil {
		return fmt.Errorf("staging file: %w", err)
	}

	return nil
}

// WriteRBACConfig exports the current RBAC configuration as a JSON file in the Git repo.
func (s *Service) WriteRBACConfig() error {
	ctx := context.Background()

	groups, err := s.db.ListGroups(ctx)
	if err != nil {
		return fmt.Errorf("listing groups: %w", err)
	}

	type rbacGroup struct {
		Name        string `json:"name"`
		DisplayName string `json:"displayName,omitempty"`
		Description string `json:"description,omitempty"`
		Role        string `json:"role"`
	}
	type rbacMembership struct {
		Group string   `json:"group"`
		Users []string `json:"users"`
	}
	type rbacRule struct {
		SubjectType    string `json:"subjectType"`
		SubjectName    string `json:"subjectName"`
		ResourceType   string `json:"resourceType"`
		ResourceFilter string `json:"resourceFilter,omitempty"`
		Action         string `json:"action"`
		Effect         string `json:"effect"`
	}
	type rbacConfig struct {
		Groups           []rbacGroup      `json:"groups"`
		GroupMemberships []rbacMembership `json:"groupMemberships"`
		PermissionRules  []rbacRule       `json:"permissionRules"`
	}

	var cfg rbacConfig
	for _, g := range groups {
		cfg.Groups = append(cfg.Groups, rbacGroup{
			Name:        g.Name,
			DisplayName: g.DisplayName,
			Description: g.Description,
			Role:        g.Role,
		})
		members, err := s.db.ListGroupMembers(ctx, g.ID)
		if err == nil && len(members) > 0 {
			usernames := make([]string, len(members))
			for i, m := range members {
				usernames[i] = m.Username
			}
			cfg.GroupMemberships = append(cfg.GroupMemberships, rbacMembership{
				Group: g.Name,
				Users: usernames,
			})
		}
	}

	rules, err := s.db.ListPermissionRules(ctx)
	if err != nil {
		return fmt.Errorf("listing rules: %w", err)
	}
	for _, r := range rules {
		subjectName := r.SubjectID
		if r.SubjectType == "user" {
			if u, err := s.db.GetUserByID(ctx, r.SubjectID); err == nil {
				subjectName = u.Username
			}
		} else if r.SubjectType == "group" {
			if g, err := s.db.GetGroup(ctx, r.SubjectID); err == nil {
				subjectName = g.Name
			}
		}
		cfg.PermissionRules = append(cfg.PermissionRules, rbacRule{
			SubjectType:    r.SubjectType,
			SubjectName:    subjectName,
			ResourceType:   r.ResourceType,
			ResourceFilter: r.ResourceFilter,
			Action:         r.Action,
			Effect:         r.Effect,
		})
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal rbac config: %w", err)
	}

	relPath := filepath.Join(s.config.BasePath, "_config", "rbac.json")
	w, err := s.repo.Worktree()
	if err != nil {
		return fmt.Errorf("getting worktree: %w", err)
	}

	absPath := filepath.Join(w.Filesystem.Root(), relPath)
	if err := os.MkdirAll(filepath.Dir(absPath), 0o755); err != nil {
		return fmt.Errorf("creating directories: %w", err)
	}
	if err := os.WriteFile(absPath, data, 0o644); err != nil {
		return fmt.Errorf("writing file: %w", err)
	}
	if _, err := w.Add(relPath); err != nil {
		return fmt.Errorf("staging file: %w", err)
	}

	return nil
}

// DeleteEntityFile removes an entity's YAML file from the local repo.
func (s *Service) DeleteEntityFile(kind, namespace, name string) error {
	relPath := EntityFilePath(s.config.BasePath, kind, namespace, name)
	w, err := s.repo.Worktree()
	if err != nil {
		return fmt.Errorf("getting worktree: %w", err)
	}

	absPath := filepath.Join(w.Filesystem.Root(), relPath)
	if _, err := os.Stat(absPath); os.IsNotExist(err) {
		return nil // already gone
	}

	if err := os.Remove(absPath); err != nil {
		return fmt.Errorf("removing file: %w", err)
	}

	if _, err := w.Add(relPath); err != nil {
		return fmt.Errorf("staging removal: %w", err)
	}

	return nil
}

// commitAndPush creates a commit with the given message and pushes if configured.
func (s *Service) commitAndPush(message string) (string, error) {
	w, err := s.repo.Worktree()
	if err != nil {
		return "", fmt.Errorf("getting worktree: %w", err)
	}

	status, err := w.Status()
	if err != nil {
		return "", fmt.Errorf("getting status: %w", err)
	}

	if status.IsClean() {
		return "", nil // nothing to commit
	}

	hash, err := w.Commit(message, &git.CommitOptions{
		Author: &object.Signature{
			Name:  s.config.CommitAuthorName,
			Email: s.config.CommitAuthorEmail,
			When:  time.Now().UTC(),
		},
	})
	if err != nil {
		return "", fmt.Errorf("committing: %w", err)
	}

	commitHash := hash.String()[:12]
	s.status.LastCommit = commitHash
	s.status.LastCommitAt = time.Now().UTC().Format(time.RFC3339)

	if err := s.push(); err != nil {
		return commitHash, err
	}

	return commitHash, nil
}

// QueueChange adds an entity change to the batch. After a 2-second debounce window,
// all queued changes are flushed in a single commit.
// This is called from event bus subscribers.
func (s *Service) QueueChange(kind, namespace, name, action string) {
	if s.syncing {
		return // suppress push during pull reconciliation
	}

	key := kind + "/" + namespace + "/" + name
	s.batchMu.Lock()
	defer s.batchMu.Unlock()

	s.batchItems[key] = batchItem{
		Kind:      kind,
		Namespace: namespace,
		Name:      name,
		Action:    action,
	}
	s.status.PendingFiles = len(s.batchItems)

	if s.batchTimer != nil {
		s.batchTimer.Stop()
	}
	s.batchTimer = time.AfterFunc(batchDelay, s.flushBatch)
}

// QueueChanges adds multiple entity changes to the batch in a single lock
// acquisition, resetting the debounce timer only once. Prefer this over
// calling QueueChange in a loop when many entities are touched at once
// (e.g., after a Kubernetes sync).
func (s *Service) QueueChanges(refs []ChangeRef) {
	if s.syncing || len(refs) == 0 {
		return
	}

	s.batchMu.Lock()
	defer s.batchMu.Unlock()

	for _, ref := range refs {
		key := ref.Kind + "/" + ref.Namespace + "/" + ref.Name
		s.batchItems[key] = batchItem{
			Kind:      ref.Kind,
			Namespace: ref.Namespace,
			Name:      ref.Name,
			Action:    ref.Action,
		}
	}
	s.status.PendingFiles = len(s.batchItems)

	if s.batchTimer != nil {
		s.batchTimer.Stop()
	}
	s.batchTimer = time.AfterFunc(batchDelay, s.flushBatch)
}

// flushBatch processes all queued entity changes.
func (s *Service) flushBatch() {
	s.batchMu.Lock()
	items := make(map[string]batchItem, len(s.batchItems))
	for k, v := range s.batchItems {
		items[k] = v
	}
	s.batchItems = make(map[string]batchItem)
	s.status.PendingFiles = 0
	s.batchMu.Unlock()

	if len(items) == 0 {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.status.Connected || s.repo == nil {
		return
	}

	ctx := context.Background()
	var messages []string
	fileCount := 0

	for _, item := range items {
		// Handle RBAC config as a special case (not an entity).
		if item.Kind == "_config" {
			if err := s.WriteRBACConfig(); err != nil {
				s.setError(fmt.Sprintf("write rbac config: %v", err))
				continue
			}
			messages = append(messages, "update rbac config")
			fileCount++
			continue
		}

		switch item.Action {
		case "write":
			e, err := s.db.GetEntity(ctx, item.Kind, item.Namespace, item.Name)
			if err != nil || e == nil {
				continue // entity may have been deleted already
			}
			if err := s.WriteEntity(e); err != nil {
				s.setError(fmt.Sprintf("write %s/%s/%s: %v", item.Kind, item.Namespace, item.Name, err))
				continue
			}
			messages = append(messages, fmt.Sprintf("update %s/%s", item.Kind, item.Name))
			fileCount++

		case "delete":
			if err := s.DeleteEntityFile(item.Kind, item.Namespace, item.Name); err != nil {
				s.setError(fmt.Sprintf("delete %s/%s/%s: %v", item.Kind, item.Namespace, item.Name, err))
				continue
			}
			messages = append(messages, fmt.Sprintf("delete %s/%s", item.Kind, item.Name))
			fileCount++
		}
	}

	if fileCount == 0 {
		return
	}

	msg := "gantry: " + strings.Join(messages, ", ")
	if len(msg) > 200 {
		msg = fmt.Sprintf("gantry: sync %d entities", fileCount)
	}

	commitHash, err := s.commitAndPush(msg)
	entry := SyncHistoryEntry{
		ID:        fmt.Sprintf("%d", time.Now().UnixNano()),
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Direction: "push",
		Commit:    commitHash,
		Message:   msg,
		Files:     fileCount,
	}
	if err != nil {
		entry.Error = err.Error()
		s.setError(err.Error())
	} else {
		s.status.LastError = ""
	}
	s.addHistory(entry)
}

// FullSync exports all entities from the database to the Git repo.
func (s *Service) FullSync() (*SyncHistoryEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.status.Connected || s.repo == nil {
		return nil, fmt.Errorf("not connected to repository")
	}

	// Pull latest before pushing to reduce conflicts.
	if err := s.pullLatest(); err != nil {
		s.setError(err.Error())
		// continue anyway — we'll push our state
	}

	ctx := context.Background()
	entities, err := s.db.ListEntities(ctx, "", "")
	if err != nil {
		return nil, fmt.Errorf("listing entities: %w", err)
	}

	fileCount := 0
	for _, e := range entities {
		if err := s.WriteEntity(e); err != nil {
			s.setError(fmt.Sprintf("write %s/%s: %v", e.Kind, e.Metadata.Name, err))
			continue
		}
		fileCount++
	}

	msg := fmt.Sprintf("gantry: full sync — %d entities", fileCount)
	commitHash, err := s.commitAndPush(msg)

	entry := SyncHistoryEntry{
		ID:        fmt.Sprintf("%d", time.Now().UnixNano()),
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Direction: "push",
		Commit:    commitHash,
		Message:   msg,
		Files:     fileCount,
	}
	if err != nil {
		entry.Error = err.Error()
		s.setError(err.Error())
	} else {
		s.status.LastError = ""
	}
	s.addHistory(entry)
	return &entry, err
}

// Pull fetches changes from the remote and reconciles with the database.
func (s *Service) Pull() (*PullResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.status.Connected || s.repo == nil {
		return nil, fmt.Errorf("not connected to repository")
	}

	s.syncing = true
	defer func() { s.syncing = false }()

	if err := s.pullLatest(); err != nil {
		s.setError(err.Error())
		return nil, err
	}
	s.status.LastPullAt = time.Now().UTC().Format(time.RFC3339)

	// Walk the repo and reconcile all entity files.
	result, err := s.reconcileFromRepo()

	msg := fmt.Sprintf("gantry: pull — %d created, %d updated, %d deleted", result.Created, result.Updated, result.Deleted)
	if result.Errors > 0 {
		msg += fmt.Sprintf(", %d errors", result.Errors)
	}

	entry := SyncHistoryEntry{
		ID:        fmt.Sprintf("%d", time.Now().UnixNano()),
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Direction: "pull",
		Message:   msg,
		Files:     result.Created + result.Updated + result.Deleted,
	}
	if err != nil {
		entry.Error = err.Error()
		s.setError(err.Error())
	} else if result.Errors > 0 {
		entry.Error = formatPullErrors(result)
		s.setError(entry.Error)
	} else if result.Errors == 0 {
		s.status.LastError = ""
	}

	s.updateLastCommit()
	s.addHistory(entry)
	return result, err
}

// reconcileFromRepo walks the repo tree and syncs entities to the database.
func (s *Service) reconcileFromRepo() (*PullResult, error) {
	result := &PullResult{}

	w, err := s.repo.Worktree()
	if err != nil {
		return result, fmt.Errorf("getting worktree: %w", err)
	}

	ctx := context.Background()
	repoRoot := w.Filesystem.Root()

	// Walk the repo tree looking for YAML files.
	walkRoot := repoRoot
	if s.config.BasePath != "" {
		walkRoot = filepath.Join(repoRoot, s.config.BasePath)
	}

	if _, err := os.Stat(walkRoot); os.IsNotExist(err) {
		return result, nil // base path doesn't exist yet
	}

	err = filepath.Walk(walkRoot, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // skip unreadable entries
		}
		if info.IsDir() || !strings.HasSuffix(info.Name(), ".yaml") {
			return nil
		}

		// Get the relative path from repo root.
		relPath, _ := filepath.Rel(repoRoot, path)

		data, err := os.ReadFile(path)
		if err != nil {
			detail := fmt.Sprintf("%s: read failed: %v", relPath, err)
			log.Printf("[gitops-pull] %s", detail)
			result.addError(detail)
			return nil
		}

		repoEntity, err := DeserializeEntity(data)
		if err != nil {
			detail := fmt.Sprintf("%s: parse failed: %v", relPath, err)
			log.Printf("[gitops-pull] %s", detail)
			result.addError(detail)
			return nil
		}

		// Use the entity's own kind/namespace/name from the YAML for DB lookup.
		eKind := repoEntity.Kind
		eNamespace := repoEntity.Metadata.Namespace
		eName := repoEntity.Metadata.Name

		// Check current DB state.
		existing, err := s.db.GetEntity(ctx, eKind, eNamespace, eName)
		if errors.Is(err, entity.ErrEntityNotFound) {
			existing = nil
			err = nil
		}
		if err != nil {
			detail := fmt.Sprintf("%s: lookup %s/%s/%s failed: %v", relPath, eKind, eNamespace, eName, err)
			log.Printf("[gitops-pull] %s", detail)
			result.addError(detail)
			return nil
		}

		if existing == nil {
			// Create new entity.
			repoEntity.Metadata.CreatedBy = "gitops"
			if err := s.db.CreateEntity(ctx, repoEntity); err != nil {
				detail := fmt.Sprintf("%s: create %s/%s/%s failed: %v", relPath, eKind, eNamespace, eName, err)
				log.Printf("[gitops-pull] %s", detail)
				result.addError(detail)
			} else {
				result.Created++
			}
		} else {
			// Update existing entity — merge spec and metadata from repo.
			existing.Spec = repoEntity.Spec
			existing.Metadata.Title = repoEntity.Metadata.Title
			existing.Metadata.Description = repoEntity.Metadata.Description
			existing.Metadata.Owner = repoEntity.Metadata.Owner
			existing.Metadata.Tags = repoEntity.Metadata.Tags
			existing.Metadata.Annotations = repoEntity.Metadata.Annotations
			existing.Metadata.Labels = repoEntity.Metadata.Labels

			if err := s.db.UpdateEntity(ctx, existing); err != nil {
				detail := fmt.Sprintf("%s: update %s/%s/%s failed: %v", relPath, eKind, eNamespace, eName, err)
				log.Printf("[gitops-pull] %s", detail)
				result.addError(detail)
			} else {
				result.Updated++
			}
		}

		return nil
	})

	return result, err
}

func (r *PullResult) addError(detail string) {
	r.Errors++
	if len(r.ErrorDetails) < maxPullErrorDetails {
		r.ErrorDetails = append(r.ErrorDetails, detail)
	}
}

func formatPullErrors(result *PullResult) string {
	if result == nil || result.Errors == 0 {
		return ""
	}

	if len(result.ErrorDetails) == 0 {
		if result.Errors == 1 {
			return "1 file failed during pull"
		}
		return fmt.Sprintf("%d files failed during pull", result.Errors)
	}

	lines := make([]string, 0, len(result.ErrorDetails)+2)
	if result.Errors == 1 {
		lines = append(lines, "1 file failed during pull:")
	} else {
		lines = append(lines, fmt.Sprintf("%d files failed during pull:", result.Errors))
	}
	lines = append(lines, result.ErrorDetails...)

	if remaining := result.Errors - len(result.ErrorDetails); remaining > 0 {
		lines = append(lines, fmt.Sprintf("Additional errors omitted: %d", remaining))
	}

	return strings.Join(lines, "\n")
}

// ListFiles returns all entity files tracked in the repo.
func (s *Service) ListFiles() ([]FileEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.repo == nil {
		return []FileEntry{}, nil
	}

	w, err := s.repo.Worktree()
	if err != nil {
		return nil, fmt.Errorf("getting worktree: %w", err)
	}

	var files []FileEntry
	repoRoot := w.Filesystem.Root()
	walkRoot := repoRoot
	if s.config.BasePath != "" {
		walkRoot = filepath.Join(repoRoot, s.config.BasePath)
	}

	if _, err := os.Stat(walkRoot); os.IsNotExist(err) {
		return files, nil
	}

	filepath.Walk(walkRoot, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(info.Name(), ".yaml") {
			return nil
		}

		relPath, _ := filepath.Rel(repoRoot, path)
		kind, namespace, name := ParseEntityPath(s.config.BasePath, relPath)
		if kind == "" {
			return nil
		}

		entry := FileEntry{
			Path:      relPath,
			Kind:      kind,
			Namespace: namespace,
			Name:      name,
		}
		// Validate the file by attempting to parse it.
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			entry.Error = fmt.Sprintf("read failed: %v", readErr)
		} else if _, parseErr := DeserializeEntity(data); parseErr != nil {
			entry.Error = fmt.Sprintf("parse failed: %v", parseErr)
		}
		files = append(files, entry)
		return nil
	})

	return files, nil
}

// GetFileContent returns the raw YAML content of a tracked entity file.
func (s *Service) GetFileContent(relPath string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.repo == nil {
		return "", fmt.Errorf("not connected to repository")
	}

	w, err := s.repo.Worktree()
	if err != nil {
		return "", fmt.Errorf("getting worktree: %w", err)
	}

	// Sanitize the path to prevent directory traversal.
	cleaned := filepath.Clean(relPath)
	if strings.Contains(cleaned, "..") {
		return "", fmt.Errorf("invalid path")
	}

	fullPath := filepath.Join(w.Filesystem.Root(), cleaned)
	// Ensure the path stays within the repo root.
	if !strings.HasPrefix(fullPath, w.Filesystem.Root()) {
		return "", fmt.Errorf("invalid path")
	}

	if !strings.HasSuffix(fullPath, ".yaml") {
		return "", fmt.Errorf("not a yaml file")
	}

	data, err := os.ReadFile(fullPath)
	if err != nil {
		return "", fmt.Errorf("reading file: %w", err)
	}
	return string(data), nil
}

// Status returns the current sync status.
func (s *Service) Status() SyncStatus {
	s.batchMu.Lock()
	s.status.PendingFiles = len(s.batchItems)
	s.batchMu.Unlock()
	return s.status
}

// History returns recent sync operations.
func (s *Service) History() []SyncHistoryEntry {
	s.historyMu.Lock()
	defer s.historyMu.Unlock()

	result := make([]SyncHistoryEntry, len(s.history))
	copy(result, s.history)
	return result
}

func (s *Service) addHistory(entry SyncHistoryEntry) {
	s.historyMu.Lock()
	defer s.historyMu.Unlock()

	s.history = append([]SyncHistoryEntry{entry}, s.history...)
	if len(s.history) > maxHistory {
		s.history = s.history[:maxHistory]
	}
	s.persistHistory()
}

// historyFilePath returns the path to the JSON file used to persist sync history.
func (s *Service) historyFilePath() string {
	return filepath.Join(s.config.DataDir, "sync-history.json")
}

// persistHistory writes the current history slice to disk as JSON.
// Must be called with historyMu held.
func (s *Service) persistHistory() {
	data, err := json.Marshal(s.history)
	if err != nil {
		log.Printf("[gitops] failed to marshal history: %v", err)
		return
	}
	if err := os.WriteFile(s.historyFilePath(), data, 0o644); err != nil {
		log.Printf("[gitops] failed to persist history: %v", err)
	}
}

// loadHistory reads persisted sync history from disk.
func (s *Service) loadHistory() {
	data, err := os.ReadFile(s.historyFilePath())
	if err != nil {
		return // file doesn't exist yet — that's fine
	}
	var entries []SyncHistoryEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		log.Printf("[gitops] failed to parse history file: %v", err)
		return
	}
	s.history = entries
}

func (s *Service) setError(msg string) {
	s.status.LastError = msg
}

// StartPullLoop starts a background goroutine that periodically pulls from the remote.
func (s *Service) StartPullLoop(interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-s.stopCh:
				return
			case <-ticker.C:
				s.Pull()
			}
		}
	}()
}

// Stop shuts down the service, flushing any pending batch.
func (s *Service) Stop() {
	s.stopOnce.Do(func() {
		close(s.stopCh)

		s.batchMu.Lock()
		if s.batchTimer != nil {
			s.batchTimer.Stop()
		}
		s.batchMu.Unlock()

		// Flush remaining items.
		s.flushBatch()
	})
}

// Reinit re-initializes the service with new config. Used when plugin config changes.
func (s *Service) Reinit(cfg Config) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.config = cfg
	s.status = SyncStatus{
		RepoURL: cfg.RepoURL,
		Branch:  cfg.Branch,
	}

	// If URL changed, remove old clone and re-clone.
	repoPath := filepath.Join(cfg.DataDir, "repo")
	if s.repo != nil {
		// Check if remote URL changed.
		remotes, err := s.repo.Remotes()
		urlChanged := err != nil || len(remotes) == 0
		if !urlChanged {
			for _, r := range remotes {
				if r.Config().Name == "origin" {
					urls := r.Config().URLs
					if len(urls) == 0 || urls[0] != cfg.RepoURL {
						urlChanged = true
					}
					break
				}
			}
		}

		if urlChanged {
			os.RemoveAll(repoPath)
			s.repo = nil
		}
	}

	if err := s.ensureRepo(); err != nil {
		s.status.LastError = err.Error()
		return err
	}

	s.status.Connected = true
	s.updateLastCommit()
	return nil
}
