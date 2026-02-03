package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/tuist/l10n/internal/agent"
	"github.com/tuist/l10n/internal/checks"
	ctxhash "github.com/tuist/l10n/internal/context"
	"github.com/tuist/l10n/internal/llm"
	"github.com/tuist/l10n/internal/locks"
	"github.com/tuist/l10n/internal/plan"
)

type TranslateOptions struct {
	Force    bool
	Yolo     bool
	Retries  int
	DryRun   bool
	CheckCmd string
	Reporter Reporter
}

type CheckOptions struct {
	CheckCmd string
	Reporter Reporter
}

type StatusOptions struct {
	Reporter Reporter
}

type CleanOptions struct {
	DryRun   bool
	Orphans  bool
	Reporter Reporter
}

func Translate(root string, opts TranslateOptions) error {
	pl, err := plan.Build(root)
	if err != nil {
		return err
	}
	if len(pl.Sources) == 0 {
		return errors.New("no sources found")
	}

	reporter := ensureReporter(opts.Reporter)

	client := llm.NewClient()
	checker := checks.Checker{Root: root}
	translator := agent.Agent{Client: client, Checker: checker}

	type translatePlan struct {
		source        plan.SourcePlan
		sourceBytes   []byte
		sourceHash    string
		lock          *locks.LockFile
		contextHashes map[string]string
		translate     map[string]bool
	}

	plans := []translatePlan{}
	total := 0

	for _, source := range pl.Sources {
		sourceBytes, err := os.ReadFile(source.AbsPath)
		if err != nil {
			return err
		}

		sourceHash := ctxhash.HashBytes(sourceBytes)
		lock, err := locks.Read(root, source.SourcePath)
		if err != nil {
			return err
		}

		if lock == nil {
			lock = &locks.LockFile{SourcePath: source.SourcePath, Outputs: map[string]locks.OutputLock{}}
		}

		contextHashes := map[string]string{}
		translate := map[string]bool{}

		for _, output := range source.Outputs {
			contextParts := source.ContextPartsFor(output.Lang)
			contextHash := ctxhash.HashStrings(contextParts)
			contextHashes[output.Lang] = contextHash
			outputAbs := filepath.Join(root, output.OutputPath)
			_, outputErr := os.Stat(outputAbs)
			missing := outputErr != nil
			if outputErr != nil && !os.IsNotExist(outputErr) {
				return outputErr
			}
			outputLock, hasOutputLock := lock.Outputs[output.Lang]
			lockedContextHash := lockContextHash(lock, output.Lang)
			upToDate := !missing &&
				hasOutputLock &&
				lock.SourceHash == sourceHash &&
				outputLock.Path == output.OutputPath &&
				lockedContextHash == contextHash
			if !opts.Force && upToDate {
				continue
			}
			translate[output.Lang] = true
			total++
		}

		plans = append(plans, translatePlan{
			source:        source,
			sourceBytes:   sourceBytes,
			sourceHash:    sourceHash,
			lock:          lock,
			contextHashes: contextHashes,
			translate:     translate,
		})
	}

	if total == 0 {
		reporter.Info("no translations needed")
		return nil
	}

	current := 0
	for _, planItem := range plans {
		updated := false
		for _, output := range planItem.source.Outputs {
			if !planItem.translate[output.Lang] {
				continue
			}
			label := fmt.Sprintf("%s -> %s (%s)", planItem.source.SourcePath, output.OutputPath, output.Lang)
			step := current + 1
			reporter.Activity("Translating", step, total, label)
			if opts.DryRun {
				reporter.Info("dry-run " + label)
				current = step
				continue
			}

			retries := opts.Retries
			if retries < 0 && planItem.source.Entry.Retries != nil {
				retries = *planItem.source.Entry.Retries
			}
			if retries < 0 {
				retries = 2
			}

			checkCmds := planItem.source.Entry.CheckCmds
			if strings.TrimSpace(opts.CheckCmd) != "" {
				checkCmds = nil
			}

			contextParts := planItem.source.ContextPartsFor(output.Lang)
			translation, err := translator.Translate(context.Background(), agent.TranslationRequest{
				Source:          string(planItem.sourceBytes),
				TargetLang:      output.Lang,
				Format:          planItem.source.Format,
				Context:         strings.Join(contextParts, "\n\n"),
				Preserve:        planItem.source.Entry.Preserve,
				Frontmatter:     planItem.source.Entry.Frontmatter,
				CheckCmd:        pickCheckCmd(opts.CheckCmd, planItem.source.Entry.CheckCmd),
				CheckCmds:       checkCmds,
				ToolReporter:    reporter,
				ProgressLabel:   label,
				ProgressCurrent: step,
				ProgressTotal:   total,
				Retries:         retries,
				Coordinator:     planItem.source.LLM.Coordinator,
				Translator:      planItem.source.LLM.Translator,
			})
			if err != nil {
				return fmt.Errorf("translate %s (%s): %w", planItem.source.SourcePath, output.Lang, err)
			}

			outputAbs := filepath.Join(root, output.OutputPath)
			if err := os.MkdirAll(filepath.Dir(outputAbs), 0o755); err != nil {
				return err
			}
			if err := os.WriteFile(outputAbs, []byte(translation), 0o644); err != nil {
				return err
			}

			planItem.lock.SourceHash = planItem.sourceHash
			if planItem.lock.Outputs == nil {
				planItem.lock.Outputs = map[string]locks.OutputLock{}
			}
			planItem.lock.Outputs[output.Lang] = locks.OutputLock{
				Path:        output.OutputPath,
				Hash:        ctxhash.HashString(translation),
				ContextHash: planItem.contextHashes[output.Lang],
				CheckedAt:   nowUTC(),
			}
			updated = true
			current = step
		}

		if opts.DryRun || !updated {
			continue
		}
		if err := locks.Write(root, planItem.source.SourcePath, *planItem.lock); err != nil {
			return err
		}
	}

	return nil
}

