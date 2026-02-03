package locks

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWriteReadLock(t *testing.T) {
	root := t.TempDir()
	lock := LockFile{
		SourcePath:  "docs/guide.md",
		SourceHash:  "source-hash",
		ContextHash: "context-hash",
		Outputs: map[string]OutputLock{
			"es": {
				Path:        "out/es/guide.md",
				Hash:        "out-hash",
				ContextHash: "context-es",
				CheckedAt:   "2026-02-03T00:00:00Z",
			},
		},
	}

	if err := Write(root, lock.SourcePath, lock); err != nil {
		t.Fatalf("write lock: %v", err)
	}

	path := LockPath(root, lock.SourcePath)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("lock file not written: %v", err)
	}

	read, err := Read(root, lock.SourcePath)
	if err != nil {
		t.Fatalf("read lock: %v", err)
	}
	if read == nil {
		t.Fatalf("expected lock to be read")
	}
	if read.SourceHash != lock.SourceHash {
		t.Fatalf("expected source hash %q, got %q", lock.SourceHash, read.SourceHash)
	}
	if read.ContextHash != lock.ContextHash {
		t.Fatalf("expected context hash %q, got %q", lock.ContextHash, read.ContextHash)
	}
	if read.Outputs["es"].Path != lock.Outputs["es"].Path {
		t.Fatalf("expected output path %q, got %q", lock.Outputs["es"].Path, read.Outputs["es"].Path)
	}
	if read.Outputs["es"].ContextHash != lock.Outputs["es"].ContextHash {
		t.Fatalf("expected output context hash %q, got %q", lock.Outputs["es"].ContextHash, read.Outputs["es"].ContextHash)
	}
	if filepath.Dir(path) == "" {
		t.Fatalf("expected lock path to include directories")
	}
}
