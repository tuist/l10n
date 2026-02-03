package config

import (
	"errors"
	"fmt"
	"strings"
)

func MergeLLM(base, override LLMConfig) LLMConfig {
	out := base
	if strings.TrimSpace(override.Provider) != "" {
		out.Provider = override.Provider
	}
	if strings.TrimSpace(override.BaseURL) != "" {
		out.BaseURL = override.BaseURL
	}
	if strings.TrimSpace(override.ChatCompletionsPath) != "" {
		out.ChatCompletionsPath = override.ChatCompletionsPath
	}
	if strings.TrimSpace(override.APIKey) != "" {
		out.APIKey = override.APIKey
	}
	if strings.TrimSpace(override.APIKeyEnv) != "" {
		out.APIKeyEnv = override.APIKeyEnv
	}
	if strings.TrimSpace(override.CoordinatorModel) != "" {
		out.CoordinatorModel = override.CoordinatorModel
	}
	if strings.TrimSpace(override.TranslatorModel) != "" {
		out.TranslatorModel = override.TranslatorModel
	}
	if override.Temperature != nil {
		out.Temperature = override.Temperature
	}
	if override.MaxTokens != nil {
		out.MaxTokens = override.MaxTokens
	}
	if override.TimeoutSeconds != 0 {
		out.TimeoutSeconds = override.TimeoutSeconds
	}

	if len(override.Headers) > 0 {
		if out.Headers == nil {
			out.Headers = map[string]string{}
		}
		for k, v := range override.Headers {
			out.Headers[k] = v
		}
	}

	out.Agents = mergeAgents(out.Agents, override.Agents)

	return out
}

func ResolveAgents(cfg LLMConfig) (AgentConfig, AgentConfig, error) {
	agentsByRole, err := normalizeAgents(cfg.Agents)
	if err != nil {
		return AgentConfig{}, AgentConfig{}, err
	}

	base := AgentConfig{
		Provider:            cfg.Provider,
		BaseURL:             cfg.BaseURL,
		ChatCompletionsPath: cfg.ChatCompletionsPath,
		APIKey:              cfg.APIKey,
		APIKeyEnv:           cfg.APIKeyEnv,
		Temperature:         cfg.Temperature,
		MaxTokens:           cfg.MaxTokens,
		Headers:             cloneHeaders(cfg.Headers),
		TimeoutSeconds:      cfg.TimeoutSeconds,
	}

	coordinator := mergeAgent(base, agentsByRole["coordinator"])
	if strings.TrimSpace(coordinator.Model) == "" {
		coordinator.Model = cfg.CoordinatorModel
	}
	coordinator = ApplyAgentDefaults(coordinator)

	translator := mergeAgent(base, agentsByRole["translator"])
	if strings.TrimSpace(translator.Model) == "" {
		translator.Model = cfg.TranslatorModel
	}

	if strings.TrimSpace(translator.Provider) == "" {
		translator.Provider = coordinator.Provider
	}
	if strings.TrimSpace(translator.BaseURL) == "" {
		translator.BaseURL = coordinator.BaseURL
	}
	if strings.TrimSpace(translator.ChatCompletionsPath) == "" {
		translator.ChatCompletionsPath = coordinator.ChatCompletionsPath
	}
	if strings.TrimSpace(translator.APIKey) == "" {
		translator.APIKey = coordinator.APIKey
	}
	if strings.TrimSpace(translator.APIKeyEnv) == "" {
		translator.APIKeyEnv = coordinator.APIKeyEnv
	}
	if translator.Temperature == nil {
		translator.Temperature = coordinator.Temperature
	}
	if translator.MaxTokens == nil {
		translator.MaxTokens = coordinator.MaxTokens
	}
	if translator.TimeoutSeconds == 0 {
		translator.TimeoutSeconds = coordinator.TimeoutSeconds
	}
	if len(translator.Headers) == 0 {
		translator.Headers = cloneHeaders(coordinator.Headers)
	} else {
		translator.Headers = mergeHeaderMaps(coordinator.Headers, translator.Headers)
	}

	translator = ApplyAgentDefaults(translator)

	return coordinator, translator, nil
}

