package checks

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/pelletier/go-toml/v2"
	"gopkg.in/yaml.v3"

	"github.com/tuist/l10n/internal/plan"
)

type Checker struct {
	Root string
}

type Options struct {
	Preserve  []string
	CheckCmd  string
	CheckCmds map[string]string
	Reporter  ToolReporter
}

var defaultPreserve = []string{"code_blocks", "inline_code", "urls", "placeholders"}

type ToolError struct {
	Tool string
	Err  error
}

func (e ToolError) Error() string {
	return fmt.Sprintf("%s tool failed: %v", e.Tool, e.Err)
}

func (e ToolError) Unwrap() error {
	return e.Err
}

type ToolReporter interface {
	Tool(name, detail string)
}

func (c Checker) Validate(ctx context.Context, format plan.Format, output string, source string, opts Options) error {
	if opts.Reporter != nil {
		opts.Reporter.Tool("syntax-validator", "parse "+formatLabel(format))
	}
	if err := validateSyntax(format, output); err != nil {
		return ToolError{Tool: "syntax-validator", Err: err}
	}

	preserveKinds := resolvePreserve(opts.Preserve)
	if len(preserveKinds) > 0 {
		if opts.Reporter != nil {
			opts.Reporter.Tool("preserve-check", "verify preserved tokens")
		}
		if err := validatePreserve(output, source, preserveKinds); err != nil {
			return ToolError{Tool: "preserve-check", Err: err}
		}
	}

	cmd := selectCheckCmd(format, opts.CheckCmd, opts.CheckCmds)
	if cmd != "" {
		if opts.Reporter != nil {
			opts.Reporter.Tool("custom-command", "run check_cmd")
		}
		if err := c.runExternal(ctx, cmd, output); err != nil {
			return ToolError{Tool: "custom-command", Err: err}
		}
	}

	return nil
}

func validateSyntax(format plan.Format, output string) error {
	switch format {
	case plan.FormatJSON:
		var v any
		if err := json.Unmarshal([]byte(output), &v); err != nil {
			return fmt.Errorf("json invalid: %w", err)
		}
	case plan.FormatYAML:
		var v any
		if err := yaml.Unmarshal([]byte(output), &v); err != nil {
			return fmt.Errorf("yaml invalid: %w", err)
		}
	case plan.FormatPO:
		if err := validatePO(output); err != nil {
			return err
		}
	case plan.FormatMarkdown:
		if err := validateMarkdown(output); err != nil {
			return err
		}
	}
	return nil
}

func resolvePreserve(preserve []string) map[string]bool {
	if len(preserve) == 0 {
		return sliceToSet(defaultPreserve)
	}
	for _, value := range preserve {
		if strings.TrimSpace(strings.ToLower(value)) == "none" {
			return map[string]bool{}
		}
	}
	return sliceToSet(preserve)
}

func sliceToSet(items []string) map[string]bool {
	set := map[string]bool{}
	for _, item := range items {
		item = strings.TrimSpace(strings.ToLower(item))
		if item == "" {
			continue
		}
		set[item] = true
	}
	return set
}

