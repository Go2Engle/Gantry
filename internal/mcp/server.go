// Package mcp exposes Gantry's read-only API surface over the Model Context
// Protocol so local AI agents (Claude Code, Cursor, etc.) can answer questions
// about the catalog without context-switching to the UI.
//
// The transport is Streamable HTTP mounted inside the existing authenticated
// API group, so agents authenticate with the same API keys as any other client.
package mcp

import (
	"net/http"

	"github.com/go2engle/gantry/internal/api/handlers"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// NewHandler builds an http.Handler that serves MCP over Streamable HTTP,
// exposing tools backed by the given Handlers' services.
func NewHandler(h *handlers.Handlers) http.Handler {
	srv := mcpsdk.NewServer(&mcpsdk.Implementation{
		Name:    "gantry",
		Version: h.Version,
	}, nil)

	registerTools(srv, h)

	return mcpsdk.NewStreamableHTTPHandler(func(*http.Request) *mcpsdk.Server {
		return srv
	}, nil)
}
