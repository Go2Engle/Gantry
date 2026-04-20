package entity

import "strings"

// KindDefinition describes a built-in entity kind in Gantry.
type KindDefinition struct {
	// Name is the singular, PascalCase name of the kind (e.g., "Service").
	Name string `json:"name"`

	// Plural is the lowercase plural form used in API paths (e.g., "services").
	Plural string `json:"plural"`

	// Description is a short human-readable summary of the kind.
	Description string `json:"description"`
}

// BuiltinKinds is the authoritative list of entity kinds supported by Gantry.
var BuiltinKinds = []KindDefinition{
	{Name: "Service", Plural: "services", Description: "Application, microservice, or backend component"},
	{Name: "API", Plural: "apis", Description: "REST, gRPC, GraphQL, or event-based API definition"},
	{Name: "Infrastructure", Plural: "infrastructure", Description: "Database, queue, cache, storage, or other infrastructure"},
	{Name: "Team", Plural: "teams", Description: "Engineering team or group"},
	{Name: "Environment", Plural: "environments", Description: "Deployment target or cloud account"},
	{Name: "Documentation", Plural: "documentation", Description: "Link to external documentation or runbook"},
	{Name: "Flow", Plural: "flows", Description: "Interactive system flow diagram backed by catalog entities"},
	{Name: "Action", Plural: "actions", Description: "Self-service workflow definition"},
}

// kindIndex is a pre-built lookup table keyed by lowercase kind name.
var kindIndex map[string]*KindDefinition

func init() {
	kindIndex = make(map[string]*KindDefinition, len(BuiltinKinds))
	for i := range BuiltinKinds {
		kindIndex[strings.ToLower(BuiltinKinds[i].Name)] = &BuiltinKinds[i]
	}
}

// GetKind returns the KindDefinition for the given name (case-insensitive).
// It returns nil if the kind is not a built-in kind.
func GetKind(name string) *KindDefinition {
	return kindIndex[strings.ToLower(name)]
}

// IsValidKind reports whether name matches a built-in kind (case-insensitive).
func IsValidKind(name string) bool {
	return GetKind(name) != nil
}

// KindNames returns the list of all built-in kind names.
func KindNames() []string {
	names := make([]string, len(BuiltinKinds))
	for i, k := range BuiltinKinds {
		names[i] = k.Name
	}
	return names
}
