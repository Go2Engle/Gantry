// Package search provides full-text search over the Gantry entity catalog
// using SQLite FTS5. It assumes the FTS5 virtual table `entities_fts` has
// been created by database migrations with columns: kind, name, namespace, title.
package search

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"unicode"
)

// Result represents a single search hit from the FTS5 index.
type Result struct {
	Kind      string  `json:"kind"`
	Name      string  `json:"name"`
	Namespace string  `json:"namespace"`
	Title     string  `json:"title"`
	Rank      float64 `json:"rank"`
}

// Service provides full-text search capabilities backed by SQLite FTS5.
type Service struct {
	db *sql.DB
}

// New creates a new search service using the given database connection.
// The database must have the `entities_fts` FTS5 virtual table already created.
func New(db *sql.DB) *Service {
	return &Service{db: db}
}

// Search performs a full-text search against the entity catalog. Raw user input
// is normalized into an FTS5-safe token query before execution. Results are
// ordered by relevance rank.
func (s *Service) Search(ctx context.Context, query string) ([]*Result, error) {
	if query == "" {
		return nil, nil
	}

	// Sanitize: FTS5 treats punctuation such as ':', '-', '/', and '"' as
	// syntax. Those characters also appear in common entity values like URLs,
	// so normalize them into token boundaries before adding prefix matching.
	ftsQuery := sanitizeFTS5(query)
	if ftsQuery == "" {
		return nil, nil
	}

	// Join FTS results back to entities table to get namespace (not in FTS index).
	const stmt = `SELECT e.kind, e.name, e.namespace, e.title, fts.rank
		FROM entities_fts fts
		JOIN entities e ON e.rowid = fts.rowid
		WHERE entities_fts MATCH ?
		ORDER BY fts.rank`

	rows, err := s.db.QueryContext(ctx, stmt, ftsQuery)
	if err != nil {
		return nil, fmt.Errorf("search: query %q: %w", query, err)
	}
	defer rows.Close()

	var results []*Result
	for rows.Next() {
		r := &Result{}
		var title sql.NullString
		if err := rows.Scan(&r.Kind, &r.Name, &r.Namespace, &title, &r.Rank); err != nil {
			return nil, fmt.Errorf("search: scan result: %w", err)
		}
		r.Title = title.String
		results = append(results, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("search: iterate results: %w", err)
	}

	return results, nil
}

// sanitizeFTS5 converts a raw user query into a safe FTS5 MATCH expression.
// It replaces punctuation and symbols with spaces so raw input aligns with how
// the FTS5 unicode61 tokenizer indexed text like names, labels, and URLs. The
// last token gets a '*' suffix for prefix matching, enabling search-as-you-type
// behaviour.
func sanitizeFTS5(q string) string {
	var b strings.Builder
	for _, r := range q {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		} else {
			b.WriteByte(' ')
		}
	}
	parts := strings.Fields(b.String())
	if len(parts) == 0 {
		return ""
	}
	parts[len(parts)-1] += "*"
	return strings.Join(parts, " ")
}

// Reindex rebuilds the FTS5 index from the underlying entities table.
// This is useful after bulk data changes or to repair a corrupted index.
func (s *Service) Reindex(ctx context.Context) error {
	const stmt = `INSERT INTO entities_fts(entities_fts) VALUES('rebuild')`

	if _, err := s.db.ExecContext(ctx, stmt); err != nil {
		return fmt.Errorf("search: reindex: %w", err)
	}
	return nil
}
