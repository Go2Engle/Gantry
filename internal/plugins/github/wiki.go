package github

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	gogit "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing/transport"
	githttp "github.com/go-git/go-git/v5/plumbing/transport/http"
)

const (
	wikiFetchTTL         = 5 * time.Minute
	maxWikiMarkdownBytes = 2 * 1024 * 1024
)

var repoWikiLocks sync.Map

// GetWiki fetches metadata and optionally Markdown content from a repository's
// GitHub wiki. GitHub stores each wiki as a sibling Git repository, not as a
// normal REST API resource.
func (c *Client) GetWiki(ctx context.Context, owner, repo, dataDir, pageSlug string, includeContent bool) (*WikiInfo, error) {
	htmlURL := fmt.Sprintf("https://github.com/%s/%s/wiki", owner, repo)
	repoPath, available, err := c.ensureWikiClone(ctx, owner, repo, dataDir)
	if err != nil {
		if isMissingWikiError(err) {
			return &WikiInfo{Available: false, HTMLURL: htmlURL, Pages: []WikiPage{}}, nil
		}
		return nil, err
	}
	if !available {
		return &WikiInfo{Available: false, HTMLURL: htmlURL, Pages: []WikiPage{}}, nil
	}

	pages, err := listWikiPages(repoPath)
	if err != nil {
		return nil, err
	}
	if len(pages) == 0 {
		return &WikiInfo{Available: false, HTMLURL: htmlURL, Pages: []WikiPage{}}, nil
	}

	info := &WikiInfo{
		Available: true,
		HTMLURL:   htmlURL,
		Pages:     pages,
	}
	if !includeContent {
		return info, nil
	}

	page := selectWikiPage(pages, pageSlug)
	content, err := readWikiPage(repoPath, owner, repo, page)
	if err != nil {
		return nil, err
	}
	info.CurrentPage = content
	return info, nil
}

func (c *Client) ensureWikiClone(ctx context.Context, owner, repo, dataDir string) (string, bool, error) {
	repoLock := getRepoWikiLock(owner + "/" + repo)
	repoLock.Lock()
	defer repoLock.Unlock()

	repoPath := filepath.Join(dataDir, "github-wikis", safeWikiPathSegment(owner), safeWikiPathSegment(repo))
	markerPath := filepath.Join(repoPath, ".gantry-wiki-fetched")

	if _, err := os.Stat(filepath.Join(repoPath, ".git")); err == nil {
		if freshMarker(markerPath, wikiFetchTTL) {
			return repoPath, true, nil
		}

		gitRepo, err := gogit.PlainOpen(repoPath)
		if err != nil {
			return "", false, fmt.Errorf("open cached wiki repo: %w", err)
		}
		worktree, err := gitRepo.Worktree()
		if err != nil {
			return "", false, fmt.Errorf("open cached wiki worktree: %w", err)
		}
		err = worktree.PullContext(ctx, &gogit.PullOptions{
			RemoteName: "origin",
			Auth:       c.gitAuth(),
			Force:      true,
		})
		if err != nil && !errors.Is(err, gogit.NoErrAlreadyUpToDate) {
			return "", false, fmt.Errorf("pull wiki repo: %w", err)
		}
		touchWikiMarker(markerPath)
		return repoPath, true, nil
	}

	if err := os.MkdirAll(filepath.Dir(repoPath), 0o755); err != nil {
		return "", false, fmt.Errorf("create wiki cache dir: %w", err)
	}

	cloneURL := fmt.Sprintf("https://github.com/%s/%s.wiki.git", owner, repo)
	_, err := gogit.PlainCloneContext(ctx, repoPath, false, &gogit.CloneOptions{
		URL:  cloneURL,
		Auth: c.gitAuth(),
	})
	if err != nil {
		_ = os.RemoveAll(repoPath)
		if errors.Is(err, transport.ErrEmptyRemoteRepository) || isMissingWikiError(err) {
			return "", false, nil
		}
		return "", false, fmt.Errorf("clone wiki repo: %w", err)
	}

	touchWikiMarker(markerPath)
	return repoPath, true, nil
}

func (c *Client) gitAuth() *githttp.BasicAuth {
	if c.token == "" {
		return nil
	}
	return &githttp.BasicAuth{
		Username: "gantry",
		Password: c.token,
	}
}

func getRepoWikiLock(repoKey string) *sync.Mutex {
	lock, _ := repoWikiLocks.LoadOrStore(strings.ToLower(repoKey), &sync.Mutex{})
	return lock.(*sync.Mutex)
}

func listWikiPages(repoPath string) ([]WikiPage, error) {
	var pages []WikiPage
	err := filepath.WalkDir(repoPath, func(filePath string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if d.Name() == ".git" {
				return filepath.SkipDir
			}
			return nil
		}
		if !isWikiMarkdownPath(filePath) {
			return nil
		}

		rel, err := filepath.Rel(repoPath, filePath)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		slug := strings.TrimSuffix(rel, path.Ext(rel))
		pages = append(pages, WikiPage{
			Title: wikiTitleFromSlug(slug),
			Slug:  slug,
			Path:  rel,
		})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("list wiki pages: %w", err)
	}

	sort.Slice(pages, func(i, j int) bool {
		if strings.EqualFold(pages[i].Slug, "Home") {
			return true
		}
		if strings.EqualFold(pages[j].Slug, "Home") {
			return false
		}
		return strings.ToLower(pages[i].Title) < strings.ToLower(pages[j].Title)
	})
	return pages, nil
}

