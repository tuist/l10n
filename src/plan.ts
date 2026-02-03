import { join, relative, dirname, basename, extname, sep, resolve } from "path";
import { readdir, stat, readFile } from "fs/promises";
import { minimatch } from "minimatch";
import {
  type L10NFile,
  type Entry,
  type TranslateEntry,
  type AgentConfig,
  parseFile,
  sourcePath,
  validateTranslateEntry,
  mergeLLM,
  resolveAgents,
  splitTomlFrontmatter,
} from "./config.js";
import { detectFormat, type Format } from "./format.js";
import { expandOutput } from "./output.js";

export interface Plan {
  root: string;
  l10nFiles: L10NFile[];
  sources: SourcePlan[];
}

export interface SourcePlan {
  sourcePath: string;
  absPath: string;
  basePath: string;
  relPath: string;
  format: Format;
  entry: Entry;
  contextBodies: string[];
  langContextBodies: Record<string, string[]>;
  contextPaths: string[];
  llm: LLMPlan;
  outputs: OutputPlan[];
}

export interface LLMPlan {
  coordinator: AgentConfig;
  translator: AgentConfig;
}

export interface OutputPlan {
  lang: string;
  outputPath: string;
}

export function contextPartsFor(source: SourcePlan, lang: string): string[] {
  const parts = [...source.contextBodies];
  if (source.langContextBodies?.[lang]) {
    parts.push(...source.langContextBodies[lang]);
  }
  return parts;
}

export async function buildPlan(root: string): Promise<Plan> {
  const l10nFiles = await discoverL10N(root);
  const entries = collectEntries(root, l10nFiles);
  const candidates = await resolveEntries(root, entries);

  const sources: SourcePlan[] = [];

  for (const [srcPath, cand] of Object.entries(candidates)) {
    const absPath = join(root, srcPath);
    const contextFiles = ancestorsFor(absPath, l10nFiles);
    const contextBodies: string[] = [];
    const contextPaths: string[] = [];
    const langContextBodies: Record<string, string[]> = {};
    let llmConfig = {} as any;

    for (const l10n of contextFiles) {
      if (l10n.body.trim()) {
        contextBodies.push(l10n.body);
        contextPaths.push(l10n.path);
      }
      for (const lang of cand.entry.targets ?? []) {
        const { body, ok } = await readLangContext(l10n.dir, lang);
        if (ok && body.trim()) {
          if (!langContextBodies[lang]) langContextBodies[lang] = [];
          langContextBodies[lang].push(body);
        }
      }
      llmConfig = mergeLLM(llmConfig, l10n.config.llm ?? {});
    }

    const { coordinator, translator } = resolveAgents(llmConfig);
    const resolvedLLM: LLMPlan = { coordinator, translator };

    const relPath = relative(cand.basePath, srcPath);

    const outputs: OutputPlan[] = [];
    for (const lang of cand.entry.targets ?? []) {
      const out = expandOutput(cand.entry.output, {
        lang,
        relpath: relPath,
        basename: basename(srcPath, extname(srcPath)),
        ext: extname(srcPath).replace(/^\./, ""),
      });
      outputs.push({ lang, outputPath: out });
    }

    sources.push({
      sourcePath: srcPath,
      absPath,
      basePath: cand.basePath,
      relPath,
      format: detectFormat(srcPath),
      entry: cand.entry,
      contextBodies,
      langContextBodies,
      contextPaths,
      llm: resolvedLLM,
      outputs,
    });
  }

  sources.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));

  return { root, l10nFiles, sources };
}

// ── Internals ──────────────────────────────────────────────────────────

interface Candidate {
  entry: Entry;
  basePath: string;
}

