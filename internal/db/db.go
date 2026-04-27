// Package db provides database access for Gantry.
// It supports both SQLite (via modernc.org/sqlite, pure Go) and PostgreSQL.
// SQLite is the default for single-binary deployments; PostgreSQL is used
// for production multi-instance setups.
package db

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/go2engle/gantry/internal/config"
	"github.com/go2engle/gantry/internal/crypto"

	// SQLite driver (pure Go, no CGO required).
	_ "modernc.org/sqlite"
	// PostgreSQL driver.
	_ "github.com/lib/pq"
)

// DB wraps a standard database/sql.DB connection with Gantry-specific helpers.
type DB struct {
	*sql.DB
	cfg    *config.Config
	encKey []byte
}

// New opens a database connection based on the provided configuration.
// For SQLite, it ensures the data directory exists and enables WAL mode
// and foreign keys. For PostgreSQL, it connects using the provided DSN.
func New(cfg *config.Config) (*DB, error) {
	// Ensure the data directory exists (needed for both SQLite and the key file).
	if err := os.MkdirAll(cfg.DataDir, 0o750); err != nil {
		return nil, fmt.Errorf("creating data directory %s: %w", cfg.DataDir, err)
	}

	sqlDB, err := sql.Open(cfg.DriverName(), cfg.DSN())
	if err != nil {
		return nil, fmt.Errorf("opening database: %w", err)
	}

	// Verify connectivity.
	if err := sqlDB.Ping(); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("connecting to database: %w", err)
	}

	// Tune connection pool for SQLite (single-writer).
	if cfg.DBType == "sqlite" {
		sqlDB.SetMaxOpenConns(1)
	}

	encKey, err := loadOrGenerateEncryptionKey(cfg)
	if err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("loading encryption key: %w", err)
	}

	return &DB{DB: sqlDB, cfg: cfg, encKey: encKey}, nil
}

// loadOrGenerateEncryptionKey returns a 32-byte AES key for encrypting secrets.
//
// Priority:
//  1. GANTRY_ENCRYPTION_KEY env var / config field — derive via SHA-256.
//  2. Persisted key file at <DataDir>/encryption.key — load it.
//  3. Generate a fresh random key and persist it to the key file.
//
// Using a persisted key file means single-binary deployments work out of the
// box without any extra configuration, while production operators can supply
// an explicit key via GANTRY_ENCRYPTION_KEY for portability and rotation.
func loadOrGenerateEncryptionKey(cfg *config.Config) ([]byte, error) {
	if cfg.EncryptionKey != "" {
		h := sha256.Sum256([]byte(cfg.EncryptionKey))
		return h[:], nil
	}

	keyPath := filepath.Join(cfg.DataDir, "encryption.key")
	if data, err := os.ReadFile(keyPath); err == nil {
		key, err := hex.DecodeString(strings.TrimSpace(string(data)))
		if err == nil && len(key) == 32 {
			return key, nil
		}
	}

	// Generate and persist a new key.
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("generating encryption key: %w", err)
	}
	if err := os.WriteFile(keyPath, []byte(hex.EncodeToString(key)), 0o600); err != nil {
		return nil, fmt.Errorf("persisting encryption key to %s: %w", keyPath, err)
	}
	return key, nil
}

