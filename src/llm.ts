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
        throw new Error(`unsupported message role "${msg.role}" for local-claude`);
    }
  }

  if (userMessages.length === 0) {
    throw new Error("llm request requires user messages");
  }

  const prompt = [
    ...systemParts.map((s) => `[SYSTEM]: ${s}`),
    ...userMessages.map((m) => m.startsWith("[ASSISTANT]:") ? m : `[USER]: ${m}`),
  ].join("\n\n");

  const timeout = cfg.timeout_seconds ? cfg.timeout_seconds * 1000 : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const proc = Bun.spawn({
      cmd: [cliPath, "ai", "-p", "--no-think"],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      timeout,
    });

    await proc.stdin.write(prompt);
    proc.stdin.close();

    const output = await new Response(proc.stdout).text();
    const error = await new Response(proc.stderr).text();

    if (proc.exitCode !== 0) {
      throw new Error(`claude CLI error (exit ${proc.exitCode}): ${error || "unknown error"}`);
    }

    return output.trim();
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
        throw new Error(`unsupported message role "${msg.role}" for local-codex`);
    }
  }

  if (userMessages.length === 0) {
    throw new Error("llm request requires user messages");
  }

  const prompt = [
    ...systemParts.map((s) => `[SYSTEM]: ${s}`),
    ...userMessages.map((m) => m.startsWith("[ASSISTANT]:") ? m : `[USER]: ${m}`),
  ].join("\n\n");

  const timeout = cfg.timeout_seconds ? cfg.timeout_seconds * 1000 : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const proc = Bun.spawn({
      cmd: [cliPath, "complete", "--prompt"],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      timeout,
    });

    await proc.stdin.write(prompt);
    proc.stdin.close();

    const output = await new Response(proc.stdout).text();
    const error = await new Response(proc.stderr).text();

    if (proc.exitCode !== 0) {
      throw new Error(`codex CLI error (exit ${proc.exitCode}): ${error || "unknown error"}`);
    }

    return output.trim();
  } finally {
    clearTimeout(timer);
  }
}