func Clean(root string, opts CleanOptions) error {
	pl, err := plan.Build(root)
	if err != nil {
		return err
	}
	if len(pl.Sources) == 0 {
		return errors.New("no sources found")
	}

	reporter := ensureReporter(opts.Reporter)

	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return err
	}

	planned := map[string]plan.SourcePlan{}
	for _, source := range pl.Sources {
		planned[source.SourcePath] = source
	}

	removed := 0
	missing := 0
	lockRemoved := 0

	for _, source := range pl.Sources {
		for _, output := range source.Outputs {
			abs, err := resolveWithinRoot(rootAbs, output.OutputPath)
			if err != nil {
				return err
			}
			wasRemoved, wasMissing, err := removePath(abs, output.OutputPath, opts.DryRun)
			if err != nil {
				return err
			}
			if wasRemoved {
				removed++
				reporter.CleanRemoved(output.OutputPath)
			}
			if wasMissing {
				missing++
				reporter.CleanMissing(output.OutputPath)
			}
		}
		lockPath := locks.LockPath(root, source.SourcePath)
		wasRemoved, wasMissing, err := removePath(lockPath, lockPath, opts.DryRun)
		if err != nil {
			return err
		}
		if wasRemoved {
			lockRemoved++
			reporter.CleanRemoved(lockPath)
		}
		if wasMissing {
			missing++
			reporter.CleanMissing(lockPath)
		}
	}

	if opts.Orphans {
		lockDir := filepath.Join(root, ".l10n", "locks")
		err := filepath.WalkDir(lockDir, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				if os.IsNotExist(err) {
					return nil
				}
				return err
			}
			if d.IsDir() {
				return nil
			}
			if !strings.HasSuffix(path, ".lock") {
				return nil
			}

			lock, err := readLockFile(path)
			if err != nil {
				return err
			}
			sourcePath := strings.TrimSpace(lock.SourcePath)
			if sourcePath == "" {
				sourcePath = sourcePathFromLock(rootAbs, path)
			}
			if _, ok := planned[sourcePath]; ok {
				return nil
			}

			for _, output := range lock.Outputs {
				abs, err := resolveWithinRoot(rootAbs, output.Path)
				if err != nil {
					return err
				}
				wasRemoved, wasMissing, err := removePath(abs, output.Path, opts.DryRun)
				if err != nil {
					return err
				}
				if wasRemoved {
					removed++
					reporter.CleanRemoved(output.Path)
				}
				if wasMissing {
					missing++
					reporter.CleanMissing(output.Path)
				}
			}
			wasRemoved, wasMissing, err := removePath(path, path, opts.DryRun)
			if err != nil {
				return err
			}
			if wasRemoved {
				lockRemoved++
				reporter.CleanRemoved(path)
			}
			if wasMissing {
				missing++
				reporter.CleanMissing(path)
			}
			return nil
		})
		if err != nil {
			return err
		}
	}

	reporter.CleanSummary(removed, missing, lockRemoved)
	return nil
}

func Check(root string, opts CheckOptions) error {
	pl, err := plan.Build(root)
	if err != nil {
		return err
	}
	if len(pl.Sources) == 0 {
		return errors.New("no sources found")
	}

	reporter := ensureReporter(opts.Reporter)
	total := 0
	for _, source := range pl.Sources {
		total += len(source.Outputs)
	}
	progress := reporter.Progress("Validating", total)
	defer progress.Done()

	checker := checks.Checker{Root: root}
	for _, source := range pl.Sources {
		sourceBytes, err := os.ReadFile(source.AbsPath)
		if err != nil {
			return err
		}
		for _, output := range source.Outputs {
			outputAbs := filepath.Join(root, output.OutputPath)
			outputBytes, err := os.ReadFile(outputAbs)
			if err != nil {
				if os.IsNotExist(err) {
					return fmt.Errorf("missing output: %s", output.OutputPath)
				}
				return err
			}
			checkCmd := pickCheckCmd(opts.CheckCmd, source.Entry.CheckCmd)
			checkCmds := source.Entry.CheckCmds
			if strings.TrimSpace(opts.CheckCmd) != "" {
				checkCmds = nil
			}
			label := fmt.Sprintf("%s -> %s (%s)", source.SourcePath, output.OutputPath, output.Lang)
			progress.Increment(label)
			if err := checker.Validate(context.Background(), source.Format, string(outputBytes), string(sourceBytes), checks.Options{
				Preserve:  source.Entry.Preserve,
				CheckCmd:  checkCmd,
				CheckCmds: checkCmds,
			}); err != nil {
				return fmt.Errorf("check failed for %s (%s): %w", output.OutputPath, output.Lang, err)
			}
		}
	}
	return nil
}

