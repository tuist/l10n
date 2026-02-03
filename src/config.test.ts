import { describe, expect, test } from "bun:test";
import {
  splitTomlFrontmatter,
  validateTranslateEntry,
  mergeLLM,
  resolveAgents,
  applyAgentDefaults,
  sourcePath,
} from "./config.js";

describe("splitTomlFrontmatter", () => {
  test("returns body only when no frontmatter", () => {
    const result = splitTomlFrontmatter("hello world");
    expect(result.hasFrontmatter).toBe(false);
    expect(result.body).toBe("hello world");
  });

  test("parses frontmatter and body", () => {
    const input = `+++
key = "value"
+++
body content`;
    const result = splitTomlFrontmatter(input);
    expect(result.hasFrontmatter).toBe(true);
    expect(result.frontmatter).toBe('key = "value"');
    expect(result.body).toBe("body content");
  });

  test("throws when closing +++ is missing", () => {
    expect(() => splitTomlFrontmatter("+++\nno closing")).toThrow("no closing +++");
  });
});

describe("sourcePath", () => {
  test("returns source when set", () => {
    expect(sourcePath({ source: "docs/*.md", path: "" })).toBe("docs/*.md");
  });

  test("falls back to path", () => {
    expect(sourcePath({ source: "", path: "files/*.json" })).toBe("files/*.json");
  });
});

describe("validateTranslateEntry", () => {
  test("throws when source is missing", () => {
    expect(() => validateTranslateEntry({ source: "", path: "" } as any)).toThrow(
      "requires source/path",
    );
  });

  test("throws when targets is empty", () => {
    expect(() =>
      validateTranslateEntry({
        source: "docs/*.md",
        targets: [],
        output: "out/{lang}/{relpath}",
      } as any),
    ).toThrow("has no targets");
  });

  test("throws when output is missing", () => {
    expect(() =>
      validateTranslateEntry({
        source: "docs/*.md",
        targets: ["es"],
        output: "",
      } as any),
    ).toThrow("has no output");
  });

  test("accepts valid entry", () => {
    expect(() =>
      validateTranslateEntry({
        source: "docs/*.md",
        targets: ["es", "de"],
        output: "i18n/{lang}/{relpath}",
        frontmatter: "preserve",
      } as any),
    ).not.toThrow();
  });

  test("throws on invalid frontmatter mode", () => {
    expect(() =>
      validateTranslateEntry({
        source: "docs/*.md",
        targets: ["es"],
        output: "out/{lang}/{relpath}",
        frontmatter: "invalid",
      } as any),
    ).toThrow("invalid frontmatter mode");
  });
});

describe("mergeLLM", () => {
  test("override replaces base values", () => {
    const base = { provider: "openai", base_url: "http://old" };
    const override = { provider: "anthropic" };
    const result = mergeLLM(base, override);
    expect(result.provider).toBe("anthropic");
    expect(result.base_url).toBe("http://old");
  });

  test("merges headers", () => {
    const base = { headers: { a: "1" } };
    const override = { headers: { b: "2" } };
    const result = mergeLLM(base, override);
    expect(result.headers).toEqual({ a: "1", b: "2" });
  });
});

describe("applyAgentDefaults", () => {
  test("defaults to openai provider", () => {
    const result = applyAgentDefaults({
      role: "coordinator",
      provider: "",
      base_url: "",
      chat_completions_path: "",
      api_key: "",
      api_key_env: "",
      model: "gpt-4o",
      headers: {},
      timeout_seconds: 0,
    });
    expect(result.provider).toBe("openai");
    expect(result.base_url).toBe("https://api.openai.com/v1");
    expect(result.chat_completions_path).toBe("/chat/completions");
    expect(result.api_key_env).toBe("OPENAI_API_KEY");
  });

  test("sets anthropic defaults", () => {
    const result = applyAgentDefaults({
      role: "translator",
      provider: "anthropic",
      base_url: "",
      chat_completions_path: "",
      api_key: "",
      api_key_env: "",
      model: "claude-opus-4-5-20251101",
      headers: {},
      timeout_seconds: 0,
    });
    expect(result.base_url).toBe("https://api.anthropic.com");
    expect(result.chat_completions_path).toBe("/v1/messages");
    expect(result.api_key_env).toBe("ANTHROPIC_API_KEY");
  });

  test("sets local-claude defaults", () => {
    const result = applyAgentDefaults({
      role: "coordinator",
      provider: "local-claude",
      base_url: "",
      chat_completions_path: "",
      api_key: "",
      api_key_env: "",
      model: "sonnet",
      headers: {},
      timeout_seconds: 120,
    });
    expect(result.provider).toBe("local-claude");
    expect(result.base_url).toBe("");
    expect(result.api_key).toBe("");
    expect(result.api_key_env).toBe("");
  });

  test("sets local-claude with custom path", () => {
    const result = applyAgentDefaults({
      role: "translator",
      provider: "local-claude",
      base_url: "/usr/local/bin/claude",
      chat_completions_path: "",
      api_key: "",
      api_key_env: "",
      model: "haiku",
      headers: {},
      timeout_seconds: 0,
    });
    expect(result.base_url).toBe("/usr/local/bin/claude");
  });

  test("sets local-codex defaults", () => {
    const result = applyAgentDefaults({
      role: "translator",
      provider: "local-codex",
      base_url: "",
      chat_completions_path: "",
      api_key: "",
      api_key_env: "",
      model: "gpt-4",
      headers: {},
      timeout_seconds: 0,
    });
    expect(result.provider).toBe("local-codex");
    expect(result.base_url).toBe("");
    expect(result.api_key).toBe("");
    expect(result.api_key_env).toBe("");
  });

  test("sets local-codex with custom path", () => {
    const result = applyAgentDefaults({
      role: "coordinator",
      provider: "local-codex",
      base_url: "/opt/codex/bin/codex",
      chat_completions_path: "",
      api_key: "",
      api_key_env: "",
      model: "claude-3-5-sonnet",
      headers: {},
      timeout_seconds: 60,
    });
    expect(result.base_url).toBe("/opt/codex/bin/codex");
  });
});

describe("resolveAgents", () => {
  test("resolves agents from config", () => {
    const { coordinator, translator } = resolveAgents({
      provider: "openai",
      api_key: "sk-test",
      agent: [
        { role: "coordinator", model: "gpt-4o-mini" },
        { role: "translator", model: "gpt-4o" },
      ],
    });
    expect(coordinator.model).toBe("gpt-4o-mini");
    expect(translator.model).toBe("gpt-4o");
    expect(coordinator.provider).toBe("openai");
    expect(translator.provider).toBe("openai");
  });

  test("translator falls through from coordinator", () => {
    const { coordinator, translator } = resolveAgents({
      provider: "anthropic",
      base_url: "https://api.anthropic.com",
      agent: [
        { role: "coordinator", model: "claude-3-haiku-20240307" },
        { role: "translator", model: "claude-opus-4-5-20251101" },
      ],
    });
    expect(translator.base_url).toBe("https://api.anthropic.com");
    expect(translator.provider).toBe("anthropic");
  });
});
