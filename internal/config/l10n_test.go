package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "L10N.md")
	contents := `+++
[[translate]]
path = "docs/*.md"
targets = ["es"]
output = "out/{lang}/{relpath}"
+++
Root context line 1
Root context line 2
`
	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		t.Fatalf("write L10N.md: %v", err)
	}

	parsed, err := ParseFile(path)
	if err != nil {
		t.Fatalf("parse file: %v", err)
	}
	if len(parsed.Config.Translate) != 1 {
		t.Fatalf("expected 1 translate entry, got %d", len(parsed.Config.Translate))
	}
	entry := parsed.Config.Translate[0]
	if entry.Source != "docs/*.md" {
		t.Fatalf("expected source to normalize path, got %q", entry.Source)
	}
	if entry.Frontmatter != "preserve" {
		t.Fatalf("expected frontmatter default preserve, got %q", entry.Frontmatter)
	}
	if parsed.Body == "" {
		t.Fatalf("expected body to be parsed")
	}
}
