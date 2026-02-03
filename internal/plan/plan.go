package plan

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/bmatcuk/doublestar/v4"

	"github.com/tuist/l10n/internal/config"
)

type Plan struct {
	Root      string
	L10NFiles []config.L10NFile
	Sources   []SourcePlan
}

type SourcePlan struct {
	SourcePath        string
	AbsPath           string
	BasePath          string
	RelPath           string
	Format            Format
	Entry             config.Entry
	ContextBodies     []string
	LangContextBodies map[string][]string
	ContextPaths      []string
	LLM               LLMPlan
	Outputs           []OutputPlan
}

type LLMPlan struct {
	Coordinator config.AgentConfig
	Translator  config.AgentConfig
}

type OutputPlan struct {
	Lang       string
	OutputPath string
}

func (s SourcePlan) ContextPartsFor(lang string) []string {
	parts := make([]string, 0, len(s.ContextBodies))
	parts = append(parts, s.ContextBodies...)
	if s.LangContextBodies == nil {
		return parts
	}
	if langParts, ok := s.LangContextBodies[lang]; ok {
		parts = append(parts, langParts...)
	}
	return parts
}

func (s SourcePlan) ContextStringFor(lang string) string {
	return strings.Join(s.ContextPartsFor(lang), "\n\n")
}

func Build(root string) (Plan, error) {
	l10nFiles, err := discoverL10N(root)
	if err != nil {
		return Plan{}, err
	}

	entries, err := collectEntries(root, l10nFiles)
	if err != nil {
		return Plan{}, err
	}

	candidates, err := resolveEntries(root, entries)
	if err != nil {
		return Plan{}, err
	}

	var sources []SourcePlan
	for sourcePath, cand := range candidates {
		absPath := filepath.Join(root, sourcePath)
		contextFiles := ancestorsFor(absPath, l10nFiles)
		contextBodies := make([]string, 0, len(contextFiles))
		contextPaths := make([]string, 0, len(contextFiles))
		langContextBodies := map[string][]string{}
		llm := config.LLMConfig{}
		for _, l10n := range contextFiles {
			if strings.TrimSpace(l10n.Body) != "" {
				contextBodies = append(contextBodies, l10n.Body)
				contextPaths = append(contextPaths, l10n.Path)
			}
			for _, lang := range cand.entry.Targets {
				body, ok, err := readLangContext(l10n.Dir, lang)
				if err != nil {
					return Plan{}, err
				}
				if ok && strings.TrimSpace(body) != "" {
					langContextBodies[lang] = append(langContextBodies[lang], body)
				}
			}
			llm = config.MergeLLM(llm, l10n.Config.LLM)
		}
		coordinator, translator, err := config.ResolveAgents(llm)
		if err != nil {
			return Plan{}, err
		}
		resolvedLLM := LLMPlan{
			Coordinator: coordinator,
			Translator:  translator,
		}

		relPath, err := filepath.Rel(cand.basePath, sourcePath)
		if err != nil {
			return Plan{}, fmt.Errorf("relpath for %s: %w", sourcePath, err)
		}

		outputs := make([]OutputPlan, 0, len(cand.entry.Targets))
		for _, lang := range cand.entry.Targets {
			out := ExpandOutput(cand.entry.Output, OutputValues{
				Lang:     lang,
				RelPath:  relPath,
				BaseName: strings.TrimSuffix(filepath.Base(sourcePath), filepath.Ext(sourcePath)),
				Ext:      strings.TrimPrefix(filepath.Ext(sourcePath), "."),
			})
			outputs = append(outputs, OutputPlan{Lang: lang, OutputPath: out})
		}

		sources = append(sources, SourcePlan{
			SourcePath:        sourcePath,
			AbsPath:           absPath,
			BasePath:          cand.basePath,
			RelPath:           relPath,
			Format:            DetectFormat(sourcePath),
			Entry:             cand.entry,
			ContextBodies:     contextBodies,
			LangContextBodies: langContextBodies,
			ContextPaths:      contextPaths,
			LLM:               resolvedLLM,
			Outputs:           outputs,
		})
	}

	sort.Slice(sources, func(i, j int) bool {
		return sources[i].SourcePath < sources[j].SourcePath
	})

	return Plan{Root: root, L10NFiles: l10nFiles, Sources: sources}, nil
}

type candidate struct {
	entry    config.Entry
	basePath string
}

func resolveEntries(root string, entries []config.Entry) (map[string]candidate, error) {
	candidates := map[string]candidate{}

	for _, entry := range entries {
		pattern, base, err := entryPattern(root, entry)
		if err != nil {
			return nil, err
		}
		matches, err := doublestar.Glob(os.DirFS(root), filepath.ToSlash(pattern))
		if err != nil {
			return nil, fmt.Errorf("glob %s: %w", pattern, err)
		}
		excludes, err := resolveExcludes(root, entry)
		if err != nil {
			return nil, err
		}

		for _, match := range matches {
			if excludes[match] {
				continue
			}
			if filepath.Base(match) == "L10N.md" {
				continue
			}
			full := filepath.Join(root, match)
			info, err := os.Stat(full)
			if err != nil {
				return nil, err
			}
			if info.IsDir() {
				continue
			}

			if existing, ok := candidates[match]; ok {
				if shouldOverride(existing.entry, entry) {
					candidates[match] = candidate{entry: entry, basePath: base}
				}
				continue
			}
			candidates[match] = candidate{entry: entry, basePath: base}
		}
	}

	return candidates, nil
}

