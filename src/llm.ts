import type { AgentConfig } from "./config.js";

export interface ChatMessage {
  role: string;
  content: string;
}

interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

interface ChatResponse {
  choices?: { message: ChatMessage }[];
  error?: { message: string; type: string };
}

interface AnthropicMessage {
  role: string;
  content: string;
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string;
  temperature?: number;
}

interface AnthropicResponse {
  content?: { type: string; text: string }[];
  error?: { message: string; type: string };
}

const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_ANTHROPIC_MAX_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

const envTemplateRe = /\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

function expandEnvTemplates(value: string): string {
  return value.replace(envTemplateRe, (_match, name) => {
    return process.env[name] ?? "";
  });
}

function expandEnv(value: string): string {
  const expanded = expandEnvTemplates(value);
  if (expanded.startsWith("env.")) {
    return process.env[expanded.slice(4)] ?? "";
  }
  const parts = expanded.split("env:");
  if (parts.length === 1) return expanded;

  let out = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const segment = parts[i];
    let name = segment;
    let rest = "";
    for (let j = 0; j < segment.length; j++) {
      if (segment[j] === "/" || segment[j] === " " || segment[j] === "\t") {
        name = segment.slice(0, j);
        rest = segment.slice(j);
        break;
      }
    }
    out += (process.env[name] ?? "") + rest;
  }
  return out;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
}

function resolveHeaders(cfg: AgentConfig): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(cfg.headers ?? {})) {
    headers[k] = expandEnv(v);
  }

  const provider = (cfg.provider ?? "openai").toLowerCase().trim();

  switch (provider) {
    case "anthropic": {
      if (!hasHeader(headers, "x-api-key")) {
        let key = expandEnv(cfg.api_key ?? "").trim();
        if (!key && cfg.api_key_env) {
          key = process.env[cfg.api_key_env] ?? "";
        }
        if (key) headers["x-api-key"] = key;
      }
      if (!hasHeader(headers, "anthropic-version")) {
        headers["anthropic-version"] = DEFAULT_ANTHROPIC_VERSION;
      }
      break;
    }
    default: {
      if (!hasHeader(headers, "authorization")) {
        let key = expandEnv(cfg.api_key ?? "").trim();
        if (!key && cfg.api_key_env) {
          key = process.env[cfg.api_key_env] ?? "";
        }
        if (key) headers["Authorization"] = "Bearer " + key;
      }
      break;
    }
  }
  return headers;
}

export async function chat(
  cfg: AgentConfig,
  model: string,
  messages: ChatMessage[],
): Promise<string> {
  const provider = (cfg.provider ?? "openai").toLowerCase().trim();
  if (provider === "anthropic") {
    return chatAnthropic(cfg, model, messages);
  }
  // claude → Claude CLI
  if (provider === "claude") {
    return chatLocalClaude(cfg, model, messages);
  }
  // codex → Codex CLI
  if (provider === "codex") {
    return chatLocalCodex(cfg, model, messages);
  }
  return chatOpenAI(cfg, model, messages);
}

async function chatOpenAI(
  cfg: AgentConfig,
  model: string,
  messages: ChatMessage[],
): Promise<string> {
  if (!(cfg.base_url ?? "").trim()) {
    throw new Error("llm base_url is required");
  }
  if (!model.trim()) {
    throw new Error("llm model is required");
  }

  const url = cfg.base_url.replace(/\/+$/, "") + (cfg.chat_completions_path || "");

  const body: ChatRequest = {
    model,
    messages,
    temperature: cfg.temperature,
    max_tokens: cfg.max_tokens,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "l10n",
    ...resolveHeaders(cfg),
  };

  const timeout = cfg.timeout_seconds ? cfg.timeout_seconds * 1000 : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const parsed = (await resp.json()) as ChatResponse;
    if (resp.status >= 400) {
      if (parsed.error?.message) {
        throw new Error(`llm error: ${parsed.error.message}`);
      }
      throw new Error(`llm error: status ${resp.status}`);
    }
    if (!parsed.choices || parsed.choices.length === 0) {
      throw new Error("llm response missing choices");
    }
    return parsed.choices[0].message.content;
  } finally {
    clearTimeout(timer);
  }
}

