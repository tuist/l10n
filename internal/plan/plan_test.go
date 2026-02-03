package plan

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPlanPrefersDeeperConfig(t *testing.T) {
	root := t.TempDir()
	rootConfig := `+++
[[translate]]
source = "docs/*.md"
targets = ["es"]
output = "out/{lang}/{relpath}"
+++
Root context
`
	if err := os.WriteFile(filepath.Join(root, "L10N.md"), []byte(rootConfig), 0o644); err != nil {
		t.Fatalf("write root L10N.md: %v", err)
	}

	docsDir := filepath.Join(root, "docs")
	if err := os.MkdirAll(docsDir, 0o755); err != nil {
		t.Fatalf("mkdir docs: %v", err)
	}

	nestedConfig := `+++
[[translate]]
source = "guide.md"
targets = ["es"]
output = "out/deeper/{lang}/{relpath}"
+++
Nested context
`
	if err := os.WriteFile(filepath.Join(docsDir, "L10N.md"), []byte(nestedConfig), 0o644); err != nil {
		t.Fatalf("write nested L10N.md: %v", err)
	}

	sourcePath := filepath.Join(docsDir, "guide.md")
	if err := os.WriteFile(sourcePath, []byte("Hello"), 0o644); err != nil {
		t.Fatalf("write source: %v", err)
	}

	pl, err := Build(root)
	if err != nil {
		t.Fatalf("build plan: %v", err)
	}
	if len(pl.Sources) != 1 {
		t.Fatalf("expected 1 source, got %d", len(pl.Sources))
	}
	got := pl.Sources[0].Outputs[0].OutputPath
	if got != filepath.FromSlash("out/deeper/es/guide.md") {
		t.Fatalf("expected deeper output, got %q", got)
	}
	if len(pl.Sources[0].ContextBodies) != 2 {
		t.Fatalf("expected 2 context bodies, got %d", len(pl.Sources[0].ContextBodies))
	}
}

func TestPlanLastEntryWinsAtSameDepth(t *testing.T) {
	root := t.TempDir()
	config := `+++
[[translate]]
source = "docs/guide.md"
targets = ["es"]
output = "out/first/{lang}/{relpath}"

[[translate]]
source = "docs/guide.md"
targets = ["es"]
output = "out/second/{lang}/{relpath}"
+++
Root context
`
	if err := os.WriteFile(filepath.Join(root, "L10N.md"), []byte(config), 0o644); err != nil {
		t.Fatalf("write L10N.md: %v", err)
	}

	docsDir := filepath.Join(root, "docs")
	if err := os.MkdirAll(docsDir, 0o755); err != nil {
		t.Fatalf("mkdir docs: %v", err)
	}
	sourcePath := filepath.Join(docsDir, "guide.md")
	if err := os.WriteFile(sourcePath, []byte("Hello"), 0o644); err != nil {
		t.Fatalf("write source: %v", err)
	}

	pl, err := Build(root)
	if err != nil {
		t.Fatalf("build plan: %v", err)
	}
	got := pl.Sources[0].Outputs[0].OutputPath
	if got != filepath.FromSlash("out/second/es/guide.md") {
		t.Fatalf("expected last entry output, got %q", got)
	}
}

func TestPlanLanguageContextIsAdditive(t *testing.T) {
	root := t.TempDir()
	rootConfig := `+++
[[translate]]
source = "docs/guide.md"
targets = ["es", "de"]
output = "out/{lang}/{relpath}"
+++
Root context
`
	if err := os.WriteFile(filepath.Join(root, "L10N.md"), []byte(rootConfig), 0o644); err != nil {
		t.Fatalf("write root L10N.md: %v", err)
	}
	langDir := filepath.Join(root, "L10N")
	if err := os.MkdirAll(langDir, 0o755); err != nil {
		t.Fatalf("mkdir L10N: %v", err)
	}
	if err := os.WriteFile(filepath.Join(langDir, "es.md"), []byte("Contexto español"), 0o644); err != nil {
		t.Fatalf("write es context: %v", err)
	}

	docsDir := filepath.Join(root, "docs")
	if err := os.MkdirAll(docsDir, 0o755); err != nil {
		t.Fatalf("mkdir docs: %v", err)
	}
	sourcePath := filepath.Join(docsDir, "guide.md")
	if err := os.WriteFile(sourcePath, []byte("Hello"), 0o644); err != nil {
		t.Fatalf("write source: %v", err)
	}

	pl, err := Build(root)
	if err != nil {
		t.Fatalf("build plan: %v", err)
	}
	if len(pl.Sources) != 1 {
		t.Fatalf("expected 1 source, got %d", len(pl.Sources))
	}
	source := pl.Sources[0]
	esParts := source.ContextPartsFor("es")
	if len(esParts) != 2 {
		t.Fatalf("expected 2 context parts for es, got %d", len(esParts))
	}
	if strings.TrimSpace(esParts[0]) != "Root context" || strings.TrimSpace(esParts[1]) != "Contexto español" {
		t.Fatalf("unexpected es context parts: %#v", esParts)
	}
	deParts := source.ContextPartsFor("de")
	if len(deParts) != 1 || strings.TrimSpace(deParts[0]) != "Root context" {
		t.Fatalf("unexpected de context parts: %#v", deParts)
	}
}
