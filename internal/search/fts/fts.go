// Package fts contains shared helpers for Gantry FTS5 queries.
package fts

import (
	"strings"
	"unicode"
)

// SanitizeQuery converts raw user input into a safe FTS5 MATCH expression.
// Punctuation and symbols become token boundaries so pasted values such as URLs
// match the unicode61-tokenized index. The final token gets a '*' suffix for
// search-as-you-type prefix matching.
func SanitizeQuery(q string) string {
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