async function chatAnthropic(
  cfg: AgentConfig,
  model: string,
  messages: ChatMessage[],
): Promise<string> {
  if (!(cfg.base_url ?? "").trim()) {
    throw new Error("llm base_url is required");
  }
  if (!model.trim()) {
    throw new Error("llm model is required");
  }

  const url = cfg.base_url.replace(/\/+$/, "") + (cfg.chat_completions_path || "");

  const systemParts: string[] = [];
  const anthMessages: AnthropicMessage[] = [];
  for (const msg of messages) {
    const role = (msg.role ?? "").toLowerCase().trim();
    switch (role) {
      case "system":
        if (msg.content.trim()) systemParts.push(msg.content);
        break;
      case "user":
      case "assistant":
        anthMessages.push({ role, content: msg.content });
        break;
      default:
        throw new Error(`unsupported message role "${msg.role}" for anthropic`);
    }
  }
  if (anthMessages.length === 0) {
    throw new Error("llm request requires user messages");
  }

  let maxTokens = DEFAULT_ANTHROPIC_MAX_TOKENS;
  if (cfg.max_tokens && cfg.max_tokens > 0) {
    maxTokens = cfg.max_tokens;
  }

  const reqBody: AnthropicRequest = {
    model,
    max_tokens: maxTokens,
    messages: anthMessages,
    temperature: cfg.temperature,
  };
  if (systemParts.length > 0) {
    reqBody.system = systemParts.join("\n\n");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "l10n",
    ...resolveHeaders(cfg),
  };

  const timeout = cfg.timeout_seconds ? cfg.timeout_seconds * 1000 : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(reqBody),
      signal: controller.signal,
    });

    const parsed = (await resp.json()) as AnthropicResponse;
    if (resp.status >= 400) {
      if (parsed.error?.message) {
        throw new Error(`llm error: ${parsed.error.message}`);
      }
      throw new Error(`llm error: status ${resp.status}`);
    }
    if (!parsed.content || parsed.content.length === 0) {
      throw new Error("llm response missing content");
    }
    const text = parsed.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!text) {
      throw new Error("llm response missing text");
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function chatLocalClaude(
  cfg: AgentConfig,
  model: string,
  messages: ChatMessage[],
): Promise<string> {
  const cliPath = cfg.base_url?.trim() || "claude";

  // Build prompt from messages
  const systemParts: string[] = [];
  const userMessages: string[] = [];
  for (const msg of messages) {
    const role = (msg.role ?? "").toLowerCase().trim();
    switch (role) {
      case "system":
        if (msg.content.trim()) systemParts.push(msg.content);
        break;
      case "user":
        userMessages.push(msg.content);
        break;
      case "assistant":
        userMessages.push(`[ASSISTANT]: ${msg.content}`);
        break;
      default:
        throw new Error(`unsupported message role "${msg.role}" for claude provider`);
    }
  }

  if (userMessages.length === 0) {
    throw new Error("llm request requires user messages");
  }

  // Build the full prompt for Claude CLI
  const fullPrompt = [
    ...systemParts.map((s) => `## System\n${s}`),
    ...userMessages.map((m, i) => {
      const isAssistant = m.startsWith("[ASSISTANT]:");
      const content = isAssistant ? m.slice(13) : m;
      return isAssistant
        ? `## Assistant\n${content}`
        : `## User\n${content}`;
    }),
  ].join("\n\n");

  const timeout = cfg.timeout_seconds ? cfg.timeout_seconds * 1000 : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    // Claude CLI: --print for non-interactive, --output-format json for JSON output
    const proc = Bun.spawn({
      cmd: [cliPath, "--print", "--output-format", "json", "--model", model],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      timeout,
      env: {
        ...process.env,
        // Disable tools for translation-only use
        CLAUDE_ALLOW_TOOLS: "",
      },
    });

    await proc.stdin.write(fullPrompt);
    proc.stdin.close();

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    if (proc.exitCode !== 0) {
      throw new Error(`claude CLI error (exit ${proc.exitCode}): ${stderr || "unknown error"}`);
    }

    // Parse JSON output from Claude CLI
    let result: { content?: { text?: string }[] };
    try {
      result = JSON.parse(stdout);
    } catch {
      // If not valid JSON, return raw output
      return stdout.trim();
    }

    const text = result.content?.map((b) => b.text || "").join("") || "";
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

async function chatLocalCodex(
  cfg: AgentConfig,
  model: string,
  messages: ChatMessage[],
): Promise<string> {
  const cliPath = cfg.base_url?.trim() || "codex";

  // Build prompt from messages
  const systemParts: string[] = [];
  const userMessages: string[] = [];
  for (const msg of messages) {
    const role = (msg.role ?? "").toLowerCase().trim();
    switch (role) {
      case "system":
        if (msg.content.trim()) systemParts.push(msg.content);
        break;
      case "user":
        userMessages.push(msg.content);
        break;
      case "assistant":
        userMessages.push(`[ASSISTANT]: ${msg.content}`);
        break;
      default:
        throw new Error(`unsupported message role "${msg.role}" for codex provider`);
    }
  }

  if (userMessages.length === 0) {
    throw new Error("llm request requires user messages");
  }

  // Build the full prompt for Codex CLI
  const fullPrompt = [
    ...systemParts.map((s) => `## System\n${s}`),
    ...userMessages.map((m, i) => {
      const isAssistant = m.startsWith("[ASSISTANT]:");
      const content = isAssistant ? m.slice(13) : m;
      return isAssistant
        ? `## Assistant\n${content}`
        : `## User\n${content}`;
    }),
  ].join("\n\n");

  const timeout = cfg.timeout_seconds ? cfg.timeout_seconds * 1000 : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    // Codex CLI: `codex exec` for non-interactive use
    const proc = Bun.spawn({
      cmd: [cliPath, "exec"],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      timeout,
    });

    await proc.stdin.write(fullPrompt);
    proc.stdin.close();

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    if (proc.exitCode !== 0) {
      throw new Error(`codex CLI error (exit ${proc.exitCode}): ${stderr || "unknown error"}`);
    }

    return stdout.trim();
  } finally {
    clearTimeout(timer);
  }
}
