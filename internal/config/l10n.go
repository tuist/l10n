package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/pelletier/go-toml/v2"
)

type L10NFile struct {
	Path   string
	Dir    string
	Depth  int
	Body   string
	Config L10NConfig
}

type L10NConfig struct {
	LLM       LLMConfig        `toml:"llm"`
	Translate []TranslateEntry `toml:"translate"`
}

type AgentConfig struct {
	Role                string            `toml:"role"`
	Provider            string            `toml:"provider"`
	BaseURL             string            `toml:"base_url"`
	ChatCompletionsPath string            `toml:"chat_completions_path"`
	APIKey              string            `toml:"api_key"`
	APIKeyEnv           string            `toml:"api_key_env"`
	Model               string            `toml:"model"`
	Temperature         *float64          `toml:"temperature"`
	MaxTokens           *int              `toml:"max_tokens"`
	Headers             map[string]string `toml:"headers"`
	TimeoutSeconds      int               `toml:"timeout_seconds"`
}

type TranslateEntry struct {
	Source      string            `toml:"source"`
	Path        string            `toml:"path"`
	Targets     []string          `toml:"targets"`
	Output      string            `toml:"output"`
	Exclude     []string          `toml:"exclude"`
	Preserve    []string          `toml:"preserve"`
	Frontmatter string            `toml:"frontmatter"`
	CheckCmd    string            `toml:"check_cmd"`
	CheckCmds   map[string]string `toml:"check_cmds"`
	Retries     *int              `toml:"retries"`
}

type LLMConfig struct {
	Provider            string            `toml:"provider"`
	BaseURL             string            `toml:"base_url"`
	ChatCompletionsPath string            `toml:"chat_completions_path"`
	APIKey              string            `toml:"api_key"`
	APIKeyEnv           string            `toml:"api_key_env"`
	CoordinatorModel    string            `toml:"coordinator_model"`
	TranslatorModel     string            `toml:"translator_model"`
	Temperature         *float64          `toml:"temperature"`
	MaxTokens           *int              `toml:"max_tokens"`
	Headers             map[string]string `toml:"headers"`
	TimeoutSeconds      int               `toml:"timeout_seconds"`
	Agents              []AgentConfig     `toml:"agent"`
}

type Entry struct {
	TranslateEntry
	OriginPath  string
	OriginDir   string
	OriginDepth int
	Index       int
}

func (e TranslateEntry) SourcePath() string {
	if strings.TrimSpace(e.Source) != "" {
		return e.Source
	}
	return e.Path
}

func (e TranslateEntry) Normalized() TranslateEntry {
	out := e
	if out.Source == "" {
		out.Source = out.Path
	}
	return out
}

func ParseFile(path string) (L10NFile, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		return L10NFile{}, err
	}
	frontmatter, body, hasFrontmatter, err := SplitTomlFrontmatter(string(contents))
	if err != nil {
		return L10NFile{}, err
	}

	var cfg L10NConfig
	if hasFrontmatter {
		if err := toml.Unmarshal([]byte(frontmatter), &cfg); err != nil {
			return L10NFile{}, fmt.Errorf("parse frontmatter: %w", err)
		}
	}

	for i, entry := range cfg.Translate {
		cfg.Translate[i] = entry.Normalized()
		if cfg.Translate[i].Frontmatter == "" {
			cfg.Translate[i].Frontmatter = "preserve"
		}
	}

	absPath, err := filepath.Abs(path)
	if err != nil {
		return L10NFile{}, err
	}
	dir := filepath.Dir(absPath)

	return L10NFile{
		Path:   absPath,
		Dir:    dir,
		Depth:  0,
		Body:   body,
		Config: cfg,
	}, nil
}

func SplitTomlFrontmatter(contents string) (frontmatter string, body string, hasFrontmatter bool, err error) {
	lines := strings.Split(contents, "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "+++" {
		return "", contents, false, nil
	}

	end := -1
	for i := 1; i < len(lines); i++ {
		if strings.TrimSpace(lines[i]) == "+++" {
			end = i
			break
		}
	}
	if end == -1 {
		return "", "", false, errors.New("frontmatter start found but no closing +++")
	}
	frontmatter = strings.Join(lines[1:end], "\n")
	body = strings.Join(lines[end+1:], "\n")
	return frontmatter, body, true, nil
}
