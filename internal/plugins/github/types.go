// Package github provides GitHub integration for Gantry: repository info,
// org sync, and optional GitHub OAuth SSO.
package github

// Repository represents a GitHub repository from the REST API.
type Repository struct {
	ID              int64    `json:"id"`
	Name            string   `json:"name"`
	FullName        string   `json:"full_name"`
	Description     string   `json:"description"`
	Private         bool     `json:"private"`
	HTMLURL         string   `json:"html_url"`
	Language        string   `json:"language"`
	DefaultBranch   string   `json:"default_branch"`
	StargazersCount int      `json:"stargazers_count"`
	ForksCount      int      `json:"forks_count"`
	OpenIssuesCount int      `json:"open_issues_count"`
	Topics          []string `json:"topics"`
	PushedAt        string   `json:"pushed_at"`
	CreatedAt       string   `json:"created_at"`
	UpdatedAt       string   `json:"updated_at"`
	Archived        bool     `json:"archived"`
	Visibility      string   `json:"visibility"`
}

// Commit represents a single GitHub commit summary.
type Commit struct {
	SHA     string        `json:"sha"`
	Commit  CommitDetails `json:"commit"`
	HTMLURL string        `json:"html_url"`
}

// CommitDetails holds the inner commit data.
type CommitDetails struct {
	Message string       `json:"message"`
	Author  CommitAuthor `json:"author"`
}

// CommitAuthor holds commit author info.
type CommitAuthor struct {
	Name  string `json:"name"`
	Email string `json:"email"`
	Date  string `json:"date"`
}

// PullRequest represents a GitHub pull request summary.
type PullRequest struct {
	Number  int    `json:"number"`
	Title   string `json:"title"`
	State   string `json:"state"`
	Draft   bool   `json:"draft"`
	HTMLURL string `json:"html_url"`
	User    struct {
		Login string `json:"login"`
	} `json:"user"`
	CreatedAt string `json:"created_at"`
	Labels    []struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	} `json:"labels"`
}

// GitHubUser represents a GitHub user returned by the /user endpoint.
type GitHubUser struct {
	ID        int    `json:"id"`
	Login     string `json:"login"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	AvatarURL string `json:"avatar_url"`
}

// Release represents a GitHub release summary.
type Release struct {
	TagName     string `json:"tag_name"`
	Name        string `json:"name"`
	HTMLURL     string `json:"html_url"`
	Prerelease  bool   `json:"prerelease"`
	Draft       bool   `json:"draft"`
	PublishedAt string `json:"published_at"`
}

// RepoInfo is the enriched repository response returned by the Gantry GitHub plugin API.
type RepoInfo struct {
	Repo          *Repository   `json:"repo"`
	Commits       []Commit      `json:"commits"`
	PullRequests  []PullRequest `json:"pullRequests"`
	Readme        string        `json:"readme,omitempty"`
	LatestRelease *Release      `json:"latestRelease,omitempty"`
}

// WikiPage represents a single page discovered in a GitHub wiki repository.
type WikiPage struct {
	Title string `json:"title"`
	Slug  string `json:"slug"`
	Path  string `json:"path"`
}

// WikiPageContent is the rendered-source payload for a wiki page.
type WikiPageContent struct {
	Title      string `json:"title"`
	Slug       string `json:"slug"`
	Path       string `json:"path"`
	Markdown   string `json:"markdown"`
	HTMLURL    string `json:"htmlUrl"`
	RawBaseURL string `json:"rawBaseUrl,omitempty"`
}

// WikiInfo describes a repository wiki and optionally includes page content.
type WikiInfo struct {
	Available   bool             `json:"available"`
	HTMLURL     string           `json:"htmlUrl"`
	Pages       []WikiPage       `json:"pages"`
	CurrentPage *WikiPageContent `json:"currentPage,omitempty"`
}

// GitHubTeam represents a GitHub organization team.
type GitHubTeam struct {
	ID           int    `json:"id"`
	Name         string `json:"name"`
	Slug         string `json:"slug"`
	Description  string `json:"description"`
	Organization struct {
		Login string `json:"login"`
	} `json:"organization"`
}

// SyncResult summarizes what happened during a GitHub entity enrichment sync.
type SyncResult struct {
	Scanned  int      `json:"scanned"`
	Enriched int      `json:"enriched"`
	Errors   []string `json:"errors,omitempty"`
}
