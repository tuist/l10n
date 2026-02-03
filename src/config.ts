import { parse as parseToml } from "@iarna/toml";

// ── Types ──────────────────────────────────────────────────────────────

export interface AgentConfig {
  role: string;
  provider: string;
  base_url: string;
  chat_completions_path: string;
  api_key: string;
  api_key_env: string;
  model: string;
  temperature?: number;
  max_tokens?: number;
  headers: Record<string, string>;
  timeout_seconds: number;
}

export interface TranslateEntry {
  source: string;
  path: string;
  targets: string[];
  output: string;
  exclude: string[];
  preserve: string[];
  frontmatter: string;
  check_cmd: string;
  check_cmds: Record<string, string>;
  retries?: number;
}

export interface LLMConfig {
  provider: string;
  base_url: string;
  chat_completions_path: string;
  api_key: string;
  api_key_env: string;
  coordinator_model: string;
  translator_model: string;
  temperature?: number;
  max_tokens?: number;
  headers: Record<string, string>;
  timeout_seconds: number;
  agent: Partial<AgentConfig>[];
}

export interface L10NConfig {
  llm: Partial<LLMConfig>;
  translate: Partial<TranslateEntry>[];
}

export interface L10NFile {
  path: string;
  dir: string;
  depth: number;
  body: string;
  config: L10NConfig;
}

export interface Entry extends TranslateEntry {
  originPath: string;
  originDir: string;
  originDepth: number;
  index: number;
}

export const FRONTMATTER_PRESERVE = "preserve";
export const FRONTMATTER_TRANSLATE = "translate";

// ── Parsing ────────────────────────────────────────────────────────────

export function splitTomlFrontmatter(contents: string): {
  frontmatter: string;
  body: string;
  hasFrontmatter: boolean;
} {
  const lines = contents.split("\n");
  if (lines.length === 0 || lines[0].trim() !== "+++") {
    return { frontmatter: "", body: contents, hasFrontmatter: false };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "+++") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    throw new Error("frontmatter start found but no closing +++");
  }
  const frontmatter = lines.slice(1, end).join("\n");
  const body = lines.slice(end + 1).join("\n");
  return { frontmatter, body, hasFrontmatter: true };
}

export async function parseFile(path: string): Promise<L10NFile> {
  const contents = await Bun.file(path).text();
  const { frontmatter, body, hasFrontmatter } = splitTomlFrontmatter(contents);

  let config: L10NConfig = { llm: {}, translate: [] };
  if (hasFrontmatter) {
    const raw = parseToml(frontmatter) as any;
    config = {
      llm: raw.llm ?? {},
      translate: raw.translate ?? [],
    };
  }

  // Normalize translate entries
  config.translate = (config.translate ?? []).map((entry: any) => {
    const normalized = { ...entry };
    if (!normalized.source) {
      normalized.source = normalized.path ?? "";
    }
    if (!normalized.frontmatter) {
      normalized.frontmatter = "preserve";
    }
    return normalized;
  });

  const { resolve, dirname } = await import("path");
  const absPath = resolve(path);
  const dir = dirname(absPath);

  return { path: absPath, dir, depth: 0, body, config };
}

export function sourcePath(entry: Partial<TranslateEntry>): string {
  return (entry.source ?? "").trim() || (entry.path ?? "").trim();
}

// ── Validation ─────────────────────────────────────────────────────────

export function validateTranslateEntry(entry: Partial<TranslateEntry>): void {
  const sp = sourcePath(entry);
  if (!sp) {
    throw new Error("translate entry requires source/path");
  }
  if (!entry.targets || entry.targets.length === 0) {
    throw new Error(`translate entry "${sp}" has no targets`);
  }
  if (!(entry.output ?? "").trim()) {
    throw new Error(`translate entry "${sp}" has no output`);
  }
  if (
    entry.frontmatter &&
    entry.frontmatter !== FRONTMATTER_PRESERVE &&
    entry.frontmatter !== FRONTMATTER_TRANSLATE
  ) {
    throw new Error(`translate entry "${sp}" has invalid frontmatter mode "${entry.frontmatter}"`);
  }
}

