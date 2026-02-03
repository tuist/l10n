import yaml from "js-yaml";
import { parse as parseToml } from "@iarna/toml";
import { join } from "path";
import { mkdir, writeFile, unlink } from "fs/promises";
import type { Format } from "./format.js";
import type { Reporter } from "./reporter.js";

export interface CheckOptions {
  preserve?: string[];
  checkCmd?: string;
  checkCmds?: Record<string, string>;
  reporter?: Reporter;
  label?: string;
  current?: number;
  total?: number;
}

export class ToolError extends Error {
  tool: string;
  constructor(tool: string, err: Error | string) {
    const message = typeof err === "string" ? err : (err.message ?? String(err));
    super(`${tool} tool failed: ${message}`);
    this.tool = tool;
  }
}

const DEFAULT_PRESERVE = ["code_blocks", "inline_code", "urls", "placeholders"];

const codeBlockRe = /```[\s\S]*?```/g;
const inlineCodeRe = /`[^`\n]+`/g;
const urlRe = /https?:\/\/[^\s)"'<>]+/g;
const placeholderRe = /\{[^\s{}]+\}/g;

export async function validate(
  root: string,
  format: Format,
  output: string,
  source: string,
  opts: CheckOptions,
): Promise<void> {
  if (opts.reporter && opts.label?.trim()) {
    opts.reporter.activity("Validating", opts.current ?? 0, opts.total ?? 0, opts.label);
  }

  // Syntax validation
  if (opts.reporter) {
    opts.reporter.tool("syntax-validator", "parse " + formatLabel(format));
  }
  const syntaxErr = validateSyntax(format, output);
  if (syntaxErr) {
    throw new ToolError("syntax-validator", syntaxErr);
  }

  // Preserve checks
  const preserveKinds = resolvePreserve(opts.preserve);
  if (Object.keys(preserveKinds).length > 0) {
    if (opts.reporter) {
      opts.reporter.tool("preserve-check", "verify preserved tokens");
    }
    const preserveErr = validatePreserve(output, source, preserveKinds);
    if (preserveErr) {
      throw new ToolError("preserve-check", preserveErr);
    }
  }

  // Custom command
  const cmd = selectCheckCmd(format, opts.checkCmd, opts.checkCmds);
  if (cmd) {
    if (opts.reporter) {
      opts.reporter.tool("custom-command", "run check_cmd");
    }
    await runExternal(root, cmd, output);
  }
}

function validateSyntax(format: Format, output: string): string | null {
  switch (format) {
    case "json":
      try {
        JSON.parse(output);
      } catch (err: any) {
        return `json invalid: ${err.message}`;
      }
      break;
    case "yaml":
      try {
        yaml.load(output);
      } catch (err: any) {
        return `yaml invalid: ${err.message}`;
      }
      break;
    case "po":
      return validatePO(output);
    case "markdown":
      return validateMarkdown(output);
  }
  return null;
}

function validateMarkdown(content: string): string | null {
  const lines = content.split("\n");
  if (lines.length === 0) return null;
  const first = lines[0].trim();
  if (first !== "---" && first !== "+++") return null;

  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === first) {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return `markdown frontmatter missing closing ${first}`;
  }

  const frontmatter = lines.slice(1, end).join("\n");
  if (first === "---") {
    try {
      yaml.load(frontmatter);
    } catch (err: any) {
      return `markdown frontmatter invalid yaml: ${err.message}`;
    }
    return null;
  }

  try {
    parseToml(frontmatter);
  } catch (err: any) {
    return `markdown frontmatter invalid toml: ${err.message}`;
  }
  return null;
}

function validatePO(content: string): string | null {
  const lines = content.split("\n");
  let state = "";
  let hasMsgid = false;
  let hasMsgstr = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("msgid ")) {
      if (hasMsgid && !hasMsgstr) return "po entry missing msgstr";
      hasMsgid = true;
      hasMsgstr = false;
      state = "msgid";
      if (!hasQuotedString(line)) return "po msgid missing quoted string";
    } else if (line.startsWith("msgid_plural ")) {
      if (state !== "msgid") return "po msgid_plural without msgid";
      if (!hasQuotedString(line)) return "po msgid_plural missing quoted string";
    } else if (line.startsWith("msgstr")) {
      if (!hasMsgid) return "po msgstr without msgid";
      hasMsgstr = true;
      state = "msgstr";
      if (!hasQuotedString(line)) return "po msgstr missing quoted string";
    } else if (line.startsWith('"')) {
      if (!state) return "po stray quoted string";
    } else {
      return `po invalid line: ${line}`;
    }
  }
  if (hasMsgid && !hasMsgstr) return "po entry missing msgstr";
  return null;
}

function hasQuotedString(line: string): boolean {
  let count = 0;
  let escaped = false;
  for (const ch of line) {
    if (ch === "\\" && !escaped) {
      escaped = true;
      continue;
    }
    if (ch === '"' && !escaped) count++;
    escaped = false;
  }
  return count >= 2;
}

function resolvePreserve(preserve?: string[]): Record<string, boolean> {
  if (!preserve || preserve.length === 0) {
    return Object.fromEntries(DEFAULT_PRESERVE.map((k) => [k, true]));
  }
  for (const v of preserve) {
    if (v.trim().toLowerCase() === "none") return {};
  }
  return Object.fromEntries(preserve.map((k) => [k.trim().toLowerCase(), true]));
}

function extractPreservables(source: string, kinds: Record<string, boolean>): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  let text = source;

  if (kinds["code_blocks"]) {
    for (const match of text.matchAll(codeBlockRe)) {
      if (!seen.has(match[0])) {
        seen.add(match[0]);
        tokens.push(match[0]);
      }
    }
    text = text.replace(codeBlockRe, "");
  }
  if (kinds["inline_code"]) {
    for (const match of text.matchAll(inlineCodeRe)) {
      if (!seen.has(match[0])) {
        seen.add(match[0]);
        tokens.push(match[0]);
      }
    }
  }
  if (kinds["urls"]) {
    for (const match of text.matchAll(urlRe)) {
      if (!seen.has(match[0])) {
        seen.add(match[0]);
        tokens.push(match[0]);
      }
    }
  }
  if (kinds["placeholders"]) {
    for (const match of text.matchAll(placeholderRe)) {
      if (!seen.has(match[0])) {
        seen.add(match[0]);
        tokens.push(match[0]);
      }
    }
  }
  return tokens;
}

function validatePreserve(
  output: string,
  source: string,
  kinds: Record<string, boolean>,
): string | null {
  const preservables = extractPreservables(source, kinds);
  const missing: string[] = [];
  for (const token of preservables) {
    if (!output.includes(token)) {
      missing.push(token);
      if (missing.length >= 5) break;
    }
  }
  if (missing.length > 0) {
    return `preserved tokens missing from output: ${JSON.stringify(missing)}`;
  }
  return null;
}

function selectCheckCmd(format: Format, fallback?: string, cmds?: Record<string, string>): string {
  if (cmds) {
    const value = cmds[format];
    if (value?.trim()) return value;
  }
  return (fallback ?? "").trim();
}

function formatLabel(format: Format): string {
  switch (format) {
    case "json":
      return "JSON";
    case "yaml":
      return "YAML";
    case "po":
      return "PO";
    case "markdown":
      return "Markdown frontmatter";
    default:
      return format;
  }
}

async function runExternal(root: string, cmdTemplate: string, content: string): Promise<void> {
  if (!root) throw new Error("external check requires root path");

  const tmpDir = join(root, ".l10n", "tmp");
  await mkdir(tmpDir, { recursive: true });

  const tmpFile = join(tmpDir, `check-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
  await writeFile(tmpFile, content);

  try {
    const cmdText = cmdTemplate.replaceAll("{path}", tmpFile);
    const { execSync } = await import("child_process");
    try {
      execSync(cmdText, { cwd: root, stdio: "pipe" });
    } catch (err: any) {
      const output = (
        (err.stderr?.toString() ?? "") +
        "\n" +
        (err.stdout?.toString() ?? "")
      ).trim();
      throw new Error(`external check failed: ${err.message}\n${output}`);
    }
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}
