// Package entity defines the core entity model for Gantry.
// All catalog items (services, APIs, teams, etc.) are represented as entities
// following a Kubernetes-inspired structure with kind, apiVersion, metadata, and spec.
package entity

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	// DefaultAPIVersion is the default API version assigned to entities.
	DefaultAPIVersion = "gantry.io/v1"

	// DefaultNamespace is the default namespace assigned to entities.
	DefaultNamespace = "default"
)

// Entity represents a catalog item in Gantry.
type Entity struct {
	Kind       string         `json:"kind"`
	APIVersion string         `json:"apiVersion"`
	Metadata   EntityMetadata `json:"metadata"`
	Spec       map[string]any `json:"spec,omitempty"`
}

// EntityMetadata holds the common metadata fields for all entities.
type EntityMetadata struct {
	Name        string            `json:"name"`
	Namespace   string            `json:"namespace,omitempty"`
	Title       string            `json:"title,omitempty"`
	Description string            `json:"description,omitempty"`
	Owner       string            `json:"owner,omitempty"`
	Tags        []string          `json:"tags,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
	Labels      map[string]string `json:"labels,omitempty"`
	CreatedAt   time.Time         `json:"createdAt,omitempty"`
	UpdatedAt   time.Time         `json:"updatedAt,omitempty"`
	CreatedBy   string            `json:"createdBy,omitempty"`
}

// Validate checks that the entity has all required fields populated.
// It returns an error describing all validation failures, or nil if the entity is valid.
func (e *Entity) Validate() error {
	var errs []string

	if strings.TrimSpace(e.Kind) == "" {
		errs = append(errs, "kind is required")
	}

	if strings.TrimSpace(e.Metadata.Name) == "" {
		errs = append(errs, "metadata.name is required")
	}

	if len(errs) > 0 {
		return fmt.Errorf("entity validation failed: %s", strings.Join(errs, "; "))
	}

	return nil
}

// SetDefaults populates default values for optional fields that are empty.
// It sets apiVersion to "gantry.io/v1" if unset, namespace to "default" if unset,
// and initializes timestamps if they are zero-valued.
func (e *Entity) SetDefaults() {
	if strings.TrimSpace(e.APIVersion) == "" {
		e.APIVersion = DefaultAPIVersion
	}

	if strings.TrimSpace(e.Metadata.Namespace) == "" {
		e.Metadata.Namespace = DefaultNamespace
	}

	now := time.Now().UTC()
	if e.Metadata.CreatedAt.IsZero() {
		e.Metadata.CreatedAt = now
	}
	if e.Metadata.UpdatedAt.IsZero() {
		e.Metadata.UpdatedAt = now
	}
}

// EntityList represents a paginated list of entities.
type EntityList struct {
	Items      []Entity `json:"items"`
	TotalCount int      `json:"totalCount"`
	Offset     int      `json:"offset"`
	Limit      int      `json:"limit"`
}

// EntityRef is a lightweight reference to an entity by kind and name.
type EntityRef struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace,omitempty"`
}

// String returns a human-readable representation of the entity reference.
func (r EntityRef) String() string {
	if r.Namespace != "" && r.Namespace != DefaultNamespace {
		return fmt.Sprintf("%s:%s/%s", r.Kind, r.Namespace, r.Name)
	}
	return fmt.Sprintf("%s:%s", r.Kind, r.Name)
}

// ErrEntityNotFound is returned when an entity cannot be located.
var ErrEntityNotFound = errors.New("entity not found")

// ErrEntityAlreadyExists is returned when attempting to create a duplicate entity.
var ErrEntityAlreadyExists = errors.New("entity already exists")

// ErrEntityAmbiguous is returned when a lookup expected one entity but matched many.
var ErrEntityAmbiguous = errors.New("entity lookup is ambiguous")

// ErrInvalidEntity is returned when an entity fails validation.
var ErrInvalidEntity = errors.New("invalid entity")