func normalizeAgents(agents []AgentConfig) (map[string]AgentConfig, error) {
	out := map[string]AgentConfig{}
	for _, agent := range agents {
		role := strings.ToLower(strings.TrimSpace(agent.Role))
		if role == "" {
			return nil, errors.New("llm.agent requires role")
		}
		if role != "coordinator" && role != "translator" {
			return nil, fmt.Errorf("unknown llm.agent role %q", agent.Role)
		}
		out[role] = agent
	}
	return out, nil
}

func ApplyAgentDefaults(cfg AgentConfig) AgentConfig {
	provider := strings.TrimSpace(cfg.Provider)
	if provider == "" {
		provider = "openai"
	}
	cfg.Provider = provider

	switch provider {
	case "openai":
		if strings.TrimSpace(cfg.ChatCompletionsPath) == "" {
			cfg.ChatCompletionsPath = "/chat/completions"
		}
		if strings.TrimSpace(cfg.BaseURL) == "" {
			cfg.BaseURL = "https://api.openai.com/v1"
		}
		if strings.TrimSpace(cfg.APIKeyEnv) == "" {
			cfg.APIKeyEnv = "OPENAI_API_KEY"
		}
	case "vertex":
		if strings.TrimSpace(cfg.ChatCompletionsPath) == "" {
			cfg.ChatCompletionsPath = "/chat/completions"
		}
		// Vertex uses OpenAI-compatible chat.completions; base URL and auth are required.
		// Leave BaseURL and APIKeyEnv empty unless explicitly set.
	case "anthropic":
		if strings.TrimSpace(cfg.ChatCompletionsPath) == "" {
			cfg.ChatCompletionsPath = "/v1/messages"
		}
		if strings.TrimSpace(cfg.BaseURL) == "" {
			cfg.BaseURL = "https://api.anthropic.com"
		}
		if strings.TrimSpace(cfg.APIKeyEnv) == "" {
			cfg.APIKeyEnv = "ANTHROPIC_API_KEY"
		}
	}

	return cfg
}

func mergeAgent(base AgentConfig, override AgentConfig) AgentConfig {
	out := base
	if strings.TrimSpace(override.Provider) != "" {
		out.Provider = override.Provider
	}
	if strings.TrimSpace(override.BaseURL) != "" {
		out.BaseURL = override.BaseURL
	}
	if strings.TrimSpace(override.ChatCompletionsPath) != "" {
		out.ChatCompletionsPath = override.ChatCompletionsPath
	}
	if strings.TrimSpace(override.APIKey) != "" {
		out.APIKey = override.APIKey
	}
	if strings.TrimSpace(override.APIKeyEnv) != "" {
		out.APIKeyEnv = override.APIKeyEnv
	}
	if strings.TrimSpace(override.Model) != "" {
		out.Model = override.Model
	}
	if override.Temperature != nil {
		out.Temperature = override.Temperature
	}
	if override.MaxTokens != nil {
		out.MaxTokens = override.MaxTokens
	}
	if override.TimeoutSeconds != 0 {
		out.TimeoutSeconds = override.TimeoutSeconds
	}
	if len(override.Headers) > 0 {
		out.Headers = mergeHeaderMaps(out.Headers, override.Headers)
	}
	return out
}

func mergeAgents(base []AgentConfig, override []AgentConfig) []AgentConfig {
	if len(override) == 0 {
		return base
	}
	out := append([]AgentConfig{}, base...)
	for _, agent := range override {
		role := strings.ToLower(strings.TrimSpace(agent.Role))
		replaced := false
		if role != "" {
			for i, existing := range out {
				if strings.ToLower(strings.TrimSpace(existing.Role)) == role {
					out[i] = agent
					replaced = true
					break
				}
			}
		}
		if !replaced {
			out = append(out, agent)
		}
	}
	return out
}

func cloneHeaders(headers map[string]string) map[string]string {
	if len(headers) == 0 {
		return nil
	}
	out := map[string]string{}
	for k, v := range headers {
		out[k] = v
	}
	return out
}

func mergeHeaderMaps(base, override map[string]string) map[string]string {
	out := cloneHeaders(base)
	if out == nil {
		out = map[string]string{}
	}
	for k, v := range override {
		out[k] = v
	}
	return out
}
