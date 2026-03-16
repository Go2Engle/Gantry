// Package web embeds the built frontend assets (dist/) into the binary.
package web

import "embed"

// DistFS contains the built frontend assets from web/dist/.
// When building, run "cd web && npm run build" first to populate the directory.
// If web/dist/ does not exist at build time, the binary still compiles but
// the embedded filesystem will be empty.
//
//go:embed all:dist
var DistFS embed.FS