async function resolveEntries(root: string, entries: Entry[]): Promise<Record<string, Candidate>> {
  const candidates: Record<string, Candidate> = {};

  for (const entry of entries) {
    const { pattern, base } = entryPattern(root, entry);
    const matches = await globFiles(root, pattern);
    const excludes = await resolveExcludes(root, entry);

    for (const match of matches) {
      if (excludes.has(match)) continue;
      if (basename(match) === "L10N.md") continue;

      const full = join(root, match);
      let info;
      try {
        info = await stat(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) continue;

      if (candidates[match]) {
        if (shouldOverride(candidates[match].entry, entry)) {
          candidates[match] = { entry, basePath: base };
        }
      } else {
        candidates[match] = { entry, basePath: base };
      }
    }
  }

  return candidates;
}

function entryPattern(root: string, entry: Entry): { pattern: string; base: string } {
  let relDir = relative(root, entry.originDir);
  if (relDir === ".") relDir = "";

  const source = sourcePath(entry);
  const pattern = join(relDir, source).replaceAll(sep, "/");
  let base = globBase(pattern);
  if (base === ".") base = relDir || ".";

  return { pattern, base };
}

async function resolveExcludes(root: string, entry: Entry): Promise<Set<string>> {
  const excludes = new Set<string>();
  if (!entry.exclude || entry.exclude.length === 0) return excludes;

  let relDir = relative(root, entry.originDir);
  if (relDir === ".") relDir = "";

  for (const ex of entry.exclude) {
    const pattern = join(relDir, ex).replaceAll(sep, "/");
    const matches = await globFiles(root, pattern);
    for (const m of matches) excludes.add(m);
  }

  return excludes;
}

function shouldOverride(existing: Entry, candidate: Entry): boolean {
  if (candidate.originDepth > existing.originDepth) return true;
  if (candidate.originDepth === existing.originDepth && candidate.index > existing.index)
    return true;
  return false;
}

function collectEntries(root: string, l10nFiles: L10NFile[]): Entry[] {
  const entries: Entry[] = [];
  for (const file of l10nFiles) {
    for (let idx = 0; idx < file.config.translate.length; idx++) {
      const raw = file.config.translate[idx] as TranslateEntry;
      validateTranslateEntry(raw);
      entries.push({
        ...raw,
        source: raw.source || raw.path || "",
        path: raw.path || raw.source || "",
        targets: raw.targets ?? [],
        output: raw.output ?? "",
        exclude: raw.exclude ?? [],
        preserve: raw.preserve ?? [],
        frontmatter: raw.frontmatter || "preserve",
        check_cmd: raw.check_cmd ?? "",
        check_cmds: raw.check_cmds ?? {},
        originPath: file.path,
        originDir: file.dir,
        originDepth: file.depth,
        index: idx,
      });
    }
  }
  return entries;
}

async function discoverL10N(root: string): Promise<L10NFile[]> {
  const files: L10NFile[] = [];
  await walkDir(root, async (path) => {
    if (basename(path) !== "L10N.md") return;
    const parsed = await parseFile(path);
    files.push(parsed);
  });

  for (const file of files) {
    const relDir = relative(root, file.dir);
    if (relDir === "" || relDir === ".") {
      file.depth = 0;
    } else {
      file.depth = relDir.split(sep).length;
    }
  }

  files.sort((a, b) => a.depth - b.depth);
  return files;
}

function ancestorsFor(sourceAbs: string, l10nFiles: L10NFile[]): L10NFile[] {
  const ancestors = l10nFiles.filter((f) => isAncestor(f.dir, sourceAbs));
  ancestors.sort((a, b) => a.depth - b.depth);
  return ancestors;
}

function isAncestor(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return rel === "." || !rel.startsWith("..");
}

function globBase(pattern: string): string {
  const idx = pattern.search(/[*?[]/);
  if (idx === -1) return dirname(pattern);
  return dirname(pattern.slice(0, idx));
}

async function readLangContext(dir: string, lang: string): Promise<{ body: string; ok: boolean }> {
  const trimmed = lang.trim();
  if (!trimmed) throw new Error("empty language code");
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error(`invalid language code "${lang}"`);
  }
  const path = join(dir, "L10N", trimmed + ".md");
  try {
    const data = await readFile(path, "utf-8");
    const { body, hasFrontmatter } = splitTomlFrontmatter(data);
    if (hasFrontmatter) return { body, ok: true };
    return { body: data, ok: true };
  } catch (err: any) {
    if (err.code === "ENOENT") return { body: "", ok: false };
    throw err;
  }
}

async function walkDir(dir: string, callback: (path: string) => Promise<void>): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(full, callback);
    } else {
      await callback(full);
    }
  }
}

async function globFiles(root: string, pattern: string): Promise<string[]> {
  const results: string[] = [];
  await walkDir(root, async (fullPath) => {
    const rel = relative(root, fullPath).replaceAll(sep, "/");
    if (minimatch(rel, pattern, { dot: true })) {
      results.push(rel);
    }
  });
  return results;
}
