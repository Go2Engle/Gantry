package db

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/go2engle/gantry/internal/auth"
	gantrycrypto "github.com/go2engle/gantry/internal/crypto"
	"github.com/go2engle/gantry/internal/entity"
	"github.com/go2engle/gantry/internal/plugins"
)

// ---------------------------------------------------------------------------
// Local types (defined here to avoid circular imports with auth package)
// ---------------------------------------------------------------------------

// User represents a Gantry user account.
type User struct {
	ID           string    `json:"id"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"-"`
	DisplayName  string    `json:"displayName,omitempty"`
	Email        string    `json:"email,omitempty"`
	Role         string    `json:"role"`
	SSOOnly      bool      `json:"ssoOnly"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

// AuditEntry records a single auditable action in the system.
type AuditEntry struct {
	ID           string    `json:"id"`
	Timestamp    time.Time `json:"timestamp"`
	UserID       string    `json:"userId,omitempty"`
	UserName     string    `json:"userName,omitempty"`
	Action       string    `json:"action"`
	ResourceType string    `json:"resourceType,omitempty"`
	ResourceID   string    `json:"resourceId,omitempty"`
	ResourceName string    `json:"resourceName,omitempty"`
	BeforeState  string    `json:"beforeState,omitempty"`
	AfterState   string    `json:"afterState,omitempty"`
	Source       string    `json:"source,omitempty"`
	IPAddress    string    `json:"ipAddress,omitempty"`
}

// ActionRun represents a single execution of a self-service action.
type ActionRun struct {
	ID          string     `json:"id"`
	ActionName  string     `json:"actionName"`
	Status      string     `json:"status"`
	Inputs      string     `json:"inputs,omitempty"`
	Outputs     string     `json:"outputs,omitempty"`
	TriggeredBy string     `json:"triggeredBy,omitempty"`
	StartedAt   *time.Time `json:"startedAt,omitempty"`
	CompletedAt *time.Time `json:"completedAt,omitempty"`
	Error       string     `json:"error,omitempty"`
}

// APIKey represents a long-lived API authentication token.
type APIKey struct {
	ID         string     `json:"id"`
	UserID     string     `json:"userId"`
	Name       string     `json:"name"`
	Prefix     string     `json:"prefix"`
	Role       string     `json:"role"`
	CreatedAt  time.Time  `json:"createdAt"`
	LastUsedAt *time.Time `json:"lastUsedAt,omitempty"`
	ExpiresAt  *time.Time `json:"expiresAt,omitempty"`
}

// CreateAPIKey inserts a new API key record. keyHash is the SHA-256 hex of the raw key.
func (d *DB) CreateAPIKey(ctx context.Context, key *APIKey, keyHash string) error {
	key.ID = newUUID()
	key.CreatedAt = time.Now().UTC()
	_, err := d.exec(ctx,
		`INSERT INTO api_keys (id, user_id, name, key_hash, prefix, role, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		key.ID, key.UserID, key.Name, keyHash, key.Prefix, key.Role, key.CreatedAt)
	return err
}

// GetAPIKeyByHash looks up an API key by its SHA-256 hash and updates last_used_at.
func (d *DB) GetAPIKeyByHash(ctx context.Context, keyHash string) (*APIKey, error) {
	row := d.queryRow(ctx,
		`SELECT id, user_id, name, prefix, role, created_at, last_used_at, expires_at
		 FROM api_keys WHERE key_hash = ?`, keyHash)
	k := &APIKey{}
	var lastUsed, expires sql.NullTime
	if err := row.Scan(&k.ID, &k.UserID, &k.Name, &k.Prefix, &k.Role,
		&k.CreatedAt, &lastUsed, &expires); err != nil {
		if err == sql.ErrNoRows {
			return nil, entity.ErrEntityNotFound
		}
		return nil, err
	}
	if lastUsed.Valid {
		k.LastUsedAt = &lastUsed.Time
	}
	if expires.Valid {
		k.ExpiresAt = &expires.Time
	}
	// Update last_used_at in background — best effort.
	now := time.Now().UTC()
	_, _ = d.exec(ctx, `UPDATE api_keys SET last_used_at = ? WHERE id = ?`, now, k.ID)
	return k, nil
}

// ListAPIKeys returns all API keys for the given user (hashes not included).
func (d *DB) ListAPIKeys(ctx context.Context, userID string) ([]*APIKey, error) {
	rows, err := d.queryRows(ctx,
		`SELECT id, user_id, name, prefix, role, created_at, last_used_at, expires_at
		 FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []*APIKey
	for rows.Next() {
		k := &APIKey{}
		var lastUsed, expires sql.NullTime
		if err := rows.Scan(&k.ID, &k.UserID, &k.Name, &k.Prefix, &k.Role,
			&k.CreatedAt, &lastUsed, &expires); err != nil {
			return nil, err
		}
		if lastUsed.Valid {
			k.LastUsedAt = &lastUsed.Time
		}
		if expires.Valid {
			k.ExpiresAt = &expires.Time
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

// DeleteAPIKey removes an API key by ID, verifying it belongs to userID.
func (d *DB) DeleteAPIKey(ctx context.Context, id, userID string) error {
	res, err := d.exec(ctx, `DELETE FROM api_keys WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return entity.ErrEntityNotFound
	}
	return nil
}

// ---------------------------------------------------------------------------
// UUID generation
// ---------------------------------------------------------------------------

// newUUID generates a v4 UUID using crypto/rand.
func newUUID() string {
	var uuid [16]byte
	if _, err := rand.Read(uuid[:]); err != nil {
		panic(fmt.Sprintf("crypto/rand failed: %v", err))
	}
	// Set version 4 and variant bits per RFC 4122.
	uuid[6] = (uuid[6] & 0x0f) | 0x40
	uuid[8] = (uuid[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		uuid[0:4], uuid[4:6], uuid[6:8], uuid[8:10], uuid[10:16])
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

// marshalJSON marshals v to a JSON string, returning "" for nil/empty values.
func marshalJSON(v any) string {
	if v == nil {
		return ""
	}
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	s := string(b)
	// Treat null/empty representations as empty string for cleaner storage.
	if s == "null" || s == "[]" || s == "{}" {
		return ""
	}
	return s
}

// unmarshalStringSlice decodes a JSON array stored as a string into a []string.
func unmarshalStringSlice(s string) []string {
	if s == "" {
		return nil
	}
	var out []string
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		return nil
	}
	return out
}

// unmarshalStringMap decodes a JSON object stored as a string into a map[string]string.
func unmarshalStringMap(s string) map[string]string {
	if s == "" {
		return nil
	}
	var out map[string]string
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		return nil
	}
	return out
}

// unmarshalAnyMap decodes a JSON object stored as a string into a map[string]any.
func unmarshalAnyMap(s string) map[string]any {
	if s == "" {
		return nil
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		return nil
	}
	return out
}

// ---------------------------------------------------------------------------
// Entity CRUD
// ---------------------------------------------------------------------------

