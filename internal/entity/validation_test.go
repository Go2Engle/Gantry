package entity

import "testing"

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
