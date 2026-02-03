package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/tuist/l10n/internal/config"
)

type Client struct {
	HTTP *http.Client
}

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model       string        `json:"model"`
	Messages    []ChatMessage `json:"messages"`
	Temperature *float64      `json:"temperature,omitempty"`
	MaxTokens   *int          `json:"max_tokens,omitempty"`
}

type chatResponse struct {
	Choices []struct {
		Message ChatMessage `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error"`
}

type anthropicMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type anthropicRequest struct {
	Model       string             `json:"model"`
	MaxTokens   int                `json:"max_tokens"`
	Messages    []anthropicMessage `json:"messages"`
	System      string             `json:"system,omitempty"`
	Temperature *float64           `json:"temperature,omitempty"`
}

type anthropicResponse struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error"`
}

const (
	defaultAnthropicVersion   = "2023-06-01"
	defaultAnthropicMaxTokens = 1024
)

func NewClient() *Client {
	return &Client{HTTP: &http.Client{Timeout: 60 * time.Second}}
}

func (c *Client) Chat(ctx context.Context, cfg config.AgentConfig, model string, messages []ChatMessage) (string, error) {
	provider := strings.ToLower(strings.TrimSpace(cfg.Provider))
	if provider == "" {
		provider = "openai"
	}
	switch provider {
	case "anthropic":
		return c.chatAnthropic(ctx, cfg, model, messages)
	default:
		return c.chatOpenAI(ctx, cfg, model, messages)
	}
}

func (c *Client) chatOpenAI(ctx context.Context, cfg config.AgentConfig, model string, messages []ChatMessage) (string, error) {
	if strings.TrimSpace(cfg.BaseURL) == "" {
		return "", errors.New("llm base_url is required")
	}
	if strings.TrimSpace(model) == "" {
		return "", errors.New("llm model is required")
	}

	url := strings.TrimRight(cfg.BaseURL, "/") + cfg.ChatCompletionsPath

	body, err := json.Marshal(chatRequest{
		Model:       model,
		Messages:    messages,
		Temperature: cfg.Temperature,
		MaxTokens:   cfg.MaxTokens,
	})
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "l10n")

	for k, v := range resolveHeaders(cfg) {
		if v == "" {
			continue
		}
		req.Header.Set(k, v)
	}

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var parsed chatResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return "", err
	}
	if resp.StatusCode >= 400 {
		if parsed.Error != nil && parsed.Error.Message != "" {
			return "", fmt.Errorf("llm error: %s", parsed.Error.Message)
		}
		return "", fmt.Errorf("llm error: status %d", resp.StatusCode)
	}
	if len(parsed.Choices) == 0 {
		return "", errors.New("llm response missing choices")
	}
	return parsed.Choices[0].Message.Content, nil
}

func (c *Client) chatAnthropic(ctx context.Context, cfg config.AgentConfig, model string, messages []ChatMessage) (string, error) {
	if strings.TrimSpace(cfg.BaseURL) == "" {
		return "", errors.New("llm base_url is required")
	}
	if strings.TrimSpace(model) == "" {
		return "", errors.New("llm model is required")
	}

	url := strings.TrimRight(cfg.BaseURL, "/") + cfg.ChatCompletionsPath

	systemParts := []string{}
	anthMessages := make([]anthropicMessage, 0, len(messages))
	for _, msg := range messages {
		role := strings.ToLower(strings.TrimSpace(msg.Role))
		switch role {
		case "system":
			if strings.TrimSpace(msg.Content) != "" {
				systemParts = append(systemParts, msg.Content)
			}
		case "user", "assistant":
			anthMessages = append(anthMessages, anthropicMessage{Role: role, Content: msg.Content})
		default:
			return "", fmt.Errorf("unsupported message role %q for anthropic", msg.Role)
		}
	}
	if len(anthMessages) == 0 {
		return "", errors.New("llm request requires user messages")
	}

	maxTokens := defaultAnthropicMaxTokens
	if cfg.MaxTokens != nil && *cfg.MaxTokens > 0 {
		maxTokens = *cfg.MaxTokens
	}

	reqBody := anthropicRequest{
		Model:       model,
		MaxTokens:   maxTokens,
		Messages:    anthMessages,
		Temperature: cfg.Temperature,
	}
	if len(systemParts) > 0 {
		reqBody.System = strings.Join(systemParts, "\n\n")
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "l10n")

	for k, v := range resolveHeaders(cfg) {
		if v == "" {
			continue
		}
		req.Header.Set(k, v)
	}

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var parsed anthropicResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return "", err
	}
	if resp.StatusCode >= 400 {
		if parsed.Error != nil && parsed.Error.Message != "" {
			return "", fmt.Errorf("llm error: %s", parsed.Error.Message)
		}
		return "", fmt.Errorf("llm error: status %d", resp.StatusCode)
	}
	if len(parsed.Content) == 0 {
		return "", errors.New("llm response missing content")
	}
	var out strings.Builder
	for _, block := range parsed.Content {
		if block.Type == "text" {
			out.WriteString(block.Text)
		}
	}
	if out.Len() == 0 {
		return "", errors.New("llm response missing text")
	}
	return out.String(), nil
}

func resolveHeaders(cfg config.AgentConfig) map[string]string {
	headers := map[string]string{}
	for k, v := range cfg.Headers {
		headers[k] = expandEnv(v)
	}
	provider := strings.ToLower(strings.TrimSpace(cfg.Provider))
	if provider == "" {
		provider = "openai"
	}

	switch provider {
	case "anthropic":
		if !hasHeader(headers, "x-api-key") {
			key := strings.TrimSpace(expandEnv(cfg.APIKey))
			if key == "" && cfg.APIKeyEnv != "" {
				key = os.Getenv(cfg.APIKeyEnv)
			}
			if key != "" {
				headers["x-api-key"] = key
			}
		}
		if !hasHeader(headers, "anthropic-version") {
			headers["anthropic-version"] = defaultAnthropicVersion
		}
	default:
		if !hasHeader(headers, "authorization") {
			key := strings.TrimSpace(expandEnv(cfg.APIKey))
			if key == "" && cfg.APIKeyEnv != "" {
				key = os.Getenv(cfg.APIKeyEnv)
			}
			if key != "" {
				headers["Authorization"] = "Bearer " + key
			}
		}
	}
	return headers
}

func hasHeader(headers map[string]string, name string) bool {
	for k := range headers {
		if strings.EqualFold(k, name) {
			return true
		}
	}
	return false
}

func expandEnv(value string) string {
	const token = "env:"
	const prefix = "env."
	expanded := expandEnvTemplates(value)
	if strings.HasPrefix(expanded, prefix) {
		return os.Getenv(strings.TrimPrefix(expanded, prefix))
	}
	parts := strings.Split(expanded, token)
	if len(parts) == 1 {
		return expanded
	}

	var out strings.Builder
	out.WriteString(parts[0])
	for i := 1; i < len(parts); i++ {
		segment := parts[i]
		name := segment
		rest := ""
		for idx, r := range segment {
			if r == '/' || r == ' ' || r == '\t' {
				name = segment[:idx]
				rest = segment[idx:]
				break
			}
		}
		out.WriteString(os.Getenv(name))
		out.WriteString(rest)
	}
	return out.String()
}

var envTemplateRe = regexp.MustCompile(`\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}`)

func expandEnvTemplates(value string) string {
	return envTemplateRe.ReplaceAllStringFunc(value, func(match string) string {
		sub := envTemplateRe.FindStringSubmatch(match)
		if len(sub) < 2 {
			return ""
		}
		return os.Getenv(sub[1])
	})
}