// ── Merge ──────────────────────────────────────────────────────────────

export function mergeLLM(
  base: Partial<LLMConfig>,
  override: Partial<LLMConfig>,
): Partial<LLMConfig> {
  const out: Partial<LLMConfig> = { ...base };

  if ((override.provider ?? "").trim()) out.provider = override.provider;
  if ((override.base_url ?? "").trim()) out.base_url = override.base_url;
  if ((override.chat_completions_path ?? "").trim())
    out.chat_completions_path = override.chat_completions_path;
  if ((override.api_key ?? "").trim()) out.api_key = override.api_key;
  if ((override.api_key_env ?? "").trim()) out.api_key_env = override.api_key_env;
  if ((override.coordinator_model ?? "").trim()) out.coordinator_model = override.coordinator_model;
  if ((override.translator_model ?? "").trim()) out.translator_model = override.translator_model;
  if (override.temperature !== undefined) out.temperature = override.temperature;
  if (override.max_tokens !== undefined) out.max_tokens = override.max_tokens;
  if (override.timeout_seconds) out.timeout_seconds = override.timeout_seconds;

  if (override.headers && Object.keys(override.headers).length > 0) {
    out.headers = { ...(out.headers ?? {}), ...override.headers };
  }

  out.agent = mergeAgentsList(out.agent ?? [], override.agent ?? []);

  return out;
}

function mergeAgentsList(
  base: Partial<AgentConfig>[],
  override: Partial<AgentConfig>[],
): Partial<AgentConfig>[] {
  if (override.length === 0) return base;
  const out = [...base];
  for (const agent of override) {
    const role = (agent.role ?? "").toLowerCase().trim();
    let replaced = false;
    if (role) {
      for (let i = 0; i < out.length; i++) {
        if ((out[i].role ?? "").toLowerCase().trim() === role) {
          out[i] = agent;
          replaced = true;
          break;
        }
      }
    }
    if (!replaced) {
      out.push(agent);
    }
  }
  return out;
}

function mergeAgentConfig(base: AgentConfig, override: Partial<AgentConfig>): AgentConfig {
  const out = { ...base };
  if ((override.provider ?? "").trim()) out.provider = override.provider!;
  if ((override.base_url ?? "").trim()) out.base_url = override.base_url!;
  if ((override.chat_completions_path ?? "").trim())
    out.chat_completions_path = override.chat_completions_path!;
  if ((override.api_key ?? "").trim()) out.api_key = override.api_key!;
  if ((override.api_key_env ?? "").trim()) out.api_key_env = override.api_key_env!;
  if ((override.model ?? "").trim()) out.model = override.model!;
  if (override.temperature !== undefined) out.temperature = override.temperature;
  if (override.max_tokens !== undefined) out.max_tokens = override.max_tokens;
  if (override.timeout_seconds) out.timeout_seconds = override.timeout_seconds;
  if (override.headers && Object.keys(override.headers).length > 0) {
    out.headers = { ...out.headers, ...override.headers };
  }
  return out;
}

function emptyAgent(): AgentConfig {
  return {
    role: "",
    provider: "",
    base_url: "",
    chat_completions_path: "",
    api_key: "",
    api_key_env: "",
    model: "",
    temperature: undefined,
    max_tokens: undefined,
    headers: {},
    timeout_seconds: 0,
  };
}

