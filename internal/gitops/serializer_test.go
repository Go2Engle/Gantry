package gitops

import "testing"

func TestDeserializeEntityRejectsInvalidMetadataName(t *testing.T) {
	data := []byte(`
kind: Flow
apiVersion: gantry.io/v1
metadata:
  name: Future State (Draft)
spec: {}
`)

	if _, err := DeserializeEntity(data); err == nil {
		t.Fatalf("DeserializeEntity() error = nil, want invalid metadata.name")
	}
}
