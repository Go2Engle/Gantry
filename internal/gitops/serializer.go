// Package gitops provides bidirectional Git synchronization for Gantry entities.
package gitops

import (
	"bytes"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/go2engle/gantry/internal/entity"
	"gopkg.in/yaml.v3"
)

// yamlEntity mirrors entity.Entity but with YAML tags and omits server-managed fields.
type yamlEntity struct {
	Kind       string         `yaml:"kind"`
	APIVersion string         `yaml:"apiVersion"`
	Metadata   yamlMetadata   `yaml:"metadata"`
	Spec       map[string]any `yaml:"spec,omitempty"`
}

type yamlMetadata struct {
	Name        string            `yaml:"name"`
	Namespace   string            `yaml:"namespace,omitempty"`
	Title       string            `yaml:"title,omitempty"`
	Description string            `yaml:"description,omitempty"`
	Owner       string            `yaml:"owner,omitempty"`
	Tags        []string          `yaml:"tags,omitempty"`
	Annotations map[string]string `yaml:"annotations,omitempty"`
	Labels      map[string]string `yaml:"labels,omitempty"`
}

// SerializeEntity converts an entity to clean YAML suitable for Git storage.
// Server-managed fields (createdAt, updatedAt, createdBy) are stripped.
func SerializeEntity(e *entity.Entity) ([]byte, error) {
	ye := yamlEntity{
		Kind:       e.Kind,
		APIVersion: e.APIVersion,
		Metadata: yamlMetadata{
			Name:        e.Metadata.Name,
			Namespace:   e.Metadata.Namespace,
			Title:       e.Metadata.Title,
			Description: e.Metadata.Description,
			Owner:       e.Metadata.Owner,
			Tags:        e.Metadata.Tags,
			Annotations: e.Metadata.Annotations,
			Labels:      e.Metadata.Labels,
		},
		Spec: e.Spec,
	}

	// Omit "default" namespace from YAML for cleaner files.
	if ye.Metadata.Namespace == entity.DefaultNamespace {
		ye.Metadata.Namespace = ""
	}

	var buf bytes.Buffer
	enc := yaml.NewEncoder(&buf)
	enc.SetIndent(2)
	if err := enc.Encode(ye); err != nil {
		return nil, fmt.Errorf("marshaling entity to YAML: %w", err)
	}
	enc.Close()
	return buf.Bytes(), nil
}

// DeserializeEntity parses YAML data into an entity.
func DeserializeEntity(data []byte) (*entity.Entity, error) {
	var ye yamlEntity
	if err := yaml.Unmarshal(data, &ye); err != nil {
		return nil, fmt.Errorf("unmarshaling entity YAML: %w", err)
	}

	if ye.Kind == "" || ye.Metadata.Name == "" {
		return nil, fmt.Errorf("entity YAML missing required fields (kind, metadata.name)")
	}

	e := &entity.Entity{
		Kind:       ye.Kind,
		APIVersion: ye.APIVersion,
		Metadata: entity.EntityMetadata{
			Name:        ye.Metadata.Name,
			Namespace:   ye.Metadata.Namespace,
			Title:       ye.Metadata.Title,
			Description: ye.Metadata.Description,
			Owner:       ye.Metadata.Owner,
			Tags:        ye.Metadata.Tags,
			Annotations: ye.Metadata.Annotations,
			Labels:      ye.Metadata.Labels,
		},
		Spec: ye.Spec,
	}
	e.SetDefaults()
	if err := e.Validate(); err != nil {
		return nil, err
	}
	return e, nil
}

// EntityFilePath returns the relative path for an entity's YAML file
// within the Git repo: <basePath>/<Kind>/<namespace>/<name>.yaml
func EntityFilePath(basePath, kind, namespace, name string) string {
	if namespace == "" {
		namespace = entity.DefaultNamespace
	}
	parts := []string{}
	if basePath != "" {
		parts = append(parts, basePath)
	}
	parts = append(parts, kind, namespace, name+".yaml")
	return filepath.Join(parts...)
}

// ParseEntityPath extracts kind, namespace, and name from a file path
// relative to the base path. Returns empty strings if the path doesn't match.
func ParseEntityPath(basePath, filePath string) (kind, namespace, name string) {
	rel := filePath
	if basePath != "" {
		var ok bool
		rel, ok = strings.CutPrefix(filePath, basePath+"/")
		if !ok {
			return "", "", ""
		}
	}

	// Expect: <Kind>/<namespace>/<name>.yaml
	parts := strings.Split(filepath.ToSlash(rel), "/")
	if len(parts) != 3 {
		return "", "", ""
	}

	if !strings.HasSuffix(parts[2], ".yaml") {
		return "", "", ""
	}

	kind = parts[0]
	namespace = parts[1]
	name = strings.TrimSuffix(parts[2], ".yaml")
	return kind, namespace, name
}
