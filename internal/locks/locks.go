package locks

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

type LockFile struct {
	SourcePath  string                `json:"source_path"`
	SourceHash  string                `json:"source_hash"`
	ContextHash string                `json:"context_hash,omitempty"`
	Outputs     map[string]OutputLock `json:"outputs"`
	UpdatedAt   string                `json:"updated_at"`
}

type OutputLock struct {
	Path        string `json:"path"`
	Hash        string `json:"hash"`
	ContextHash string `json:"context_hash,omitempty"`
	CheckedAt   string `json:"checked_at"`
}

func LockPath(root, sourcePath string) string {
	return filepath.Join(root, ".l10n", "locks", sourcePath+".lock")
}

func Read(root, sourcePath string) (*LockFile, error) {
	path := LockPath(root, sourcePath)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var lock LockFile
	if err := json.Unmarshal(data, &lock); err != nil {
		return nil, err
	}
	return &lock, nil
}

func Write(root, sourcePath string, lock LockFile) error {
	lock.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	path := LockPath(root, sourcePath)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(lock, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}