// CreateEntity inserts a new entity into the database.
// It generates a UUID for the entity and sets timestamps.
func (d *DB) CreateEntity(ctx context.Context, e *entity.Entity) error {
	id := newUUID()
	now := time.Now().UTC()

	if e.Metadata.CreatedAt.IsZero() {
		e.Metadata.CreatedAt = now
	}
	e.Metadata.UpdatedAt = now

	tags := marshalJSON(e.Metadata.Tags)
	annotations := marshalJSON(e.Metadata.Annotations)
	labels := marshalJSON(e.Metadata.Labels)
	spec := marshalJSON(e.Spec)

	_, err := d.exec(ctx,
		`INSERT INTO entities (id, kind, api_version, name, namespace, title, description, owner,
			tags, annotations, labels, spec, created_at, updated_at, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id,
		e.Kind,
		e.APIVersion,
		e.Metadata.Name,
		e.Metadata.Namespace,
		e.Metadata.Title,
		e.Metadata.Description,
		e.Metadata.Owner,
		tags,
		annotations,
		labels,
		spec,
		e.Metadata.CreatedAt,
		e.Metadata.UpdatedAt,
		e.Metadata.CreatedBy,
	)
	if err != nil {
		// Check for unique constraint violation.
		if isUniqueViolation(err) {
			return entity.ErrEntityAlreadyExists
		}
		return fmt.Errorf("inserting entity: %w", err)
	}
	return nil
}

// GetEntity retrieves a single entity by kind, namespace, and name.
func (d *DB) GetEntity(ctx context.Context, kind, namespace, name string) (*entity.Entity, error) {
	row := d.queryRow(ctx,
		`SELECT kind, api_version, name, namespace, title, description, owner,
			tags, annotations, labels, spec, created_at, updated_at, created_by
		 FROM entities
		 WHERE kind = ? AND namespace = ? AND name = ?`,
		kind, namespace, name,
	)
	return scanEntity(row)
}

// ListEntities returns all entities matching the given kind and namespace.
// Pass empty strings to skip filtering on that dimension.
func (d *DB) ListEntities(ctx context.Context, kind, namespace string) ([]*entity.Entity, error) {
	query := `SELECT kind, api_version, name, namespace, title, description, owner,
		tags, annotations, labels, spec, created_at, updated_at, created_by
		FROM entities WHERE 1=1`
	var args []any

	if kind != "" {
		query += " AND kind = ?"
		args = append(args, kind)
	}
	if namespace != "" {
		query += " AND namespace = ?"
		args = append(args, namespace)
	}

	query += " ORDER BY kind, namespace, name"

	rows, err := d.queryRows(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("listing entities: %w", err)
	}
	defer rows.Close()

	var entities []*entity.Entity
	for rows.Next() {
		e, err := scanEntityFromRows(rows)
		if err != nil {
			return nil, err
		}
		entities = append(entities, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating entity rows: %w", err)
	}
	return entities, nil
}

// CountEntitiesByKind returns a map of entity kind to count for all entities.
func (d *DB) CountEntitiesByKind(ctx context.Context) (map[string]int64, error) {
	rows, err := d.queryRows(ctx, `SELECT kind, COUNT(*) FROM entities GROUP BY kind`)
	if err != nil {
		return nil, fmt.Errorf("counting entities by kind: %w", err)
	}
	defer rows.Close()
	counts := make(map[string]int64)
	for rows.Next() {
		var kind string
		var count int64
		if err := rows.Scan(&kind, &count); err != nil {
			return nil, err
		}
		counts[kind] = count
	}
	return counts, rows.Err()
}

// UpdateEntity updates an existing entity identified by kind, namespace, and name.
// It updates all mutable fields and bumps the updated_at timestamp.
func (d *DB) UpdateEntity(ctx context.Context, e *entity.Entity) error {
	e.Metadata.UpdatedAt = time.Now().UTC()

	tags := marshalJSON(e.Metadata.Tags)
	annotations := marshalJSON(e.Metadata.Annotations)
	labels := marshalJSON(e.Metadata.Labels)
	spec := marshalJSON(e.Spec)

	result, err := d.exec(ctx,
		`UPDATE entities
		 SET api_version = ?, title = ?, description = ?, owner = ?,
		     tags = ?, annotations = ?, labels = ?, spec = ?,
		     updated_at = ?, created_by = ?
		 WHERE kind = ? AND namespace = ? AND name = ?`,
		e.APIVersion,
		e.Metadata.Title,
		e.Metadata.Description,
		e.Metadata.Owner,
		tags,
		annotations,
		labels,
		spec,
		e.Metadata.UpdatedAt,
		e.Metadata.CreatedBy,
		e.Kind,
		e.Metadata.Namespace,
		e.Metadata.Name,
	)
	if err != nil {
		return fmt.Errorf("updating entity: %w", err)
	}

	n, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("checking rows affected: %w", err)
	}
	if n == 0 {
		return entity.ErrEntityNotFound
	}
	return nil
}

// DeleteEntity removes an entity by kind, namespace, and name.
func (d *DB) DeleteEntity(ctx context.Context, kind, namespace, name string) error {
	result, err := d.exec(ctx,
		`DELETE FROM entities WHERE kind = ? AND namespace = ? AND name = ?`,
		kind, namespace, name,
	)
	if err != nil {
		return fmt.Errorf("deleting entity: %w", err)
	}

	n, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("checking rows affected: %w", err)
	}
	if n == 0 {
		return entity.ErrEntityNotFound
	}
	return nil
}

// SearchEntities performs a full-text search across entity fields.
// On SQLite it uses FTS5; on PostgreSQL it falls back to LIKE matching.
func (d *DB) SearchEntities(ctx context.Context, query string) ([]*entity.Entity, error) {
	if query == "" {
		return nil, nil
	}

	var sqlQuery string
	var args []any

	if d.IsSQLite() {
		// Use FTS5 for SQLite. The MATCH query supports prefix matching with *.
		sqlQuery = `SELECT e.kind, e.api_version, e.name, e.namespace, e.title, e.description, e.owner,
				e.tags, e.annotations, e.labels, e.spec, e.created_at, e.updated_at, e.created_by
			FROM entities e
			JOIN entities_fts fts ON e.rowid = fts.rowid
			WHERE entities_fts MATCH ?
			ORDER BY rank`
		// Append * for prefix matching so partial words match.
		args = append(args, query+"*")
	} else {
		// Fallback LIKE search for PostgreSQL (tsvector search can be added later).
		likePattern := "%" + query + "%"
		sqlQuery = `SELECT kind, api_version, name, namespace, title, description, owner,
				tags, annotations, labels, spec, created_at, updated_at, created_by
			FROM entities
			WHERE name ILIKE ? OR title ILIKE ? OR description ILIKE ? OR tags ILIKE ? OR kind ILIKE ? OR owner ILIKE ?
			ORDER BY name`
		args = append(args, likePattern, likePattern, likePattern, likePattern, likePattern, likePattern)
	}

	rows, err := d.queryRows(ctx, sqlQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("searching entities: %w", err)
	}
	defer rows.Close()

	var entities []*entity.Entity
	for rows.Next() {
		e, err := scanEntityFromRows(rows)
		if err != nil {
			return nil, err
		}
		entities = append(entities, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating search results: %w", err)
	}
	return entities, nil
}

// ---------------------------------------------------------------------------
// Graph queries
// ---------------------------------------------------------------------------

// GraphNode represents a single entity node in a relationship graph.
type GraphNode struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Namespace string `json:"namespace,omitempty"`
	Name      string `json:"name"`
	Title     string `json:"title,omitempty"`
	IsRoot    bool   `json:"isRoot"`
}

// GraphEdge represents a directed relationship between two graph nodes.
type GraphEdge struct {
	From     string `json:"from"`
	To       string `json:"to"`
	Relation string `json:"relation"` // "dependsOn", "providesApi", "consumesApi", "ownedBy"
}

// GraphData is the complete relationship graph for a given root entity.
type GraphData struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
}

// GetEntityGraph builds a relationship graph centered on the given entity.
// It includes direct forward relationships from the entity's spec and reverse
// dependencies found by scanning all entities.
func (d *DB) GetEntityGraph(ctx context.Context, kind, namespace, name string) (*GraphData, error) {
	root, err := d.GetEntity(ctx, kind, namespace, name)
	if err != nil {
		return nil, err
	}

	rootID := kind + "/" + name
	nodes := map[string]GraphNode{
		rootID: {ID: rootID, Kind: root.Kind, Namespace: root.Metadata.Namespace, Name: root.Metadata.Name, Title: root.Metadata.Title, IsRoot: true},
	}
	var edges []GraphEdge

	// addNode fetches an entity and adds it to the nodes map (as a stub if not found).
	addNode := func(nodeKind, nodeName string) {
		id := nodeKind + "/" + nodeName
		if _, exists := nodes[id]; exists {
			return
		}
		e, err := d.GetEntity(ctx, nodeKind, namespace, nodeName)
		if err != nil {
			nodes[id] = GraphNode{ID: id, Kind: nodeKind, Namespace: namespace, Name: nodeName}
			return
		}
		nodes[id] = GraphNode{ID: id, Kind: e.Kind, Namespace: e.Metadata.Namespace, Name: e.Metadata.Name, Title: e.Metadata.Title}
	}

	spec := root.Spec
	if spec == nil {
		spec = map[string]any{}
	}

	// Forward: dependsOn — [{kind, name}, ...]
	if raw, ok := spec["dependsOn"]; ok {
		if deps, ok := raw.([]any); ok {
			for _, d := range deps {
				if m, ok := d.(map[string]any); ok {
					depKind, _ := m["kind"].(string)
					depName, _ := m["name"].(string)
					if depKind != "" && depName != "" {
						addNode(depKind, depName)
						edges = append(edges, GraphEdge{From: rootID, To: depKind + "/" + depName, Relation: "dependsOn"})
					}
				}
			}
		}
	}

	// Forward: deployedIn — [{kind, name}, ...]
	if raw, ok := spec["deployedIn"]; ok {
		if envs, ok := raw.([]any); ok {
			for _, env := range envs {
				if m, ok := env.(map[string]any); ok {
					envKind, _ := m["kind"].(string)
					envName, _ := m["name"].(string)
					if envKind != "" && envName != "" {
						addNode(envKind, envName)
						edges = append(edges, GraphEdge{From: rootID, To: envKind + "/" + envName, Relation: "deployedIn"})
					}
				}
			}
		}
	}

	// Forward: providesApis — [apiName, ...]
	if raw, ok := spec["providesApis"]; ok {
		if apis, ok := raw.([]any); ok {
			for _, a := range apis {
				apiName, _ := a.(string)
				if apiName != "" {
					addNode("API", apiName)
					edges = append(edges, GraphEdge{From: rootID, To: "API/" + apiName, Relation: "providesApi"})
				}
			}
		}
	}

	// Forward: consumesApis — [apiName, ...]
	if raw, ok := spec["consumesApis"]; ok {
		if apis, ok := raw.([]any); ok {
			for _, a := range apis {
				apiName, _ := a.(string)
				if apiName != "" {
					addNode("API", apiName)
					edges = append(edges, GraphEdge{From: rootID, To: "API/" + apiName, Relation: "consumesApi"})
				}
			}
		}
	}

	// Forward: owner (metadata) → Team
	if root.Metadata.Owner != "" {
		addNode("Team", root.Metadata.Owner)
		edges = append(edges, GraphEdge{From: rootID, To: "Team/" + root.Metadata.Owner, Relation: "ownedBy"})
	}

	// Reverse: scan all entities to find those that reference root in their dependsOn.
	all, err := d.ListEntities(ctx, "", "")
	if err != nil {
		return nil, fmt.Errorf("listing entities for graph: %w", err)
	}
	for _, e := range all {
		eID := e.Kind + "/" + e.Metadata.Name
		if eID == rootID || e.Spec == nil {
			continue
		}
		if raw, ok := e.Spec["dependsOn"]; ok {
			if deps, ok := raw.([]any); ok {
				for _, d := range deps {
					if m, ok := d.(map[string]any); ok {
						depKind, _ := m["kind"].(string)
						depName, _ := m["name"].(string)
						if depKind == kind && depName == name {
							if _, exists := nodes[eID]; !exists {
								nodes[eID] = GraphNode{ID: eID, Kind: e.Kind, Namespace: e.Metadata.Namespace, Name: e.Metadata.Name, Title: e.Metadata.Title}
							}
							edges = append(edges, GraphEdge{From: eID, To: rootID, Relation: "dependsOn"})
						}
					}
				}
			}
		}
		if raw, ok := e.Spec["deployedIn"]; ok {
			if envs, ok := raw.([]any); ok {
				for _, env := range envs {
					if m, ok := env.(map[string]any); ok {
						envKind, _ := m["kind"].(string)
						envName, _ := m["name"].(string)
						if envKind == kind && envName == name {
							if _, exists := nodes[eID]; !exists {
								nodes[eID] = GraphNode{ID: eID, Kind: e.Kind, Namespace: e.Metadata.Namespace, Name: e.Metadata.Name, Title: e.Metadata.Title}
							}
							edges = append(edges, GraphEdge{From: eID, To: rootID, Relation: "deployedIn"})
						}
					}
				}
			}
		}
	}

	nodeSlice := make([]GraphNode, 0, len(nodes))
	for _, n := range nodes {
		nodeSlice = append(nodeSlice, n)
	}
	if edges == nil {
		edges = []GraphEdge{}
	}
	return &GraphData{Nodes: nodeSlice, Edges: edges}, nil
}

// ---------------------------------------------------------------------------
// User queries
// ---------------------------------------------------------------------------

// GetUserByUsername retrieves a user by their unique username.
func (d *DB) GetUserByUsername(ctx context.Context, username string) (*User, error) {
	row := d.queryRow(ctx,
		`SELECT id, username, password_hash, display_name, email, role, sso_only, created_at, updated_at
		 FROM users WHERE username = ?`,
		username,
	)

	u := &User{}
	var displayName, email sql.NullString
	var createdAt, updatedAt sql.NullTime
	var ssoOnly int
	err := row.Scan(
		&u.ID, &u.Username, &u.PasswordHash,
		&displayName, &email, &u.Role, &ssoOnly,
		&createdAt, &updatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("user %q: %w", username, entity.ErrEntityNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("querying user: %w", err)
	}

	u.DisplayName = displayName.String
	u.Email = email.String
	u.SSOOnly = ssoOnly != 0
	if createdAt.Valid {
		u.CreatedAt = createdAt.Time
	}
	if updatedAt.Valid {
		u.UpdatedAt = updatedAt.Time
	}
	return u, nil
}

// ListUsers returns all users ordered by creation date (password hash excluded).
func (d *DB) ListUsers(ctx context.Context) ([]*User, error) {
	rows, err := d.queryRows(ctx,
		`SELECT id, username, display_name, email, role, sso_only, created_at, updated_at
		 FROM users ORDER BY created_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("listing users: %w", err)
	}
	defer rows.Close()

	var users []*User
	for rows.Next() {
		u := &User{}
		var displayName, email sql.NullString
		var createdAt, updatedAt sql.NullTime
		var ssoOnly int
		if err := rows.Scan(&u.ID, &u.Username, &displayName, &email, &u.Role, &ssoOnly, &createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("scanning user: %w", err)
		}
		u.DisplayName = displayName.String
		u.Email = email.String
		u.SSOOnly = ssoOnly != 0
		if createdAt.Valid {
			u.CreatedAt = createdAt.Time
		}
		if updatedAt.Valid {
			u.UpdatedAt = updatedAt.Time
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

// GetUserByID retrieves a user by their ID.
func (d *DB) GetUserByID(ctx context.Context, id string) (*User, error) {
	row := d.queryRow(ctx,
		`SELECT id, username, password_hash, display_name, email, role, sso_only, created_at, updated_at
		 FROM users WHERE id = ?`, id)
	u := &User{}
	var displayName, email sql.NullString
	var createdAt, updatedAt sql.NullTime
	var ssoOnly int
	err := row.Scan(&u.ID, &u.Username, &u.PasswordHash, &displayName, &email, &u.Role, &ssoOnly, &createdAt, &updatedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("user %q: %w", id, entity.ErrEntityNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("querying user: %w", err)
	}
	u.DisplayName = displayName.String
	u.Email = email.String
	u.SSOOnly = ssoOnly != 0
	if createdAt.Valid {
		u.CreatedAt = createdAt.Time
	}
	if updatedAt.Valid {
		u.UpdatedAt = updatedAt.Time
	}
	return u, nil
}

// UpdateUser updates the mutable profile fields of a user (displayName, email, role, sso_only).
func (d *DB) UpdateUser(ctx context.Context, u *User) error {
	u.UpdatedAt = time.Now().UTC()
	_, err := d.exec(ctx,
		`UPDATE users SET display_name = ?, email = ?, role = ?, sso_only = ?, updated_at = ? WHERE id = ?`,
		u.DisplayName, u.Email, u.Role, boolToInt(u.SSOOnly), u.UpdatedAt, u.ID)
	return err
}

// UpdateUserPassword sets a new bcrypt password hash for the given user.
func (d *DB) UpdateUserPassword(ctx context.Context, userID, passwordHash string) error {
	now := time.Now().UTC()
	_, err := d.exec(ctx,
		`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`,
		passwordHash, now, userID)
	return err
}

// InitializeBootstrapAdminPassword applies the configured bootstrap password
// once, but only while the admin account still has the default seeded hash.
func (d *DB) InitializeBootstrapAdminPassword(ctx context.Context, authSvc *auth.Service, password string) error {
	if password == "" || password == DefaultAdminPassword {
		return nil
	}

	user, err := d.GetUserByID(ctx, BootstrapAdminUserID)
	if err != nil {
		return err
	}
	if user.PasswordHash != DefaultAdminPasswordHash {
		return nil
	}

	hash, err := authSvc.HashPassword(password)
	if err != nil {
		return fmt.Errorf("hashing bootstrap admin password: %w", err)
	}
	return d.UpdateUserPassword(ctx, user.ID, hash)
}

// GetUserByEmail retrieves a user by their email address.
func (d *DB) GetUserByEmail(ctx context.Context, email string) (*User, error) {
	row := d.queryRow(ctx,
		`SELECT id, username, password_hash, display_name, email, role, sso_only, created_at, updated_at
		 FROM users WHERE email = ? LIMIT 1`, email)
	u := &User{}
	var displayName, emailVal sql.NullString
	var createdAt, updatedAt sql.NullTime
	var ssoOnly int
	err := row.Scan(&u.ID, &u.Username, &u.PasswordHash, &displayName, &emailVal, &u.Role, &ssoOnly, &createdAt, &updatedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("user with email %q: %w", email, entity.ErrEntityNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("querying user by email: %w", err)
	}
	u.DisplayName = displayName.String
	u.Email = emailVal.String
	u.SSOOnly = ssoOnly != 0
	if createdAt.Valid {
		u.CreatedAt = createdAt.Time
	}
	if updatedAt.Valid {
		u.UpdatedAt = updatedAt.Time
	}
	return u, nil
}

// DeleteUser removes a user by ID.
func (d *DB) DeleteUser(ctx context.Context, id string) error {
	_, err := d.exec(ctx, `DELETE FROM users WHERE id = ?`, id)
	return err
}

// CreateUser inserts a new user. The caller must set PasswordHash before calling.
func (d *DB) CreateUser(ctx context.Context, u *User) error {
	if u.ID == "" {
		u.ID = newUUID()
	}
	now := time.Now().UTC()
	if u.CreatedAt.IsZero() {
		u.CreatedAt = now
	}
	u.UpdatedAt = now

	if u.Role == "" {
		u.Role = "viewer"
	}

	_, err := d.exec(ctx,
		`INSERT INTO users (id, username, password_hash, display_name, email, role, sso_only, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		u.ID, u.Username, u.PasswordHash,
		u.DisplayName, u.Email, u.Role, boolToInt(u.SSOOnly),
		u.CreatedAt, u.UpdatedAt,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("username %q already exists", u.Username)
		}
		return fmt.Errorf("inserting user: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Audit log queries
// ---------------------------------------------------------------------------

// CreateAuditEntry records an audit event.
func (d *DB) CreateAuditEntry(ctx context.Context, entry *AuditEntry) error {
	if entry.ID == "" {
		entry.ID = newUUID()
	}
	if entry.Timestamp.IsZero() {
		entry.Timestamp = time.Now().UTC()
	}

	_, err := d.exec(ctx,
		`INSERT INTO audit_log (id, timestamp, user_id, user_name, action,
			resource_type, resource_id, resource_name, before_state, after_state,
			source, ip_address)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		entry.ID, entry.Timestamp, entry.UserID, entry.UserName, entry.Action,
		entry.ResourceType, entry.ResourceID, entry.ResourceName,
		entry.BeforeState, entry.AfterState,
		entry.Source, entry.IPAddress,
	)
	if err != nil {
		return fmt.Errorf("inserting audit entry: %w", err)
	}
	return nil
}

// ListAuditEntries returns audit log entries ordered by most recent first.
func (d *DB) ListAuditEntries(ctx context.Context, limit, offset int) ([]*AuditEntry, error) {
	if limit <= 0 {
		limit = 50
	}

	rows, err := d.queryRows(ctx,
		`SELECT id, timestamp, user_id, user_name, action,
			resource_type, resource_id, resource_name, before_state, after_state,
			source, ip_address
		 FROM audit_log
		 ORDER BY timestamp DESC
		 LIMIT ? OFFSET ?`,
		limit, offset,
	)
	if err != nil {
		return nil, fmt.Errorf("listing audit entries: %w", err)
	}
	defer rows.Close()

	var entries []*AuditEntry
	for rows.Next() {
		e := &AuditEntry{}
		var userID, userName, resourceType, resourceID, resourceName sql.NullString
		var beforeState, afterState, source, ipAddress sql.NullString
		err := rows.Scan(
			&e.ID, &e.Timestamp,
			&userID, &userName, &e.Action,
			&resourceType, &resourceID, &resourceName,
			&beforeState, &afterState,
			&source, &ipAddress,
		)
		if err != nil {
			return nil, fmt.Errorf("scanning audit entry: %w", err)
		}
		e.UserID = userID.String
		e.UserName = userName.String
		e.ResourceType = resourceType.String
		e.ResourceID = resourceID.String
		e.ResourceName = resourceName.String
		e.BeforeState = beforeState.String
		e.AfterState = afterState.String
		e.Source = source.String
		e.IPAddress = ipAddress.String
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating audit entries: %w", err)
	}
	return entries, nil
}

// ---------------------------------------------------------------------------
// Action run queries
// ---------------------------------------------------------------------------

// CreateActionRun inserts a new action run record.
func (d *DB) CreateActionRun(ctx context.Context, run *ActionRun) error {
	if run.ID == "" {
		run.ID = newUUID()
	}
	if run.Status == "" {
		run.Status = "pending"
	}

	_, err := d.exec(ctx,
		`INSERT INTO action_runs (id, action_name, status, inputs, outputs,
			triggered_by, started_at, completed_at, error)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		run.ID, run.ActionName, run.Status,
		run.Inputs, run.Outputs, run.TriggeredBy,
		run.StartedAt, run.CompletedAt, run.Error,
	)
	if err != nil {
		return fmt.Errorf("inserting action run: %w", err)
	}
	return nil
}

// GetActionRun retrieves a single action run by ID.
func (d *DB) GetActionRun(ctx context.Context, id string) (*ActionRun, error) {
	row := d.queryRow(ctx,
		`SELECT id, action_name, status, inputs, outputs,
			triggered_by, started_at, completed_at, error
		 FROM action_runs WHERE id = ?`,
		id,
	)

	run, err := scanActionRun(row)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("action run %q: %w", id, entity.ErrEntityNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("querying action run: %w", err)
	}
	return run, nil
}

// UpdateActionRun updates a mutable action run record (status, outputs, timestamps, error).
func (d *DB) UpdateActionRun(ctx context.Context, run *ActionRun) error {
	result, err := d.exec(ctx,
		`UPDATE action_runs
		 SET status = ?, inputs = ?, outputs = ?,
		     triggered_by = ?, started_at = ?, completed_at = ?, error = ?
		 WHERE id = ?`,
		run.Status, run.Inputs, run.Outputs,
		run.TriggeredBy, run.StartedAt, run.CompletedAt, run.Error,
		run.ID,
	)
	if err != nil {
		return fmt.Errorf("updating action run: %w", err)
	}

	n, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("checking rows affected: %w", err)
	}
	if n == 0 {
		return fmt.Errorf("action run %q: %w", run.ID, entity.ErrEntityNotFound)
	}
	return nil
}

// ListActionRuns returns action runs for a given action name, ordered by most recent first.
// If actionName is empty, all runs are returned.
func (d *DB) ListActionRuns(ctx context.Context, actionName string) ([]*ActionRun, error) {
	var query string
	var args []any

	if actionName != "" {
		query = `SELECT id, action_name, status, inputs, outputs,
				triggered_by, started_at, completed_at, error
			 FROM action_runs WHERE action_name = ?
			 ORDER BY started_at DESC NULLS LAST`
		args = append(args, actionName)
	} else {
		query = `SELECT id, action_name, status, inputs, outputs,
				triggered_by, started_at, completed_at, error
			 FROM action_runs
			 ORDER BY started_at DESC NULLS LAST`
	}

	rows, err := d.queryRows(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("listing action runs: %w", err)
	}
	defer rows.Close()

	var runs []*ActionRun
	for rows.Next() {
		run, err := scanActionRunFromRows(rows)
		if err != nil {
			return nil, err
		}
		runs = append(runs, run)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating action runs: %w", err)
	}
	return runs, nil
}

// ---------------------------------------------------------------------------
// Row scanning helpers
// ---------------------------------------------------------------------------

// scanner is satisfied by both *sql.Row and *sql.Rows.
type scanner interface {
	Scan(dest ...any) error
}

// scanEntityFields scans entity columns into an Entity struct from any scanner.
func scanEntityFields(s scanner) (*entity.Entity, error) {
	e := &entity.Entity{}
	var title, description, owner, createdBy sql.NullString
	var tags, annotations, labels, spec sql.NullString
	var createdAt, updatedAt sql.NullTime

	err := s.Scan(
		&e.Kind, &e.APIVersion,
		&e.Metadata.Name, &e.Metadata.Namespace,
		&title, &description, &owner,
		&tags, &annotations, &labels, &spec,
		&createdAt, &updatedAt, &createdBy,
	)
	if err != nil {
		return nil, err
	}

	e.Metadata.Title = title.String
	e.Metadata.Description = description.String
	e.Metadata.Owner = owner.String
	e.Metadata.CreatedBy = createdBy.String
	e.Metadata.Tags = unmarshalStringSlice(tags.String)
	e.Metadata.Annotations = unmarshalStringMap(annotations.String)
	e.Metadata.Labels = unmarshalStringMap(labels.String)
	e.Spec = unmarshalAnyMap(spec.String)
	if createdAt.Valid {
		e.Metadata.CreatedAt = createdAt.Time
	}
	if updatedAt.Valid {
		e.Metadata.UpdatedAt = updatedAt.Time
	}
	return e, nil
}

// scanEntity scans a single entity row from a *sql.Row.
func scanEntity(row *sql.Row) (*entity.Entity, error) {
	e, err := scanEntityFields(row)
	if err == sql.ErrNoRows {
		return nil, entity.ErrEntityNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scanning entity: %w", err)
	}
	return e, nil
}

// scanEntityFromRows scans a single entity row from a *sql.Rows iterator.
func scanEntityFromRows(rows *sql.Rows) (*entity.Entity, error) {
	e, err := scanEntityFields(rows)
	if err != nil {
		return nil, fmt.Errorf("scanning entity row: %w", err)
	}
	return e, nil
}

// scanActionRunFields scans action_run columns from any scanner.
func scanActionRunFields(s scanner) (*ActionRun, error) {
	run := &ActionRun{}
	var inputs, outputs, triggeredBy, errMsg sql.NullString
	var startedAt, completedAt sql.NullTime

	err := s.Scan(
		&run.ID, &run.ActionName, &run.Status,
		&inputs, &outputs, &triggeredBy,
		&startedAt, &completedAt, &errMsg,
	)
	if err != nil {
		return nil, err
	}

	run.Inputs = inputs.String
	run.Outputs = outputs.String
	run.TriggeredBy = triggeredBy.String
	run.Error = errMsg.String
	if startedAt.Valid {
		run.StartedAt = &startedAt.Time
	}
	if completedAt.Valid {
		run.CompletedAt = &completedAt.Time
	}
	return run, nil
}

// scanActionRun scans a single action run from a *sql.Row.
func scanActionRun(row *sql.Row) (*ActionRun, error) {
	run, err := scanActionRunFields(row)
	if err == sql.ErrNoRows {
		return nil, sql.ErrNoRows
	}
	if err != nil {
		return nil, fmt.Errorf("scanning action run: %w", err)
	}
	return run, nil
}

// scanActionRunFromRows scans a single action run from a *sql.Rows iterator.
func scanActionRunFromRows(rows *sql.Rows) (*ActionRun, error) {
	run, err := scanActionRunFields(rows)
	if err != nil {
		return nil, fmt.Errorf("scanning action run row: %w", err)
	}
	return run, nil
}

// ---------------------------------------------------------------------------
// Error detection helpers
// ---------------------------------------------------------------------------

// isUniqueViolation checks if an error is a unique constraint violation.
// It handles both SQLite and PostgreSQL error messages.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	// SQLite: "UNIQUE constraint failed: ..."
	// PostgreSQL: "duplicate key value violates unique constraint ..."
	return contains(msg, "UNIQUE constraint failed") ||
		contains(msg, "duplicate key value violates unique constraint")
}

// contains is a simple substring check (avoids importing strings for one call).
func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchString(s, substr)
}

func searchString(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Plugin queries
// ---------------------------------------------------------------------------

// ListPlugins returns all installed plugins.
func (d *DB) ListPlugins(ctx context.Context) ([]plugins.Plugin, error) {
	rows, err := d.queryRows(ctx, `
		SELECT id, name, version, enabled, config, manifest, installed_at, updated_at
		FROM plugins ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []plugins.Plugin
	for rows.Next() {
		p, err := d.scanPlugin(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, p)
	}
	return result, rows.Err()
}

// GetPlugin returns a single plugin by name.
func (d *DB) GetPlugin(ctx context.Context, name string) (*plugins.Plugin, error) {
	row := d.queryRow(ctx, `
		SELECT id, name, version, enabled, config, manifest, installed_at, updated_at
		FROM plugins WHERE name = ?`, name)
	p, err := d.scanPlugin(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// UpsertPlugin inserts or updates a plugin record, encrypting the config at rest.
func (d *DB) UpsertPlugin(ctx context.Context, p *plugins.Plugin) error {
	configJSON, err := json.Marshal(p.Config)
	if err != nil {
		return err
	}
	encryptedConfig, err := gantrycrypto.Encrypt(d.encKey, configJSON)
	if err != nil {
		return fmt.Errorf("encrypting plugin config: %w", err)
	}
	manifestJSON, err := json.Marshal(p.Manifest)
	if err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	if p.InstalledAt == "" {
		p.InstalledAt = now
	}
	p.UpdatedAt = now

	_, err = d.exec(ctx, `
		INSERT INTO plugins (id, name, version, enabled, config, manifest, installed_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(name) DO UPDATE SET
			version      = excluded.version,
			enabled      = excluded.enabled,
			config       = excluded.config,
			manifest     = excluded.manifest,
			updated_at   = excluded.updated_at`,
		p.ID, p.Name, p.Version,
		boolToInt(p.Enabled),
		encryptedConfig,
		string(manifestJSON),
		p.InstalledAt, p.UpdatedAt,
	)
	return err
}

// DeletePlugin removes a plugin by name.
func (d *DB) DeletePlugin(ctx context.Context, name string) error {
	_, err := d.exec(ctx, `DELETE FROM plugins WHERE name = ?`, name)
	return err
}

// EnsureBundledPlugins creates DB records for any bundled registry entries that
// don't yet exist. For plugins that already exist, it updates the version and
// manifest but preserves the user's enabled state and config.
func (d *DB) EnsureBundledPlugins(ctx context.Context, entries []plugins.RegistryEntry) error {
	now := time.Now().UTC().Format(time.RFC3339)
	for _, entry := range entries {
		manifest := &plugins.Manifest{
			Name:         entry.Name,
			Title:        entry.Title,
			Description:  entry.Description,
			Version:      entry.Version,
			Author:       entry.Author,
			Category:     entry.Category,
			Homepage:     entry.Homepage,
			ConfigSchema: entry.ConfigSchema,
			EntityPanels: entry.EntityPanels,
			ActionTypes:  entry.ActionTypes,
		}
		manifestJSON, err := json.Marshal(manifest)
		if err != nil {
			return fmt.Errorf("marshal manifest for %s: %w", entry.Name, err)
		}

		// Generate a short random ID for new records.
		idBytes := make([]byte, 8)
		if _, err := rand.Read(idBytes); err != nil {
			return fmt.Errorf("generate id for %s: %w", entry.Name, err)
		}
		id := fmt.Sprintf("%x", idBytes)

		// Encrypt an empty config for new records.
		emptyConfig, err := json.Marshal(map[string]any{})
		if err != nil {
			return err
		}
		encryptedConfig, err := gantrycrypto.Encrypt(d.encKey, emptyConfig)
		if err != nil {
			return fmt.Errorf("encrypting empty config for %s: %w", entry.Name, err)
		}

		// INSERT if not exists; on conflict update only version and manifest.
		_, err = d.exec(ctx, `
			INSERT INTO plugins (id, name, version, enabled, config, manifest, installed_at, updated_at)
			VALUES (?, ?, ?, 0, ?, ?, ?, ?)
			ON CONFLICT(name) DO UPDATE SET
				version    = excluded.version,
				manifest   = excluded.manifest,
				updated_at = excluded.updated_at`,
			id, entry.Name, entry.Version,
			encryptedConfig,
			string(manifestJSON),
			now, now,
		)
		if err != nil {
			return fmt.Errorf("ensure plugin %s: %w", entry.Name, err)
		}
	}
	return nil
}

// UpdatePluginEnabled sets the enabled flag for a plugin.
func (d *DB) UpdatePluginEnabled(ctx context.Context, name string, enabled bool) error {
	_, err := d.exec(ctx,
		`UPDATE plugins SET enabled = ?, updated_at = ? WHERE name = ?`,
		boolToInt(enabled), time.Now().UTC().Format(time.RFC3339), name)
	return err
}

// UpdatePluginConfig saves the config JSON for a plugin, encrypted at rest.
func (d *DB) UpdatePluginConfig(ctx context.Context, name string, config map[string]any) error {
	configJSON, err := json.Marshal(config)
	if err != nil {
		return err
	}
	encrypted, err := gantrycrypto.Encrypt(d.encKey, configJSON)
	if err != nil {
		return fmt.Errorf("encrypting plugin config: %w", err)
	}
	_, err = d.exec(ctx,
		`UPDATE plugins SET config = ?, updated_at = ? WHERE name = ?`,
		encrypted, time.Now().UTC().Format(time.RFC3339), name)
	return err
}

type pluginScanner interface {
	Scan(dest ...any) error
}

func (d *DB) scanPlugin(s pluginScanner) (plugins.Plugin, error) {
	var p plugins.Plugin
	var enabledInt int
	var configStr, manifestStr sql.NullString

	err := s.Scan(&p.ID, &p.Name, &p.Version, &enabledInt,
		&configStr, &manifestStr, &p.InstalledAt, &p.UpdatedAt)
	if err != nil {
		return p, err
	}
	p.Enabled = enabledInt != 0

	if configStr.Valid && configStr.String != "" && configStr.String != "null" {
		plaintext, err := gantrycrypto.Decrypt(d.encKey, configStr.String)
		if err != nil {
			return p, fmt.Errorf("decrypting plugin config: %w", err)
		}
		_ = json.Unmarshal(plaintext, &p.Config)
	}
	if manifestStr.Valid && manifestStr.String != "" {
		var m plugins.Manifest
		if err := json.Unmarshal([]byte(manifestStr.String), &m); err == nil {
			p.Manifest = &m
		}
	}
	return p, nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// ---------------------------------------------------------------------------
// Dashboard config queries
// ---------------------------------------------------------------------------

// DashboardAnnouncement is an admin-authored banner shown to all users.
type DashboardAnnouncement struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Body     string `json:"body"`
	Severity string `json:"severity"` // "info" | "warning" | "danger"
}

// DashboardQuickLink is an admin-pinned link shown on the dashboard.
type DashboardQuickLink struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	URL   string `json:"url"`
	Icon  string `json:"icon"`
}

// DashboardPinnedEntity is a catalog entity the admin has highlighted.
type DashboardPinnedEntity struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	Name string `json:"name"`
}

// DashboardWidgetConfig controls the visibility, order, and width of one standard widget.
type DashboardWidgetConfig struct {
	ID      string `json:"id"`
	Visible bool   `json:"visible"`
	Order   int    `json:"order"`
	Width   string `json:"width"` // "full" | "half"; empty treated as "full"
}

// DashboardConfig is the complete admin-controlled dashboard configuration.
// It is stored as a single JSON blob in the dashboard_config table.
type DashboardConfig struct {
	Announcements  []DashboardAnnouncement `json:"announcements"`
	QuickLinks     []DashboardQuickLink    `json:"quickLinks"`
	PinnedEntities []DashboardPinnedEntity `json:"pinnedEntities"`
	Widgets        []DashboardWidgetConfig `json:"widgets"`
	UpdatedAt      string                  `json:"updatedAt,omitempty"`
	UpdatedBy      string                  `json:"updatedBy,omitempty"`
}

// defaultDashboardConfig returns the out-of-box config with all standard widgets visible.
func defaultDashboardConfig() *DashboardConfig {
	return &DashboardConfig{
		Announcements:  []DashboardAnnouncement{},
		QuickLinks:     []DashboardQuickLink{},
		PinnedEntities: []DashboardPinnedEntity{},
		Widgets: []DashboardWidgetConfig{
			{ID: "entity_stats", Visible: true, Order: 0, Width: "full"},
			{ID: "quick_links", Visible: true, Order: 1, Width: "full"},
			{ID: "pinned_entities", Visible: true, Order: 2, Width: "full"},
			{ID: "recent_activity", Visible: true, Order: 3, Width: "half"},
			{ID: "action_runs", Visible: true, Order: 4, Width: "half"},
			{ID: "my_entities", Visible: true, Order: 5, Width: "half"},
			{ID: "recently_updated", Visible: true, Order: 6, Width: "half"},
			{ID: "recently_browsed", Visible: true, Order: 7, Width: "half"},
		},
	}
}

// GetDashboardConfig returns the global dashboard configuration.
// If no row exists or the stored config has no widgets, the default is returned.
func (d *DB) GetDashboardConfig(ctx context.Context) (*DashboardConfig, error) {
	row := d.queryRow(ctx, `SELECT config, updated_at, updated_by FROM dashboard_config WHERE id = 1`)
	var raw string
	var updatedAt sql.NullTime
	var updatedBy sql.NullString
	if err := row.Scan(&raw, &updatedAt, &updatedBy); err != nil {
		if err == sql.ErrNoRows {
			return defaultDashboardConfig(), nil
		}
		return nil, fmt.Errorf("getting dashboard config: %w", err)
	}

	cfg := &DashboardConfig{}
	if raw == "" || raw == "{}" {
		cfg = defaultDashboardConfig()
	} else {
		if err := json.Unmarshal([]byte(raw), cfg); err != nil {
			return nil, fmt.Errorf("parsing dashboard config: %w", err)
		}
		// Backfill defaults if widgets are missing (e.g. first save after migration).
		if len(cfg.Widgets) == 0 {
			cfg.Widgets = defaultDashboardConfig().Widgets
		} else {
			// Backfill any new widget IDs not yet present in stored config.
			existing := map[string]bool{}
			maxOrder := 0
			for _, w := range cfg.Widgets {
				existing[w.ID] = true
				if w.Order > maxOrder {
					maxOrder = w.Order
				}
			}
			for _, def := range defaultDashboardConfig().Widgets {
				if !existing[def.ID] {
					maxOrder++
					cfg.Widgets = append(cfg.Widgets, DashboardWidgetConfig{
						ID: def.ID, Visible: def.Visible, Order: maxOrder, Width: def.Width,
					})
				}
			}
		}
		if cfg.Announcements == nil {
			cfg.Announcements = []DashboardAnnouncement{}
		}
		if cfg.QuickLinks == nil {
			cfg.QuickLinks = []DashboardQuickLink{}
		}
		if cfg.PinnedEntities == nil {
			cfg.PinnedEntities = []DashboardPinnedEntity{}
		}
	}

	if updatedAt.Valid {
		cfg.UpdatedAt = updatedAt.Time.UTC().Format(time.RFC3339)
	}
	cfg.UpdatedBy = updatedBy.String
	return cfg, nil
}

// SetDashboardConfig saves the global dashboard configuration.
func (d *DB) SetDashboardConfig(ctx context.Context, cfg *DashboardConfig, updatedBy string) error {
	// Strip metadata fields before storing — they are set server-side.
	cfg.UpdatedAt = ""
	cfg.UpdatedBy = ""

	raw, err := json.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("marshaling dashboard config: %w", err)
	}
	now := time.Now().UTC()
	_, err = d.exec(ctx, `
		INSERT INTO dashboard_config (id, config, updated_at, updated_by)
		VALUES (1, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			config     = excluded.config,
			updated_at = excluded.updated_at,
			updated_by = excluded.updated_by`,
		string(raw), now, updatedBy)
	return err
}

// ---------------------------------------------------------------------------
// User history
// ---------------------------------------------------------------------------

// HistoryEntry records a single entity view in a user's browsing history.
type HistoryEntry struct {
	Kind      string    `json:"kind"`
	Name      string    `json:"name"`
	Namespace string    `json:"namespace"`
	ViewedAt  time.Time `json:"viewedAt"`
}

// RecordEntityView upserts a history entry for the given user, updating the
// viewed_at timestamp. After the upsert, older entries beyond the most recent
// 20 are pruned so the table stays small.
func (d *DB) RecordEntityView(ctx context.Context, username, kind, name, namespace string) error {
	now := time.Now().UTC()
	if namespace == "" {
		namespace = "default"
	}
	_, err := d.exec(ctx, `
		INSERT INTO user_history (username, kind, name, namespace, viewed_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(username, kind, name, namespace) DO UPDATE SET viewed_at = excluded.viewed_at`,
		username, kind, name, namespace, now)
	if err != nil {
		return err
	}
	// Prune entries beyond the 20 most recent for this user.
	_, err = d.exec(ctx, `
		DELETE FROM user_history
		WHERE username = ?
		  AND id NOT IN (
			SELECT id FROM user_history
			WHERE username = ?
			ORDER BY viewed_at DESC
			LIMIT 20
		  )`, username, username)
	return err
}

// GetUserHistory returns up to limit recently browsed entities for the given user,
// ordered most-recent first.
func (d *DB) GetUserHistory(ctx context.Context, username string, limit int) ([]HistoryEntry, error) {
	if limit <= 0 {
		limit = 10
	}
	rows, err := d.queryRows(ctx,
		`SELECT kind, name, namespace, viewed_at FROM user_history
		 WHERE username = ?
		 ORDER BY viewed_at DESC
		 LIMIT ?`, username, limit)
	if err != nil {
		return nil, fmt.Errorf("getting user history: %w", err)
	}
	defer rows.Close()

	var entries []HistoryEntry
	for rows.Next() {
		var e HistoryEntry
		var viewedAt sql.NullTime
		if err := rows.Scan(&e.Kind, &e.Name, &e.Namespace, &viewedAt); err != nil {
			return nil, err
		}
		if viewedAt.Valid {
			e.ViewedAt = viewedAt.Time.UTC()
		}
		entries = append(entries, e)
	}
	if entries == nil {
		entries = []HistoryEntry{}
	}
	return entries, rows.Err()
}

// ---------------------------------------------------------------------------
// Group types and queries
// ---------------------------------------------------------------------------

// Group represents a Gantry group (local or SSO-synced).
type Group struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	DisplayName string    `json:"displayName,omitempty"`
	Description string    `json:"description,omitempty"`
	Source      string    `json:"source"`
	SourceID    string    `json:"sourceId,omitempty"`
	Role        string    `json:"role"`
	MemberCount int       `json:"memberCount,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// PermissionRule is a fine-grained allow/deny rule.
type PermissionRule struct {
	ID             string    `json:"id"`
	SubjectType    string    `json:"subjectType"`
	SubjectID      string    `json:"subjectId"`
	SubjectName    string    `json:"subjectName,omitempty"`
	ResourceType   string    `json:"resourceType"`
	ResourceFilter string    `json:"resourceFilter,omitempty"`
	Action         string    `json:"action"`
	Effect         string    `json:"effect"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

// CreateGroup inserts a new group.
func (d *DB) CreateGroup(ctx context.Context, g *Group) error {
	g.ID = newUUID()
	now := time.Now().UTC()
	g.CreatedAt = now
	g.UpdatedAt = now
	_, err := d.exec(ctx,
		`INSERT INTO groups (id, name, display_name, description, source, source_id, role, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		g.ID, g.Name, g.DisplayName, g.Description, g.Source, g.SourceID, g.Role, g.CreatedAt, g.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("group %q already exists", g.Name)
		}
		return err
	}
	return nil
}

// GetGroup retrieves a group by ID with its member count.
func (d *DB) GetGroup(ctx context.Context, id string) (*Group, error) {
	row := d.queryRow(ctx,
		`SELECT g.id, g.name, g.display_name, g.description, g.source, g.source_id, g.role,
			g.created_at, g.updated_at, COUNT(ug.user_id) as member_count
		 FROM groups g
		 LEFT JOIN user_groups ug ON g.id = ug.group_id
		 WHERE g.id = ?
		 GROUP BY g.id`, id)
	return scanGroup(row)
}

// GetGroupByName retrieves a group by its unique name.
func (d *DB) GetGroupByName(ctx context.Context, name string) (*Group, error) {
	row := d.queryRow(ctx,
		`SELECT g.id, g.name, g.display_name, g.description, g.source, g.source_id, g.role,
			g.created_at, g.updated_at, COUNT(ug.user_id) as member_count
		 FROM groups g
		 LEFT JOIN user_groups ug ON g.id = ug.group_id
		 WHERE g.name = ?
		 GROUP BY g.id`, name)
	return scanGroup(row)
}

// ListGroups returns all groups with member counts.
func (d *DB) ListGroups(ctx context.Context) ([]*Group, error) {
	rows, err := d.queryRows(ctx,
		`SELECT g.id, g.name, g.display_name, g.description, g.source, g.source_id, g.role,
			g.created_at, g.updated_at, COUNT(ug.user_id) as member_count
		 FROM groups g
		 LEFT JOIN user_groups ug ON g.id = ug.group_id
		 GROUP BY g.id
		 ORDER BY g.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var groups []*Group
	for rows.Next() {
		g := &Group{}
		var displayName, description, sourceID sql.NullString
		var createdAt, updatedAt sql.NullTime
		if err := rows.Scan(&g.ID, &g.Name, &displayName, &description,
			&g.Source, &sourceID, &g.Role,
			&createdAt, &updatedAt, &g.MemberCount); err != nil {
			return nil, err
		}
		if displayName.Valid {
			g.DisplayName = displayName.String
		}
		if description.Valid {
			g.Description = description.String
		}
		if sourceID.Valid {
			g.SourceID = sourceID.String
		}
		if createdAt.Valid {
			g.CreatedAt = createdAt.Time.UTC()
		}
		if updatedAt.Valid {
			g.UpdatedAt = updatedAt.Time.UTC()
		}
		groups = append(groups, g)
	}
	if groups == nil {
		groups = []*Group{}
	}
	return groups, rows.Err()
}

// UpdateGroup updates a group's mutable fields.
func (d *DB) UpdateGroup(ctx context.Context, g *Group) error {
	g.UpdatedAt = time.Now().UTC()
	res, err := d.exec(ctx,
		`UPDATE groups SET display_name = ?, description = ?, role = ?, updated_at = ?
		 WHERE id = ?`,
		g.DisplayName, g.Description, g.Role, g.UpdatedAt, g.ID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return entity.ErrEntityNotFound
	}
	return nil
}

// DeleteGroup removes a group and all its memberships.
func (d *DB) DeleteGroup(ctx context.Context, id string) error {
	_, _ = d.exec(ctx, `DELETE FROM user_groups WHERE group_id = ?`, id)
	_, _ = d.exec(ctx, `DELETE FROM permission_rules WHERE subject_type = 'group' AND subject_id = ?`, id)
	res, err := d.exec(ctx, `DELETE FROM groups WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return entity.ErrEntityNotFound
	}
	return nil
}

// SeedDefaultGroups creates the built-in system groups if they don't already exist.
// These groups mirror the role hierarchy and give admins a clear starting point.
func (d *DB) SeedDefaultGroups(ctx context.Context) error {
	defaults := []struct {
		name, displayName, role string
	}{
		{"admins", "Admins", "admin"},
		{"platform-engineers", "Platform Engineers", "platform-engineer"},
		{"developers", "Developers", "developer"},
	}
	for _, dg := range defaults {
		_, err := d.GetGroupByName(ctx, dg.name)
		if err == nil {
			continue // already exists
		}
		g := &Group{
			Name:        dg.name,
			DisplayName: dg.displayName,
			Source:      "system",
			Role:        dg.role,
		}
		if err := d.CreateGroup(ctx, g); err != nil {
			// Ignore unique constraint errors (race condition).
			if !isUniqueViolation(err) {
				return fmt.Errorf("seeding group %q: %w", dg.name, err)
			}
		}
	}
	return nil
}

// AddUserToGroupByName adds a user to a group, looking up the group by name.
// Used for bootstrap (e.g. adding admin to "admins" group).
func (d *DB) AddUserToGroupByName(ctx context.Context, userID, groupName string) error {
	g, err := d.GetGroupByName(ctx, groupName)
	if err != nil {
		return fmt.Errorf("group %q not found: %w", groupName, err)
	}
	return d.AddUserToGroup(ctx, userID, g.ID)
}

// scanGroup scans a group row including member count.
func scanGroup(row *sql.Row) (*Group, error) {
	g := &Group{}
	var displayName, description, sourceID sql.NullString
	var createdAt, updatedAt sql.NullTime
	err := row.Scan(&g.ID, &g.Name, &displayName, &description,
		&g.Source, &sourceID, &g.Role,
		&createdAt, &updatedAt, &g.MemberCount)
	if err == sql.ErrNoRows {
		return nil, entity.ErrEntityNotFound
	}
	if err != nil {
		return nil, err
	}
	if displayName.Valid {
		g.DisplayName = displayName.String
	}
	if description.Valid {
		g.Description = description.String
	}
	if sourceID.Valid {
		g.SourceID = sourceID.String
	}
	if createdAt.Valid {
		g.CreatedAt = createdAt.Time.UTC()
	}
	if updatedAt.Valid {
		g.UpdatedAt = updatedAt.Time.UTC()
	}
	return g, nil
}

// ---------------------------------------------------------------------------
// User-Group membership queries
// ---------------------------------------------------------------------------

// AddUserToGroup creates a membership.
func (d *DB) AddUserToGroup(ctx context.Context, userID, groupID string) error {
	_, err := d.exec(ctx,
		`INSERT OR IGNORE INTO user_groups (user_id, group_id, added_at)
		 VALUES (?, ?, ?)`, userID, groupID, time.Now().UTC())
	return err
}

// RemoveUserFromGroup deletes a membership.
func (d *DB) RemoveUserFromGroup(ctx context.Context, userID, groupID string) error {
	res, err := d.exec(ctx, `DELETE FROM user_groups WHERE user_id = ? AND group_id = ?`, userID, groupID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return entity.ErrEntityNotFound
	}
	return nil
}

// ListUserGroups returns all groups a user belongs to.
func (d *DB) ListUserGroups(ctx context.Context, userID string) ([]*Group, error) {
	rows, err := d.queryRows(ctx,
		`SELECT g.id, g.name, g.display_name, g.description, g.source, g.source_id, g.role,
			g.created_at, g.updated_at, 0 as member_count
		 FROM groups g
		 JOIN user_groups ug ON g.id = ug.group_id
		 WHERE ug.user_id = ?
		 ORDER BY g.name`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var groups []*Group
	for rows.Next() {
		g := &Group{}
		var displayName, description, sourceID sql.NullString
		var createdAt, updatedAt sql.NullTime
		if err := rows.Scan(&g.ID, &g.Name, &displayName, &description,
			&g.Source, &sourceID, &g.Role,
			&createdAt, &updatedAt, &g.MemberCount); err != nil {
			return nil, err
		}
		if displayName.Valid {
			g.DisplayName = displayName.String
		}
		if description.Valid {
			g.Description = description.String
		}
		if sourceID.Valid {
			g.SourceID = sourceID.String
		}
		if createdAt.Valid {
			g.CreatedAt = createdAt.Time.UTC()
		}
		if updatedAt.Valid {
			g.UpdatedAt = updatedAt.Time.UTC()
		}
		groups = append(groups, g)
	}
	if groups == nil {
		groups = []*Group{}
	}
	return groups, rows.Err()
}

// ListGroupMembers returns all users in a group.
func (d *DB) ListGroupMembers(ctx context.Context, groupID string) ([]*User, error) {
	rows, err := d.queryRows(ctx,
		`SELECT u.id, u.username, u.password_hash, u.display_name, u.email, u.role, u.sso_only, u.created_at, u.updated_at
		 FROM users u
		 JOIN user_groups ug ON u.id = ug.user_id
		 WHERE ug.group_id = ?
		 ORDER BY u.username`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var users []*User
	for rows.Next() {
		u := &User{}
		var displayName, email sql.NullString
		var createdAt, updatedAt sql.NullTime
		var ssoOnly int
		if err := rows.Scan(&u.ID, &u.Username, &u.PasswordHash,
			&displayName, &email, &u.Role, &ssoOnly, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		if displayName.Valid {
			u.DisplayName = displayName.String
		}
		if email.Valid {
			u.Email = email.String
		}
		u.SSOOnly = ssoOnly != 0
		if createdAt.Valid {
			u.CreatedAt = createdAt.Time.UTC()
		}
		if updatedAt.Valid {
			u.UpdatedAt = updatedAt.Time.UTC()
		}
		users = append(users, u)
	}
	if users == nil {
		users = []*User{}
	}
	return users, rows.Err()
}

// SyncUserGroups replaces all group memberships for a user with the given group IDs.
// Used during SSO login to reconcile group memberships.
func (d *DB) SyncUserGroups(ctx context.Context, userID string, groupIDs []string) error {
	_, err := d.exec(ctx, `DELETE FROM user_groups WHERE user_id = ?`, userID)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	for _, gid := range groupIDs {
		_, err := d.exec(ctx,
			`INSERT INTO user_groups (user_id, group_id, added_at) VALUES (?, ?, ?)`,
			userID, gid, now)
		if err != nil {
			return err
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Permission rule queries
// ---------------------------------------------------------------------------

// CreatePermissionRule inserts a new permission rule.
func (d *DB) CreatePermissionRule(ctx context.Context, r *PermissionRule) error {
	r.ID = newUUID()
	now := time.Now().UTC()
	r.CreatedAt = now
	r.UpdatedAt = now
	_, err := d.exec(ctx,
		`INSERT INTO permission_rules (id, subject_type, subject_id, resource_type, resource_filter, action, effect, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		r.ID, r.SubjectType, r.SubjectID, r.ResourceType, r.ResourceFilter, r.Action, r.Effect, r.CreatedAt, r.UpdatedAt)
	return err
}

// ListPermissionRules returns all permission rules.
func (d *DB) ListPermissionRules(ctx context.Context) ([]*PermissionRule, error) {
	rows, err := d.queryRows(ctx,
		`SELECT id, subject_type, subject_id, resource_type, resource_filter, action, effect, created_at, updated_at
		 FROM permission_rules ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var rules []*PermissionRule
	for rows.Next() {
		r := &PermissionRule{}
		var resourceFilter sql.NullString
		var createdAt, updatedAt sql.NullTime
		if err := rows.Scan(&r.ID, &r.SubjectType, &r.SubjectID,
			&r.ResourceType, &resourceFilter, &r.Action, &r.Effect,
			&createdAt, &updatedAt); err != nil {
			return nil, err
		}
		if resourceFilter.Valid {
			r.ResourceFilter = resourceFilter.String
		}
		if createdAt.Valid {
			r.CreatedAt = createdAt.Time.UTC()
		}
		if updatedAt.Valid {
			r.UpdatedAt = updatedAt.Time.UTC()
		}
		rules = append(rules, r)
	}
	if rules == nil {
		rules = []*PermissionRule{}
	}
	return rules, rows.Err()
}

// ListPermissionRulesForSubject returns rules for a specific user or group.
func (d *DB) ListPermissionRulesForSubject(ctx context.Context, subjectType, subjectID string) ([]*PermissionRule, error) {
	rows, err := d.queryRows(ctx,
		`SELECT id, subject_type, subject_id, resource_type, resource_filter, action, effect, created_at, updated_at
		 FROM permission_rules WHERE subject_type = ? AND subject_id = ?
		 ORDER BY created_at`, subjectType, subjectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var rules []*PermissionRule
	for rows.Next() {
		r := &PermissionRule{}
		var resourceFilter sql.NullString
		var createdAt, updatedAt sql.NullTime
		if err := rows.Scan(&r.ID, &r.SubjectType, &r.SubjectID,
			&r.ResourceType, &resourceFilter, &r.Action, &r.Effect,
			&createdAt, &updatedAt); err != nil {
			return nil, err
		}
		if resourceFilter.Valid {
			r.ResourceFilter = resourceFilter.String
		}
		if createdAt.Valid {
			r.CreatedAt = createdAt.Time.UTC()
		}
		if updatedAt.Valid {
			r.UpdatedAt = updatedAt.Time.UTC()
		}
		rules = append(rules, r)
	}
	if rules == nil {
		rules = []*PermissionRule{}
	}
	return rules, rows.Err()
}

// DeletePermissionRule removes a rule by ID.
func (d *DB) DeletePermissionRule(ctx context.Context, id string) error {
	res, err := d.exec(ctx, `DELETE FROM permission_rules WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return entity.ErrEntityNotFound
	}
	return nil
}

// DeleteAllPermissionRules removes all permission rules. Used during RBAC import.
func (d *DB) DeleteAllPermissionRules(ctx context.Context) error {
	_, err := d.exec(ctx, `DELETE FROM permission_rules`)
	return err
}

// GetEffectiveRules returns all permission rules that apply to a user,
// including rules assigned to the user directly and to all their groups.
func (d *DB) GetEffectiveRules(ctx context.Context, userID string) ([]*PermissionRule, error) {
	rows, err := d.queryRows(ctx,
		`SELECT pr.id, pr.subject_type, pr.subject_id, pr.resource_type, pr.resource_filter, pr.action, pr.effect, pr.created_at, pr.updated_at
		 FROM permission_rules pr
		 WHERE (pr.subject_type = 'user' AND pr.subject_id = ?)
		    OR (pr.subject_type = 'group' AND pr.subject_id IN (
		        SELECT group_id FROM user_groups WHERE user_id = ?
		    ))
		 ORDER BY pr.created_at`, userID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var rules []*PermissionRule
	for rows.Next() {
		r := &PermissionRule{}
		var resourceFilter sql.NullString
		var createdAt, updatedAt sql.NullTime
		if err := rows.Scan(&r.ID, &r.SubjectType, &r.SubjectID,
			&r.ResourceType, &resourceFilter, &r.Action, &r.Effect,
			&createdAt, &updatedAt); err != nil {
			return nil, err
		}
		if resourceFilter.Valid {
			r.ResourceFilter = resourceFilter.String
		}
		if createdAt.Valid {
			r.CreatedAt = createdAt.Time.UTC()
		}
		if updatedAt.Valid {
			r.UpdatedAt = updatedAt.Time.UTC()
		}
		rules = append(rules, r)
	}
	if rules == nil {
		rules = []*PermissionRule{}
	}
	return rules, rows.Err()
}

// ---------------------------------------------------------------------------
// Role types and queries
// ---------------------------------------------------------------------------

// Role represents a configurable role definition with permission grants.
type Role struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	DisplayName string          `json:"displayName,omitempty"`
	Description string          `json:"description,omitempty"`
	Level       int             `json:"level"`
	BuiltIn     bool            `json:"builtIn"`
	Permissions map[string]bool `json:"permissions"`
	CreatedAt   time.Time       `json:"createdAt"`
	UpdatedAt   time.Time       `json:"updatedAt"`
}

// SeedDefaultRoles creates the built-in roles if they don't already exist.
func (d *DB) SeedDefaultRoles(ctx context.Context) error {
	defaults := []struct {
		name, displayName, description string
		level                          int
		permissions                    map[string]bool
	}{
		{"viewer", "Viewer", "Read-only access to all resources", 1,
			map[string]bool{"read": true, "write": false, "execute": false, "delete": false, "admin": false}},
		{"developer", "Developer", "Can create, update, and execute resources", 2,
			map[string]bool{"read": true, "write": true, "execute": true, "delete": true, "admin": false}},
		{"platform-engineer", "Platform Engineer", "Can manage infrastructure and environments", 3,
			map[string]bool{"read": true, "write": true, "execute": true, "delete": true, "admin": false}},
		{"admin", "Administrator", "Full access including user and role management", 4,
			map[string]bool{"read": true, "write": true, "execute": true, "delete": true, "admin": true}},
	}
	for _, dr := range defaults {
		_, err := d.GetRoleByName(ctx, dr.name)
		if err == nil {
			continue
		}
		permsJSON, _ := json.Marshal(dr.permissions)
		id := newUUID()
		now := time.Now().UTC()
		_, err = d.exec(ctx,
			`INSERT INTO roles (id, name, display_name, description, level, built_in, permissions, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
			id, dr.name, dr.displayName, dr.description, dr.level, string(permsJSON), now, now)
		if err != nil && !isUniqueViolation(err) {
			return fmt.Errorf("seeding role %q: %w", dr.name, err)
		}
	}
	return nil
}

// ListRoles returns all roles ordered by level.
func (d *DB) ListRoles(ctx context.Context) ([]*Role, error) {
	rows, err := d.queryRows(ctx,
		`SELECT id, name, display_name, description, level, built_in, permissions, created_at, updated_at
		 FROM roles ORDER BY level, name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var roles []*Role
	for rows.Next() {
		r, err := scanRole(rows)
		if err != nil {
			return nil, err
		}
		roles = append(roles, r)
	}
	if roles == nil {
		roles = []*Role{}
	}
	return roles, rows.Err()
}

// GetRole retrieves a role by ID.
func (d *DB) GetRole(ctx context.Context, id string) (*Role, error) {
	row := d.queryRow(ctx,
		`SELECT id, name, display_name, description, level, built_in, permissions, created_at, updated_at
		 FROM roles WHERE id = ?`, id)
	return scanRoleSingle(row)
}

// GetRoleByName retrieves a role by its unique name.
func (d *DB) GetRoleByName(ctx context.Context, name string) (*Role, error) {
	row := d.queryRow(ctx,
		`SELECT id, name, display_name, description, level, built_in, permissions, created_at, updated_at
		 FROM roles WHERE name = ?`, name)
	return scanRoleSingle(row)
}

// CreateRole inserts a new custom role.
func (d *DB) CreateRole(ctx context.Context, r *Role) error {
	r.ID = newUUID()
	now := time.Now().UTC()
	r.CreatedAt = now
	r.UpdatedAt = now
	permsJSON, _ := json.Marshal(r.Permissions)
	builtIn := 0
	if r.BuiltIn {
		builtIn = 1
	}
	_, err := d.exec(ctx,
		`INSERT INTO roles (id, name, display_name, description, level, built_in, permissions, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		r.ID, r.Name, r.DisplayName, r.Description, r.Level, builtIn, string(permsJSON), r.CreatedAt, r.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("role %q already exists", r.Name)
		}
		return err
	}
	return nil
}

// UpdateRole updates a role's mutable fields.
func (d *DB) UpdateRole(ctx context.Context, r *Role) error {
	r.UpdatedAt = time.Now().UTC()
	permsJSON, _ := json.Marshal(r.Permissions)
	res, err := d.exec(ctx,
		`UPDATE roles SET display_name = ?, description = ?, level = ?, permissions = ?, updated_at = ?
		 WHERE id = ?`,
		r.DisplayName, r.Description, r.Level, string(permsJSON), r.UpdatedAt, r.ID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return entity.ErrEntityNotFound
	}
	return nil
}

// DeleteRole removes a role by ID. Returns an error if the role is built-in.
func (d *DB) DeleteRole(ctx context.Context, id string) error {
	res, err := d.exec(ctx, `DELETE FROM roles WHERE id = ? AND built_in = 0`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("role not found or is built-in")
	}
	return nil
}

// IsRoleInUse checks if any users or groups reference the given role name.
func (d *DB) IsRoleInUse(ctx context.Context, roleName string) (bool, error) {
	row := d.queryRow(ctx,
		`SELECT COUNT(*) FROM (
			SELECT 1 FROM users WHERE role = ?
			UNION ALL
			SELECT 1 FROM groups WHERE role = ?
		)`, roleName, roleName)
	var count int
	if err := row.Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

func scanRole(rows *sql.Rows) (*Role, error) {
	r := &Role{}
	var displayName, description sql.NullString
	var builtIn int
	var permsJSON string
	var createdAt, updatedAt sql.NullTime
	if err := rows.Scan(&r.ID, &r.Name, &displayName, &description,
		&r.Level, &builtIn, &permsJSON, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	r.DisplayName = displayName.String
	r.Description = description.String
	r.BuiltIn = builtIn == 1
	r.Permissions = make(map[string]bool)
	_ = json.Unmarshal([]byte(permsJSON), &r.Permissions)
	if createdAt.Valid {
		r.CreatedAt = createdAt.Time.UTC()
	}
	if updatedAt.Valid {
		r.UpdatedAt = updatedAt.Time.UTC()
	}
	return r, nil
}

func scanRoleSingle(row *sql.Row) (*Role, error) {
	r := &Role{}
	var displayName, description sql.NullString
	var builtIn int
	var permsJSON string
	var createdAt, updatedAt sql.NullTime
	err := row.Scan(&r.ID, &r.Name, &displayName, &description,
		&r.Level, &builtIn, &permsJSON, &createdAt, &updatedAt)
	if err == sql.ErrNoRows {
		return nil, entity.ErrEntityNotFound
	}
	if err != nil {
		return nil, err
	}
	r.DisplayName = displayName.String
	r.Description = description.String
	r.BuiltIn = builtIn == 1
	r.Permissions = make(map[string]bool)
	_ = json.Unmarshal([]byte(permsJSON), &r.Permissions)
	if createdAt.Valid {
		r.CreatedAt = createdAt.Time.UTC()
	}
	if updatedAt.Valid {
		r.UpdatedAt = updatedAt.Time.UTC()
	}
	return r, nil
}
