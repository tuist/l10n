package config

import (
	"errors"
	"fmt"
	"strings"
)

const (
	FrontmatterPreserve  = "preserve"
	FrontmatterTranslate = "translate"
)

var OutputPlaceholders = []string{"{lang}", "{relpath}", "{basename}", "{ext}"}

func ValidateTranslateEntry(entry TranslateEntry) error {
	if strings.TrimSpace(entry.SourcePath()) == "" {
		return errors.New("translate entry requires source/path")
	}
	if len(entry.Targets) == 0 {
		return fmt.Errorf("translate entry %q has no targets", entry.SourcePath())
	}
	if strings.TrimSpace(entry.Output) == "" {
		return fmt.Errorf("translate entry %q has no output", entry.SourcePath())
	}
	if entry.Frontmatter != "" && entry.Frontmatter != FrontmatterPreserve && entry.Frontmatter != FrontmatterTranslate {
		return fmt.Errorf("translate entry %q has invalid frontmatter mode %q", entry.SourcePath(), entry.Frontmatter)
	}
	return nil
}
