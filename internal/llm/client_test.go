package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tuist/l10n/internal/config"
)

func TestChatAnthropicUsesSystemAndHeaders(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "test-key")

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("x-api-key"); got != "test-key" {
			t.Fatalf("expected x-api-key header, got %q", got)
		}
		if got := r.Header.Get("anthropic-version"); got != defaultAnthropicVersion {
			t.Fatalf("expected anthropic-version %q, got %q", defaultAnthropicVersion, got)
		}
		var req anthropicRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if req.System != "system prompt" {
			t.Fatalf("expected system prompt, got %q", req.System)
		}
		if len(req.Messages) != 1 || req.Messages[0].Role != "user" {
			t.Fatalf("expected single user message, got %#v", req.Messages)
		}
		if req.MaxTokens != 2048 {
			t.Fatalf("expected max tokens 2048, got %d", req.MaxTokens)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"content":[{"type":"text","text":"ok"}]}`))
	}))
	t.Cleanup(server.Close)

	maxTokens := 2048
	cfg := config.AgentConfig{
		Provider:            "anthropic",
		BaseURL:             server.URL,
		ChatCompletionsPath: "/v1/messages",
		APIKeyEnv:           "ANTHROPIC_API_KEY",
		MaxTokens:           &maxTokens,
	}

	client := NewClient()
	out, err := client.Chat(context.Background(), cfg, "claude-opus-4-5", []ChatMessage{
		{Role: "system", Content: "system prompt"},
		{Role: "user", Content: "hello"},
	})
	if err != nil {
		t.Fatalf("chat error: %v", err)
	}
	if out != "ok" {
		t.Fatalf("expected ok, got %q", out)
	}
}

func TestExpandEnvVariants(t *testing.T) {
	t.Setenv("EXAMPLE_TOKEN", "secret")

	if got := expandEnv("env.EXAMPLE_TOKEN"); got != "secret" {
		t.Fatalf("expected env prefix to expand, got %q", got)
	}
	if got := expandEnv("env:EXAMPLE_TOKEN"); got != "secret" {
		t.Fatalf("expected env token to expand, got %q", got)
	}
	if got := expandEnv("Bearer env:EXAMPLE_TOKEN"); got != "Bearer secret" {
		t.Fatalf("expected inline env token to expand, got %q", got)
	}
	if got := expandEnv("{{env.EXAMPLE_TOKEN}}"); got != "secret" {
		t.Fatalf("expected template env to expand, got %q", got)
	}
	if got := expandEnv("Token {{env.EXAMPLE_TOKEN}}"); got != "Token secret" {
		t.Fatalf("expected template env to expand inline, got %q", got)
	}
}