func validatePreserve(output, source string, kinds map[string]bool) error {
	preservables := extractPreservables(source, kinds)
	missing := []string{}
	for _, token := range preservables {
		if !strings.Contains(output, token) {
			missing = append(missing, token)
			if len(missing) >= 5 {
				break
			}
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("preserved tokens missing from output: %q", missing)
	}
	return nil
}

func extractPreservables(source string, kinds map[string]bool) []string {
	var tokens []string
	seen := map[string]bool{}
	text := source

	if kinds["code_blocks"] {
		for _, block := range codeBlockRe.FindAllString(text, -1) {
			if !seen[block] {
				seen[block] = true
				tokens = append(tokens, block)
			}
		}
		text = codeBlockRe.ReplaceAllString(text, "")
	}
	if kinds["inline_code"] {
		for _, code := range inlineCodeRe.FindAllString(text, -1) {
			if !seen[code] {
				seen[code] = true
				tokens = append(tokens, code)
			}
		}
	}
	if kinds["urls"] {
		for _, url := range urlRe.FindAllString(text, -1) {
			if !seen[url] {
				seen[url] = true
				tokens = append(tokens, url)
			}
		}
	}
	if kinds["placeholders"] {
		for _, ph := range placeholderRe.FindAllString(text, -1) {
			if !seen[ph] {
				seen[ph] = true
				tokens = append(tokens, ph)
			}
		}
	}

	return tokens
}

var (
	codeBlockRe   = regexp.MustCompile("(?s)```.*?```")
	inlineCodeRe  = regexp.MustCompile("`[^`\n]+`")
	urlRe         = regexp.MustCompile(`https?://[^\s)"'<>]+`)
	placeholderRe = regexp.MustCompile(`\{[^\s{}]+\}`)
)

func validateMarkdown(content string) error {
	lines := strings.Split(content, "\n")
	if len(lines) == 0 {
		return nil
	}
	first := strings.TrimSpace(lines[0])
	if first != "---" && first != "+++" {
		return nil
	}

	end := -1
	for i := 1; i < len(lines); i++ {
		if strings.TrimSpace(lines[i]) == first {
			end = i
			break
		}
	}
	if end == -1 {
		return fmt.Errorf("markdown frontmatter missing closing %s", first)
	}

	frontmatter := strings.Join(lines[1:end], "\n")
	if first == "---" {
		var v any
		if err := yaml.Unmarshal([]byte(frontmatter), &v); err != nil {
			return fmt.Errorf("markdown frontmatter invalid yaml: %w", err)
		}
		return nil
	}

	var v any
	if err := toml.Unmarshal([]byte(frontmatter), &v); err != nil {
		return fmt.Errorf("markdown frontmatter invalid toml: %w", err)
	}
	return nil
}

func validatePO(content string) error {
	scanner := bufio.NewScanner(strings.NewReader(content))
	state := ""
	hasMsgid := false
	hasMsgstr := false
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		switch {
		case strings.HasPrefix(line, "msgid "):
			if hasMsgid && !hasMsgstr {
				return errors.New("po entry missing msgstr")
			}
			hasMsgid = true
			hasMsgstr = false
			state = "msgid"
			if !hasQuotedString(line) {
				return errors.New("po msgid missing quoted string")
			}
		case strings.HasPrefix(line, "msgid_plural "):
			if state != "msgid" {
				return errors.New("po msgid_plural without msgid")
			}
			if !hasQuotedString(line) {
				return errors.New("po msgid_plural missing quoted string")
			}
		case strings.HasPrefix(line, "msgstr"):
			if !hasMsgid {
				return errors.New("po msgstr without msgid")
			}
			hasMsgstr = true
			state = "msgstr"
			if !hasQuotedString(line) {
				return errors.New("po msgstr missing quoted string")
			}
		case strings.HasPrefix(line, "\""):
			if state == "" {
				return errors.New("po stray quoted string")
			}
		default:
			return fmt.Errorf("po invalid line: %s", line)
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	if hasMsgid && !hasMsgstr {
		return errors.New("po entry missing msgstr")
	}
	return nil
}

func hasQuotedString(line string) bool {
	count := 0
	escaped := false
	for _, r := range line {
		if r == '\\' && !escaped {
			escaped = true
			continue
		}
		if r == '"' && !escaped {
			count++
		}
		escaped = false
	}
	return count >= 2
}

func formatLabel(format plan.Format) string {
	switch format {
	case plan.FormatJSON:
		return "JSON"
	case plan.FormatYAML:
		return "YAML"
	case plan.FormatPO:
		return "PO"
	case plan.FormatMarkdown:
		return "Markdown frontmatter"
	default:
		return string(format)
	}
}

func selectCheckCmd(format plan.Format, fallback string, cmds map[string]string) string {
	key := string(format)
	if cmds != nil {
		if value := cmds[key]; strings.TrimSpace(value) != "" {
			return value
		}
	}
	return strings.TrimSpace(fallback)
}

func (c Checker) runExternal(ctx context.Context, cmdTemplate string, content string) error {
	if c.Root == "" {
		return errors.New("external check requires root path")
	}
	tmpDir := filepath.Join(c.Root, ".l10n", "tmp")
	if err := os.MkdirAll(tmpDir, 0o755); err != nil {
		return err
	}
	tmpFile, err := os.CreateTemp(tmpDir, "check-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmpFile.Name())
	if _, err := tmpFile.WriteString(content); err != nil {
		_ = tmpFile.Close()
		return err
	}
	if err := tmpFile.Close(); err != nil {
		return err
	}

	cmdText := strings.ReplaceAll(cmdTemplate, "{path}", tmpFile.Name())
	cmd := exec.CommandContext(ctx, "sh", "-c", cmdText)
	cmd.Dir = c.Root
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("external check failed: %w\n%s", err, strings.TrimSpace(string(output)))
	}
	return nil
}
