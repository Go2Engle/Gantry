package gitops

import (
	"context"
	"fmt"
	nethttp "net/http"
	"net/url"
	"strings"
)

const (
	receivePackService = "git-receive-pack"
	uploadPackService  = "git-upload-pack"
)

func (s *Service) uploadPackRepoURL(ctx context.Context) (string, error) {
	return resolveSmartHTTPRepoURL(ctx, s.config.RepoURL, s.config.AuthToken, uploadPackService)
}

func (s *Service) receivePackRepoURL(ctx context.Context) (string, error) {
	return resolveSmartHTTPRepoURL(ctx, s.config.RepoURL, s.config.AuthToken, receivePackService)
}

// resolveSmartHTTPRepoURL discovers the final repository URL after any smart-HTTP
// redirects. This keeps auth working when a configured repo URL points at a
// vanity hostname or proxy that redirects to the actual Git host.
func resolveSmartHTTPRepoURL(ctx context.Context, repoURL, authToken, service string) (string, error) {
	parsed, err := url.Parse(repoURL)
	if err != nil {
		return "", fmt.Errorf("parsing repo URL: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return repoURL, nil
	}

	infoRefsURL, err := smartHTTPInfoRefsURL(repoURL, service)
	if err != nil {
		return "", err
	}

	req, err := nethttp.NewRequestWithContext(ctx, nethttp.MethodGet, infoRefsURL, nil)
	if err != nil {
		return "", fmt.Errorf("creating redirect discovery request: %w", err)
	}
	req.Header.Set("User-Agent", "Gantry GitOps")
	if authToken != "" {
		req.SetBasicAuth("gantry", authToken)
	}

	client := &nethttp.Client{
		CheckRedirect: func(req *nethttp.Request, via []*nethttp.Request) error {
			if len(via) == 0 {
				return nil
			}

			prev := via[len(via)-1]
			if auth := prev.Header.Get("Authorization"); auth != "" {
				req.Header.Set("Authorization", auth)
			}
			if agent := prev.Header.Get("User-Agent"); agent != "" {
				req.Header.Set("User-Agent", agent)
			}
			return nil
		},
	}

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("resolving repo URL redirects: %w", err)
	}
	defer resp.Body.Close()

	if resp.Request == nil || resp.Request.URL == nil {
		return repoURL, nil
	}
	if !strings.HasSuffix(resp.Request.URL.Path, "/info/refs") {
		return "", fmt.Errorf("unexpected redirect target path %q", resp.Request.URL.Path)
	}

	finalURL := *resp.Request.URL
	finalURL.RawQuery = ""
	finalURL.Fragment = ""
	finalURL.Path = strings.TrimSuffix(finalURL.Path, "/info/refs")

	return finalURL.String(), nil
}

func smartHTTPInfoRefsURL(repoURL, service string) (string, error) {
	parsed, err := url.Parse(repoURL)
	if err != nil {
		return "", fmt.Errorf("parsing repo URL: %w", err)
	}

	parsed.Path = strings.TrimSuffix(parsed.Path, "/") + "/info/refs"
	query := parsed.Query()
	query.Set("service", service)
	parsed.RawQuery = query.Encode()

	return parsed.String(), nil
}
