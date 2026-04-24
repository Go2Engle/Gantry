package entity

import "testing"

func TestEntityValidateRejectsDisplayNameAsMetadataName(t *testing.T) {
	tests := []struct {
		name       string
		entityName string
	}{
		{name: "spaces", entityName: "Future State"},
		{name: "parentheses", entityName: "future-state-(draft)"},
		{name: "uppercase", entityName: "Future-state"},
		{name: "leading hyphen", entityName: "-future-state"},
		{name: "trailing dot", entityName: "future-state."},
		{name: "underscore", entityName: "future_state"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := &Entity{
				Kind: "Flow",
				Metadata: EntityMetadata{
					Name: tt.entityName,
				},
			}

			if err := e.Validate(); err == nil {
				t.Fatalf("Validate() error = nil, want invalid metadata.name")
			}
		})
	}
}

func TestEntityValidateAllowsURLSafeMetadataName(t *testing.T) {
	tests := []string{
		"future-state-draft",
		"payment-api-v2",
		"service.tenant-a",
		"a1",
	}

	for _, name := range tests {
		t.Run(name, func(t *testing.T) {
			e := &Entity{
				Kind: "Service",
				Metadata: EntityMetadata{
					Name: name,
				},
			}

			if err := e.Validate(); err != nil {
				t.Fatalf("Validate() error = %v", err)
			}
		})
	}
}

func TestSchemaValidatorAllowsHealthCheckURLForAPIAndInfrastructure(t *testing.T) {
	validator, err := NewSchemaValidator("")
	if err != nil {
		t.Fatalf("NewSchemaValidator() error = %v", err)
	}

	tests := []struct {
		name string
		kind string
	}{
		{name: "api", kind: "API"},
		{name: "infrastructure", kind: "Infrastructure"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := &Entity{
				Kind: tt.kind,
				Metadata: EntityMetadata{
					Name: "payments-health",
				},
				Spec: map[string]any{
					"healthCheckUrl": "https://example.com/healthz",
				},
			}

			if err := validator.Validate(e); err != nil {
				t.Fatalf("Validate() error = %v", err)
			}
		})
	}
}
