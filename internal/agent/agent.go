package agent

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/tuist/l10n/internal/checks"
	"github.com/tuist/l10n/internal/config"
	"github.com/tuist/l10n/internal/llm"
	"github.com/tuist/l10n/internal/plan"
	"github.com/tuist/l10n/internal/tools"
)

type Agent struct {
	Client  *llm.Client
	Checker checks.Checker
}

type TranslationRequest struct {
	Source      string
	TargetLang  string
	Format      plan.Format
	Context     string
	Preserve    []string
	Frontmatter string
	CheckCmd    string
	CheckCmds   map[string]string
	Retries     int
	Coordinator config.AgentConfig
	Translator  config.AgentConfig
}

func (a *Agent) Translate(ctx context.Context, req TranslationRequest) (string, error) {
	if a.Client == nil {
		return "", errors.New("llm client is required")
	}

	content := req.Source
	frontmatter := ""
	if req.Format == plan.FormatMarkdown && req.Frontmatter == config.FrontmatterPreserve {
		var ok bool
		frontmatter, content, ok = splitMarkdownFrontmatter(req.Source)
		if !ok {
			content = req.Source
			frontmatter = ""
		}
	}

	brief, err := a.buildBrief(ctx, req)
	if err != nil {
		return "", err
	}

	attempts := req.Retries
	if attempts < 0 {
		attempts = 0
	}
	var lastErr error
	for attempt := 0; attempt <= attempts; attempt++ {
		translation, err := a.translateOnce(ctx, req, brief, content, lastErr)
		if err != nil {
			lastErr = err
			continue
		}

		final := translation
		if isStructuredFormat(req.Format) {
			final = stripCodeFence(final)
		}
		if frontmatter != "" {
			if strings.TrimSpace(final) != "" {
				final = frontmatter + "\n" + final
			} else {
				final = frontmatter + "\n"
			}
		}

		checkErr := a.Checker.Validate(ctx, req.Format, final, req.Source, checks.Options{
			Preserve:  req.Preserve,
			CheckCmd:  req.CheckCmd,
			CheckCmds: req.CheckCmds,
		})
		if checkErr == nil {
			return final, nil
		}
		lastErr = checkErr
	}

	if lastErr == nil {
		lastErr = errors.New("translation failed")
	}
	return "", lastErr
}

func (a *Agent) buildBrief(ctx context.Context, req TranslationRequest) (string, error) {
	model := strings.TrimSpace(req.Coordinator.Model)
	if model == "" {
		return defaultBrief(req), nil
	}

	prompt := fmt.Sprintf(`You are a localization coordinator.
Create a short translation brief for the translator.
The brief must be plain text and under 12 lines.

Target language: %s
Format: %s
Preserve: %s
Frontmatter mode: %s
Tools: %s

Context:
%s
`, req.TargetLang, req.Format, strings.Join(req.Preserve, ", "), req.Frontmatter, tools.Summary(), req.Context)

	resp, err := a.Client.Chat(ctx, req.Coordinator, model, []llm.ChatMessage{
		{Role: "system", Content: "You coordinate translations and produce concise briefs."},
		{Role: "user", Content: prompt},
	})
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(resp), nil
}

func defaultBrief(req TranslationRequest) string {
	lines := []string{
		"Translate the content faithfully and naturally.",
		"Preserve code blocks, inline code, URLs, and placeholders.",
		"Keep formatting, lists, and headings intact.",
		"Return only the translated content.",
	}
	if isStructuredFormat(req.Format) {
		lines = append(lines, "Return valid "+string(req.Format)+" only. Do not wrap in markdown fences.")
	}
	if req.Frontmatter == config.FrontmatterPreserve {
		lines = append(lines, "Frontmatter is preserved separately; do not add new frontmatter.")
	}
	lines = append(lines, "Tools run after translation: "+tools.Summary()+".")
	return strings.Join(lines, "\n")
}

func (a *Agent) translateOnce(ctx context.Context, req TranslationRequest, brief string, content string, lastErr error) (string, error) {
	model := strings.TrimSpace(req.Translator.Model)
	if model == "" {
		return "", errors.New("translator model is required")
	}

	user := fmt.Sprintf("Translate to %s.\n\nContext:\n%s\n\nSource:\n%s", req.TargetLang, req.Context, content)
	if lastErr != nil {
		user += fmt.Sprintf("\n\nPrevious output failed validation: %s\nReturn a corrected full translation.", lastErr.Error())
	}

	resp, err := a.Client.Chat(ctx, req.Translator, model, []llm.ChatMessage{
		{Role: "system", Content: fmt.Sprintf("You are a translation engine. Follow this brief:\n%s", brief)},
		{Role: "user", Content: user},
	})
	if err != nil {
		return "", err
	}
	return strings.TrimRight(resp, "\n"), nil
}

func splitMarkdownFrontmatter(contents string) (frontmatter string, body string, ok bool) {
	lines := strings.Split(contents, "\n")
	if len(lines) == 0 {
		return "", contents, false
	}
	marker := strings.TrimSpace(lines[0])
	if marker != "---" && marker != "+++" {
		return "", contents, false
	}

	end := -1
	for i := 1; i < len(lines); i++ {
		if strings.TrimSpace(lines[i]) == marker {
			end = i
			break
		}
	}
	if end == -1 {
		return "", contents, false
	}

	frontmatter = strings.Join(lines[:end+1], "\n")
	body = strings.Join(lines[end+1:], "\n")
	return frontmatter, body, true
}

func isStructuredFormat(format plan.Format) bool {
	switch format {
	case plan.FormatJSON, plan.FormatYAML, plan.FormatPO:
		return true
	default:
		return false
	}
}

func stripCodeFence(content string) string {
	trimmed := strings.TrimSpace(content)
	if !strings.HasPrefix(trimmed, "```") {
		return content
	}
	lines := strings.Split(trimmed, "\n")
	if len(lines) < 2 {
		return content
	}
	if !strings.HasPrefix(strings.TrimSpace(lines[0]), "```") {
		return content
	}
	if strings.TrimSpace(lines[len(lines)-1]) != "```" {
		return content
	}
	return strings.Join(lines[1:len(lines)-1], "\n")
}