func Status(root string, opts StatusOptions) error {
	pl, err := plan.Build(root)
	if err != nil {
		return err
	}
	if len(pl.Sources) == 0 {
		return errors.New("no sources found")
	}

	reporter := ensureReporter(opts.Reporter)
	missing := 0
	stale := 0
	upToDate := 0

	for _, source := range pl.Sources {
		sourceBytes, err := os.ReadFile(source.AbsPath)
		if err != nil {
			return err
		}
		sourceHash := ctxhash.HashBytes(sourceBytes)
		lock, err := locks.Read(root, source.SourcePath)
		if err != nil {
			return err
		}

		for _, output := range source.Outputs {
			outputAbs := filepath.Join(root, output.OutputPath)
			_, err := os.Stat(outputAbs)
			if err != nil {
				if os.IsNotExist(err) {
					missing++
					reporter.Status(StatusMissing, source.SourcePath, output.OutputPath, output.Lang)
					continue
				}
				return err
			}
			contextHash := ctxhash.HashStrings(source.ContextPartsFor(output.Lang))
			if lock == nil || lock.SourceHash != sourceHash {
				stale++
				reporter.Status(StatusStale, source.SourcePath, output.OutputPath, output.Lang)
				continue
			}
			outputLock, ok := lock.Outputs[output.Lang]
			if !ok {
				stale++
				reporter.Status(StatusStale, source.SourcePath, output.OutputPath, output.Lang)
				continue
			}
			lockedContextHash := lockContextHash(lock, output.Lang)
			if lockedContextHash != contextHash {
				stale++
				reporter.Status(StatusStale, source.SourcePath, output.OutputPath, output.Lang)
				continue
			}
			if outputLock.Path != output.OutputPath {
				stale++
				reporter.Status(StatusStale, source.SourcePath, output.OutputPath, output.Lang)
				continue
			}
			upToDate++
			reporter.Status(StatusOK, source.SourcePath, output.OutputPath, output.Lang)
		}
	}

	reporter.StatusSummary(upToDate, stale, missing)
	if stale > 0 || missing > 0 {
		return errors.New("translations out of date")
	}
	return nil
}

func pickCheckCmd(flagCmd, entryCmd string) string {
	if strings.TrimSpace(flagCmd) != "" {
		return flagCmd
	}
	return entryCmd
}

func nowUTC() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func resolveWithinRoot(rootAbs, rel string) (string, error) {
	if strings.TrimSpace(rel) == "" {
		return "", errors.New("empty path")
	}
	if filepath.IsAbs(rel) {
		return "", fmt.Errorf("refusing to remove absolute path %q", rel)
	}
	abs := filepath.Clean(filepath.Join(rootAbs, rel))
	rootWithSep := rootAbs + string(filepath.Separator)
	if abs != rootAbs && !strings.HasPrefix(abs, rootWithSep) {
		return "", fmt.Errorf("refusing to remove path outside root: %s", rel)
	}
	return abs, nil
}

func removePath(path, display string, dryRun bool) (removed bool, missing bool, err error) {
	if dryRun {
		return false, false, nil
	}
	if err := os.Remove(path); err != nil {
		if os.IsNotExist(err) {
			return false, true, nil
		}
		return false, false, err
	}
	return true, false, nil
}

func readLockFile(path string) (*locks.LockFile, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var lock locks.LockFile
	if err := json.Unmarshal(data, &lock); err != nil {
		return nil, err
	}
	return &lock, nil
}

func sourcePathFromLock(rootAbs, lockPath string) string {
	base := filepath.Join(rootAbs, ".l10n", "locks")
	rel, err := filepath.Rel(base, lockPath)
	if err != nil {
		return ""
	}
	rel = strings.TrimSuffix(rel, ".lock")
	return filepath.ToSlash(rel)
}

func lockContextHash(lock *locks.LockFile, lang string) string {
	if lock == nil {
		return ""
	}
	if lock.Outputs != nil {
		if outputLock, ok := lock.Outputs[lang]; ok && outputLock.ContextHash != "" {
			return outputLock.ContextHash
		}
	}
	if lock.ContextHash != "" {
		return lock.ContextHash
	}
	return ""
}