// MigrateEncryptPluginConfigs encrypts any plaintext plugin configs left over
// from before encryption was introduced. It is safe to call on every startup —
// already-encrypted values are left unchanged.
func (d *DB) MigrateEncryptPluginConfigs(ctx context.Context) error {
	rows, err := d.queryRows(ctx, `SELECT name, config FROM plugins`)
	if err != nil {
		return err
	}

	type row struct {
		name   string
		config string
	}
	var plaintext []row
	for rows.Next() {
		var name string
		var configStr sql.NullString
		if err := rows.Scan(&name, &configStr); err != nil {
			rows.Close()
			return err
		}
		if configStr.Valid && configStr.String != "" &&
			configStr.String != "null" &&
			!crypto.IsEncrypted(configStr.String) {
			plaintext = append(plaintext, row{name: name, config: configStr.String})
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, r := range plaintext {
		encrypted, err := crypto.Encrypt(d.encKey, []byte(r.config))
		if err != nil {
			return fmt.Errorf("encrypting config for plugin %s: %w", r.name, err)
		}
		if _, err := d.exec(ctx,
			`UPDATE plugins SET config = ? WHERE name = ?`, encrypted, r.name); err != nil {
			return fmt.Errorf("updating config for plugin %s: %w", r.name, err)
		}
	}
	return nil
}

// Migrate runs all database migrations to bring the schema up to date.
// Migrations are idempotent (using IF NOT EXISTS) so they are safe to run
// on every startup. ALTER TABLE statements silently skip "duplicate column"
// errors so they remain safe across restarts.
func (d *DB) Migrate() error {
	migrations := allMigrations(d.cfg.DBType)
	for i, m := range migrations {
		if _, err := d.Exec(m); err != nil {
			// ALTER TABLE ADD COLUMN is not idempotent in SQLite/Postgres;
			// tolerate "duplicate column" errors so migrations can re-run.
			if isDuplicateColumnErr(err) {
				continue
			}
			return fmt.Errorf("migration %d failed: %w", i+1, err)
		}
	}
	if d.IsSQLite() {
		if err := d.ensureEntitiesFTSSchema(); err != nil {
			return err
		}
	}
	return nil
}

func (d *DB) ensureEntitiesFTSSchema() error {
	ctx := context.Background()
	columns := map[string]bool{}
	rows, err := d.queryRows(ctx, `PRAGMA table_info(entities_fts)`)
	if err != nil {
		return fmt.Errorf("checking entities_fts schema: %w", err)
	}
	for rows.Next() {
		var cid int
		var name, colType string
		var notNull, pk int
		var defaultValue any
		if err := rows.Scan(&cid, &name, &colType, &notNull, &defaultValue, &pk); err != nil {
			rows.Close()
			return fmt.Errorf("scanning entities_fts schema: %w", err)
		}
		columns[name] = true
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("closing entities_fts schema rows: %w", err)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterating entities_fts schema: %w", err)
	}

	required := []string{
		"name",
		"namespace",
		"title",
		"description",
		"tags",
		"kind",
		"owner",
		"annotations",
		"labels",
		"spec",
		"api_version",
		"created_by",
	}
	needsRebuild := len(columns) == 0
	for _, col := range required {
		if !columns[col] {
			needsRebuild = true
			break
		}
	}
	if !needsRebuild {
		triggersOK, err := d.entitiesFTSTriggersExist(ctx)
		if err != nil {
			return err
		}
		needsRebuild = !triggersOK
	}
	if !needsRebuild {
		return nil
	}

	statements := []string{
		`DROP TRIGGER IF EXISTS entities_ai`,
		`DROP TRIGGER IF EXISTS entities_ad`,
		`DROP TRIGGER IF EXISTS entities_au`,
		`DROP TABLE IF EXISTS entities_fts`,
		entitiesFTSTableSQL,
		entitiesFTSInsertTriggerSQL,
		entitiesFTSDeleteTriggerSQL,
		entitiesFTSUpdateTriggerSQL,
		`INSERT INTO entities_fts(entities_fts) VALUES('rebuild')`,
	}
	for _, stmt := range statements {
		if _, err := d.exec(ctx, stmt); err != nil {
			return fmt.Errorf("upgrading entities_fts schema: %w", err)
		}
	}
	return nil
}

func (d *DB) entitiesFTSTriggersExist(ctx context.Context) (bool, error) {
	rows, err := d.queryRows(ctx, `
		SELECT name, sql
		FROM sqlite_master
		WHERE type = 'trigger'
			AND tbl_name = 'entities'
			AND name IN ('entities_ai', 'entities_ad', 'entities_au')`)
	if err != nil {
		return false, fmt.Errorf("checking entities_fts triggers: %w", err)
	}
	defer rows.Close()

	found := map[string]bool{}
	expected := map[string]string{
		"entities_ai": normalizeSQLiteSchemaSQL(entitiesFTSInsertTriggerSQL),
		"entities_ad": normalizeSQLiteSchemaSQL(entitiesFTSDeleteTriggerSQL),
		"entities_au": normalizeSQLiteSchemaSQL(entitiesFTSUpdateTriggerSQL),
	}
	for rows.Next() {
		var name, triggerSQL string
		if err := rows.Scan(&name, &triggerSQL); err != nil {
			return false, fmt.Errorf("scanning entities_fts trigger: %w", err)
		}
		found[name] = normalizeSQLiteSchemaSQL(triggerSQL) == expected[name]
	}
	if err := rows.Err(); err != nil {
		return false, fmt.Errorf("iterating entities_fts triggers: %w", err)
	}
	return found["entities_ai"] && found["entities_ad"] && found["entities_au"], nil
}

func normalizeSQLiteSchemaSQL(sql string) string {
	normalized := strings.Join(strings.Fields(sql), " ")
	normalized = strings.Replace(normalized, "CREATE TRIGGER IF NOT EXISTS ", "CREATE TRIGGER ", 1)
	return strings.ToLower(normalized)
}

// pgDuplicateColumnRe matches PostgreSQL's duplicate-column error message:
// "column \"...\" of relation \"...\" already exists".
var pgDuplicateColumnRe = regexp.MustCompile(`column ".*" of relation ".*" already exists`)

// isDuplicateColumnErr returns true if the error is a "duplicate column" error
// from an ALTER TABLE ADD COLUMN statement (safe to ignore on re-run).
func isDuplicateColumnErr(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	// SQLite: "duplicate column name: ..."
	if strings.Contains(msg, "duplicate column") {
		return true
	}
	// PostgreSQL: "column \"...\" of relation \"...\" already exists"
	return pgDuplicateColumnRe.MatchString(msg)
}

// IsSQLite returns true if the underlying database is SQLite.
func (d *DB) IsSQLite() bool {
	return d.cfg.DBType == "sqlite"
}

// rebind converts SQLite-style ? placeholders to PostgreSQL-style $1, $2, ...
// placeholders. For SQLite it returns the query unchanged.
func (d *DB) rebind(query string) string {
	if d.IsSQLite() {
		return query
	}
	out := make([]byte, 0, len(query)+8)
	n := 0
	for i := 0; i < len(query); i++ {
		if query[i] == '?' {
			n++
			out = fmt.Appendf(out, "$%d", n)
		} else {
			out = append(out, query[i])
		}
	}
	return string(out)
}

// exec is a rebinding wrapper around ExecContext.
func (d *DB) exec(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return d.ExecContext(ctx, d.rebind(query), args...)
}

// queryRows is a rebinding wrapper around QueryContext.
func (d *DB) queryRows(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return d.QueryContext(ctx, d.rebind(query), args...)
}

// queryRow is a rebinding wrapper around QueryRowContext.
func (d *DB) queryRow(ctx context.Context, query string, args ...any) *sql.Row {
	return d.QueryRowContext(ctx, d.rebind(query), args...)
}
