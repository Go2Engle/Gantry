package gitops

import (
	nethttp "net/http"
	"sync"

	gitclient "github.com/go-git/go-git/v5/plumbing/transport/client"
	githttp "github.com/go-git/go-git/v5/plumbing/transport/http"
)

var installRedirectTransportOnce sync.Once

// installRedirectFollowingHTTPTransport keeps go-git's HTTP redirect handling
// compatible with Gantry's existing GitOps remote configurations.
func installRedirectFollowingHTTPTransport() {
	installRedirectTransportOnce.Do(func() {
		transport := githttp.NewClientWithOptions(&nethttp.Client{
			Transport: nethttp.DefaultTransport,
		}, &githttp.ClientOptions{
			RedirectPolicy: githttp.FollowRedirects,
		})

		gitclient.InstallProtocol("http", transport)
		gitclient.InstallProtocol("https", transport)
	})
}