func entryPattern(root string, entry config.Entry) (pattern string, base string, err error) {
	relDir, err := filepath.Rel(root, entry.OriginDir)
	if err != nil {
		return "", "", err
	}
	if relDir == "." {
		relDir = ""
	}
	source := entry.SourcePath()
	pattern = filepath.Clean(filepath.Join(relDir, source))
	base = globBase(pattern)
	if base == "." {
		base = relDir
	}
	base = filepath.Clean(base)
	return pattern, base, nil
}

func resolveExcludes(root string, entry config.Entry) (map[string]bool, error) {
	excludes := map[string]bool{}
	if len(entry.Exclude) == 0 {
		return excludes, nil
	}

	relDir, err := filepath.Rel(root, entry.OriginDir)
	if err != nil {
		return nil, err
	}
	if relDir == "." {
		relDir = ""
	}

	for _, ex := range entry.Exclude {
		pattern := filepath.Clean(filepath.Join(relDir, ex))
		matches, err := doublestar.Glob(os.DirFS(root), filepath.ToSlash(pattern))
		if err != nil {
			return nil, fmt.Errorf("exclude glob %s: %w", pattern, err)
		}
		for _, match := range matches {
			excludes[match] = true
		}
	}

	return excludes, nil
}

func shouldOverride(existing, candidate config.Entry) bool {
	if candidate.OriginDepth > existing.OriginDepth {
		return true
	}
	if candidate.OriginDepth == existing.OriginDepth && candidate.Index > existing.Index {
		return true
	}
	return false
}

func collectEntries(root string, l10nFiles []config.L10NFile) ([]config.Entry, error) {
	entries := []config.Entry{}
	for _, file := range l10nFiles {
		for idx, entry := range file.Config.Translate {
			if err := config.ValidateTranslateEntry(entry); err != nil {
				return nil, fmt.Errorf("%s: %w", file.Path, err)
			}
			entries = append(entries, config.Entry{
				TranslateEntry: entry,
				OriginPath:     file.Path,
				OriginDir:      file.Dir,
				OriginDepth:    file.Depth,
				Index:          idx,
			})
		}
	}
	return entries, nil
}

func discoverL10N(root string) ([]config.L10NFile, error) {
	var files []config.L10NFile
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if filepath.Base(path) != "L10N.md" {
			return nil
		}
		parsed, err := config.ParseFile(path)
		if err != nil {
			return err
		}
		files = append(files, parsed)
		return nil
	})
	if err != nil {
		return nil, err
	}

	for i := range files {
		relDir, err := filepath.Rel(root, files[i].Dir)
		if err != nil {
			return nil, err
		}
		if relDir == "." {
			files[i].Depth = 0
			continue
		}
		parts := strings.Split(relDir, string(filepath.Separator))
		files[i].Depth = len(parts)
	}

	sort.Slice(files, func(i, j int) bool {
		return files[i].Depth < files[j].Depth
	})

	return files, nil
}

func ancestorsFor(sourceAbs string, l10nFiles []config.L10NFile) []config.L10NFile {
	var ancestors []config.L10NFile
	for _, file := range l10nFiles {
		if isAncestor(file.Dir, sourceAbs) {
			ancestors = append(ancestors, file)
		}
	}
	sort.Slice(ancestors, func(i, j int) bool {
		return ancestors[i].Depth < ancestors[j].Depth
	})
	return ancestors
}

func isAncestor(dir, path string) bool {
	rel, err := filepath.Rel(dir, path)
	if err != nil {
		return false
	}
	return rel == "." || !strings.HasPrefix(rel, "..")
}

func globBase(pattern string) string {
	idx := strings.IndexAny(pattern, "*?[")
	if idx == -1 {
		return filepath.Dir(pattern)
	}
	prefix := pattern[:idx]
	return filepath.Dir(prefix)
}

func readLangContext(dir, lang string) (string, bool, error) {
	path, err := langContextPath(dir, lang)
	if err != nil {
		return "", false, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", false, nil
		}
		return "", false, err
	}
	_, body, hasFrontmatter, err := config.SplitTomlFrontmatter(string(data))
	if err != nil {
		return "", false, fmt.Errorf("parse %s: %w", path, err)
	}
	if hasFrontmatter {
		return body, true, nil
	}
	return string(data), true, nil
}

func langContextPath(dir, lang string) (string, error) {
	trimmed := strings.TrimSpace(lang)
	if trimmed == "" {
		return "", fmt.Errorf("empty language code")
	}
	if strings.ContainsAny(trimmed, "/\\") {
		return "", fmt.Errorf("invalid language code %q", lang)
	}
	return filepath.Join(dir, "L10N", trimmed+".md"), nil
}