export function applyAgentDefaults(cfg: AgentConfig): AgentConfig {
  const out = { ...cfg };
  let provider = (out.provider ?? "").trim();
  if (!provider) provider = "openai";
  out.provider = provider;

  switch (provider) {
    case "openai":
      if (!(out.chat_completions_path ?? "").trim())
        out.chat_completions_path = "/chat/completions";
      if (!(out.base_url ?? "").trim()) out.base_url = "https://api.openai.com/v1";
      if (!(out.api_key_env ?? "").trim()) out.api_key_env = "OPENAI_API_KEY";
      break;
    case "vertex":
      if (!(out.chat_completions_path ?? "").trim())
        out.chat_completions_path = "/chat/completions";
      break;
    case "anthropic":
      if (!(out.chat_completions_path ?? "").trim()) out.chat_completions_path = "/v1/messages";
      if (!(out.base_url ?? "").trim()) out.base_url = "https://api.anthropic.com";
      if (!(out.api_key_env ?? "").trim()) out.api_key_env = "ANTHROPIC_API_KEY";
      break;
    case "local-claude":
    case "claude":
      // No API key needed for local Claude CLI
      out.base_url = out.base_url?.trim() || "";
      out.api_key = "";
      out.api_key_env = "";
      break;
    case "local-codex":
    case "codex":
      // No API key needed for local Codex CLI
      out.base_url = out.base_url?.trim() || "";
      out.api_key = "";
      out.api_key_env = "";
      break;
  }

  return out;
}

export function resolveAgents(cfg: Partial<LLMConfig>): {
  coordinator: AgentConfig;
  translator: AgentConfig;
} {
  const agents = cfg.agent ?? [];
  const byRole: Record<string, Partial<AgentConfig>> = {};
  for (const agent of agents) {
    const role = (agent.role ?? "").toLowerCase().trim();
    if (!role) throw new Error("llm.agent requires role");
    if (role !== "coordinator" && role !== "translator") {
      throw new Error(`unknown llm.agent role "${agent.role}"`);
    }
    byRole[role] = agent;
  }

  const base: AgentConfig = {
    ...emptyAgent(),
    provider: cfg.provider ?? "",
    base_url: cfg.base_url ?? "",
    chat_completions_path: cfg.chat_completions_path ?? "",
    api_key: cfg.api_key ?? "",
    api_key_env: cfg.api_key_env ?? "",
    temperature: cfg.temperature,
    max_tokens: cfg.max_tokens,
    headers: { ...(cfg.headers ?? {}) },
    timeout_seconds: cfg.timeout_seconds ?? 0,
  };

  let coordinator = mergeAgentConfig(base, byRole["coordinator"] ?? {});
  if (!(coordinator.model ?? "").trim()) {
    coordinator.model = cfg.coordinator_model ?? "";
  }
  coordinator = applyAgentDefaults(coordinator);

  let translator = mergeAgentConfig(base, byRole["translator"] ?? {});
  if (!(translator.model ?? "").trim()) {
    translator.model = cfg.translator_model ?? "";
  }

  // Fall through from coordinator
  if (!(translator.provider ?? "").trim()) translator.provider = coordinator.provider;
  if (!(translator.base_url ?? "").trim()) translator.base_url = coordinator.base_url;
  if (!(translator.chat_completions_path ?? "").trim())
    translator.chat_completions_path = coordinator.chat_completions_path;
  if (!(translator.api_key ?? "").trim()) translator.api_key = coordinator.api_key;
  if (!(translator.api_key_env ?? "").trim()) translator.api_key_env = coordinator.api_key_env;
  if (translator.temperature === undefined) translator.temperature = coordinator.temperature;
  if (translator.max_tokens === undefined) translator.max_tokens = coordinator.max_tokens;
  if (!translator.timeout_seconds) translator.timeout_seconds = coordinator.timeout_seconds;
  if (!translator.headers || Object.keys(translator.headers).length === 0) {
    translator.headers = { ...(coordinator.headers ?? {}) };
  } else {
    translator.headers = {
      ...(coordinator.headers ?? {}),
      ...translator.headers,
    };
  }

  translator = applyAgentDefaults(translator);

  return { coordinator, translator };
}