func selectWikiPage(pages []WikiPage, requested string) WikiPage {
	normalized := normalizeWikiSlug(requested)
	if normalized != "" {
		for _, page := range pages {
			if strings.EqualFold(page.Slug, normalized) || strings.EqualFold(page.Title, normalized) {
				return page
			}
		}
	}
	for _, page := range pages {
		if strings.EqualFold(page.Slug, "Home") {
			return page
		}
	}
	return pages[0]
}

func readWikiPage(repoPath, owner, repo string, page WikiPage) (*WikiPageContent, error) {
	filePath := filepath.Join(repoPath, filepath.FromSlash(page.Path))
	cleanRepoPath, err := filepath.Abs(repoPath)
	if err != nil {
		return nil, err
	}
	cleanFilePath, err := filepath.Abs(filePath)
	if err != nil {
		return nil, err
	}
	if cleanFilePath != cleanRepoPath && !strings.HasPrefix(cleanFilePath, cleanRepoPath+string(filepath.Separator)) {
		return nil, fmt.Errorf("invalid wiki page path")
	}

	info, err := os.Stat(cleanFilePath)
	if err != nil {
		return nil, fmt.Errorf("stat wiki page: %w", err)
	}
	if info.Size() > maxWikiMarkdownBytes {
		return nil, fmt.Errorf("wiki page is too large to render")
	}

	body, err := os.ReadFile(cleanFilePath)
	if err != nil {
		return nil, fmt.Errorf("read wiki page: %w", err)
	}

	pageDir := path.Dir(page.Path)
	rawBaseURL := fmt.Sprintf("https://raw.githubusercontent.com/wiki/%s/%s/", owner, repo)
	if pageDir != "." {
		rawBaseURL += strings.TrimSuffix(pageDir, "/") + "/"
	}

	return &WikiPageContent{
		Title:      page.Title,
		Slug:       page.Slug,
		Path:       page.Path,
		Markdown:   string(body),
		HTMLURL:    wikiPageHTMLURL(owner, repo, page.Slug),
		RawBaseURL: rawBaseURL,
	}, nil
}

func wikiPageHTMLURL(owner, repo, slug string) string {
	parts := strings.Split(slug, "/")
	for i, part := range parts {
		parts[i] = pathEscape(part)
	}
	return fmt.Sprintf("https://github.com/%s/%s/wiki/%s", owner, repo, strings.Join(parts, "/"))
}

func pathEscape(segment string) string {
	return url.PathEscape(segment)
}

func isWikiMarkdownPath(filePath string) bool {
	switch strings.ToLower(path.Ext(filepath.ToSlash(filePath))) {
	case ".md", ".markdown":
		return true
	default:
		return false
	}
}

func wikiTitleFromSlug(slug string) string {
	base := path.Base(slug)
	base = strings.ReplaceAll(base, "-", " ")
	base = strings.ReplaceAll(base, "_", " ")
	return strings.TrimSpace(base)
}

func normalizeWikiSlug(slug string) string {
	slug = strings.TrimSpace(slug)
	slug = strings.TrimSuffix(slug, ".md")
	slug = strings.TrimSuffix(slug, ".markdown")
	slug = strings.Trim(slug, "/")
	if slug == "" {
		return ""
	}
	cleaned := path.Clean(strings.ReplaceAll(slug, "\\", "/"))
	if cleaned == "." || strings.HasPrefix(cleaned, "../") || cleaned == ".." {
		return ""
	}
	return cleaned
}

func safeWikiPathSegment(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	if b.Len() == 0 {
		return "_"
	}
	return b.String()
}

func freshMarker(path string, ttl time.Duration) bool {
	info, err := os.Stat(path)
	return err == nil && time.Since(info.ModTime()) < ttl
}

func touchWikiMarker(path string) {
	now := time.Now()
	if _, err := os.Stat(path); err == nil {
		_ = os.Chtimes(path, now, now)
		return
	}
	_ = os.WriteFile(path, []byte(now.Format(time.RFC3339)), 0o644)
}

func isMissingWikiError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	isAuthError := strings.Contains(msg, "authentication required") ||
		strings.Contains(msg, "authorization failed")
	if isAuthError {
		log.Printf("github wiki: treating authentication error as unavailable: %s", redactWikiError(err.Error()))
	}
	return strings.Contains(msg, "repository not found") ||
		strings.Contains(msg, "not found") ||
		isAuthError
}

func redactWikiError(message string) string {
	message = redactURLCredentials(message)
	message = redactBearerToken(message)
	return message
}

func redactURLCredentials(message string) string {
	parts := strings.Fields(message)
	for i, part := range parts {
		u, err := url.Parse(strings.Trim(part, `"'`))
		if err != nil || u.User == nil {
			continue
		}
		u.User = url.User("redacted")
		parts[i] = strings.Replace(part, strings.Trim(part, `"'`), u.String(), 1)
	}
	return strings.Join(parts, " ")
}

func redactBearerToken(message string) string {
	fields := strings.Fields(message)
	for i := 0; i < len(fields)-1; i++ {
		if strings.EqualFold(strings.TrimSuffix(fields[i], ":"), "bearer") {
			fields[i+1] = "redacted"
		}
	}
	return strings.Join(fields, " ")
}
