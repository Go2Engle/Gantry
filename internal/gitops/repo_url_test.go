package gitops

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestResolveSmartHTTPRepoURLFollowsRedirectAndPreservesAuth(t *testing.T) {
	const token = "secret-token"

	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got == "" {
			t.Fatal("expected auth header on redirected request")
		}
		if r.URL.Path != "/repo.git/info/refs" {
			t.Fatalf("unexpected redirected path: %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("service"); got != uploadPackService {
			t.Fatalf("unexpected service query: %s", got)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer target.Close()

	targetURL := target.URL + "/repo.git/info/refs?service=" + uploadPackService
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, targetURL, http.StatusFound)
	}))
	defer source.Close()

	repoURL, err := resolveSmartHTTPRepoURL(context.Background(), source.URL+"/repo.git", token, uploadPackService)
	if err != nil {
		t.Fatalf("resolveSmartHTTPRepoURL returned error: %v", err)
	}

	if want := target.URL + "/repo.git"; repoURL != want {
		t.Fatalf("resolved repo URL mismatch: got %q want %q", repoURL, want)
	}
}

func TestResolveSmartHTTPRepoURLLeavesSSHRemotesAlone(t *testing.T) {
	repoURL, err := resolveSmartHTTPRepoURL(context.Background(), "ssh://git@example.com/org/repo.git", "", uploadPackService)
	if err != nil {
		t.Fatalf("resolveSmartHTTPRepoURL returned error: %v", err)
	}

	if want := "ssh://git@example.com/org/repo.git"; repoURL != want {
		t.Fatalf("resolved repo URL mismatch: got %q want %q", repoURL, want)
	}
}
