import { join, dirname, resolve, relative, sep } from "path";
import { readFile, writeFile, stat, unlink, readdir, mkdir } from "fs/promises";
import { buildPlan, contextPartsFor, type SourcePlan } from "./plan.js";
import { hashBytes, hashString, hashStrings } from "./hash.js";
import { readLock, writeLock, lockPath, type LockFile } from "./locks.js";
import { validate } from "./checks.js";
import { translate } from "./agent.js";
import { ensureReporter, type Reporter } from "./reporter.js";
import { defaultLocales, localeLabel, localeNameByCode } from "./locales.js";

// ── FindRoot ───────────────────────────────────────────────────────────

export { findRoot } from "./root.js";

// ── Translate ──────────────────────────────────────────────────────────

export interface TranslateOptions {
  force?: boolean;
  yolo?: boolean;
  retries?: number;
  dryRun?: boolean;
  checkCmd?: string;
  reporter?: Reporter;
}

export async function translateCmd(root: string, opts: TranslateOptions): Promise<void> {
  const pl = await buildPlan(root);
  if (pl.sources.length === 0) throw new Error("no sources found");

  const reporter = ensureReporter(opts.reporter);

  interface TranslatePlan {
    source: SourcePlan;
    sourceBytes: Buffer;
    sourceHash: string;
    lock: LockFile;
    contextHashes: Record<string, string>;
    translate: Record<string, boolean>;
  }

  const plans: TranslatePlan[] = [];
  let total = 0;

  for (const source of pl.sources) {
    const sourceBytes = Buffer.from(await readFile(source.absPath));
    const sourceHash = hashBytes(sourceBytes);
    let lock = await readLock(root, source.sourcePath);
    if (!lock) {
      lock = {
        source_path: source.sourcePath,
        source_hash: "",
        outputs: {},
        updated_at: "",
      };
    }

    const contextHashes: Record<string, string> = {};
    const translateMap: Record<string, boolean> = {};

    for (const output of source.outputs) {
      const parts = contextPartsFor(source, output.lang);
      const contextHash = hashStrings(parts);
      contextHashes[output.lang] = contextHash;

      const outputAbs = join(root, output.outputPath);
      let missing = false;
      try {
        await stat(outputAbs);
      } catch (err: any) {
        if (err.code === "ENOENT") {
          missing = true;
        } else {
          throw err;
        }
      }

      const outputLock = lock.outputs[output.lang];
      const lockedContextHash = lockContextHash(lock, output.lang);
      const upToDate =
        !missing &&
        !!outputLock &&
        lock.source_hash === sourceHash &&
        outputLock.path === output.outputPath &&
        lockedContextHash === contextHash;

      if (!opts.force && upToDate) continue;
      translateMap[output.lang] = true;
      total++;
    }

    plans.push({
      source,
      sourceBytes,
      sourceHash,
      lock,
      contextHashes,
      translate: translateMap,
    });
  }

  if (total === 0) {
    reporter.log("Info", "no translations needed");
    return;
  }

  let current = 0;
  for (const planItem of plans) {
    let updated = false;
    for (const output of planItem.source.outputs) {
      if (!planItem.translate[output.lang]) continue;

      const label = `${planItem.source.sourcePath} -> ${output.outputPath} (${output.lang})`;
      const step = current + 1;
      reporter.step("Translating", step, total, label);

      if (opts.dryRun) {
        reporter.log("Dry run", label);
        current = step;
        continue;
      }

      let retries = opts.retries ?? -1;
      if (retries < 0 && planItem.source.entry.retries !== undefined) {
        retries = planItem.source.entry.retries;
      }
      if (retries < 0) retries = 2;

      let checkCmds = planItem.source.entry.check_cmds;
      if ((opts.checkCmd ?? "").trim()) {
        checkCmds = {};
      }

      const parts = contextPartsFor(planItem.source, output.lang);
      const translation = await translate({
        source: planItem.sourceBytes.toString("utf-8"),
        targetLang: output.lang,
        format: planItem.source.format,
        context: parts.join("\n\n"),
        preserve: planItem.source.entry.preserve ?? [],
        frontmatter: planItem.source.entry.frontmatter ?? "preserve",
        checkCmd: pickCheckCmd(opts.checkCmd, planItem.source.entry.check_cmd),
        checkCmds: checkCmds ?? {},
        toolReporter: reporter,
        progressLabel: label,
        progressCurrent: step,
        progressTotal: total,
        retries,
        coordinator: planItem.source.llm.coordinator,
        translator: planItem.source.llm.translator,
        root,
      });

      const outputAbs = join(root, output.outputPath);
      await mkdir(dirname(outputAbs), { recursive: true });
      await writeFile(outputAbs, translation);

      planItem.lock.source_hash = planItem.sourceHash;
      if (!planItem.lock.outputs) planItem.lock.outputs = {};
      planItem.lock.outputs[output.lang] = {
        path: output.outputPath,
        hash: hashString(translation),
        context_hash: planItem.contextHashes[output.lang],
        checked_at: new Date().toISOString(),
      };
      updated = true;
      current = step;
    }

    if (opts.dryRun || !updated) continue;
    await writeLock(root, planItem.source.sourcePath, planItem.lock);
  }
}

// ── Check ──────────────────────────────────────────────────────────────

export interface CheckOptions {
  checkCmd?: string;
  reporter?: Reporter;
}

export async function checkCmd(root: string, opts: CheckOptions): Promise<void> {
  const pl = await buildPlan(root);
  if (pl.sources.length === 0) throw new Error("no sources found");

  const reporter = ensureReporter(opts.reporter);
  let total = 0;
  for (const source of pl.sources) total += source.outputs.length;
  const progress = reporter.progress("Validating", total);

  try {
    for (const source of pl.sources) {
      const sourceBytes = await readFile(source.absPath, "utf-8");
      for (const output of source.outputs) {
        const outputAbs = join(root, output.outputPath);
        let outputBytes: string;
        try {
          outputBytes = await readFile(outputAbs, "utf-8");
        } catch (err: any) {
          if (err.code === "ENOENT") {
            throw new Error(`missing output: ${output.outputPath}`);
          }
          throw err;
        }

        let checkCmd = pickCheckCmd(opts.checkCmd, source.entry.check_cmd);
        let checkCmds = source.entry.check_cmds;
        if ((opts.checkCmd ?? "").trim()) {
          checkCmds = {};
        }

        const label = `${source.sourcePath} -> ${output.outputPath} (${output.lang})`;
        progress.increment(label);

        await validate(root, source.format, outputBytes, sourceBytes, {
          preserve: source.entry.preserve,
          checkCmd,
          checkCmds,
        });
      }
    }
  } finally {
    progress.done();
  }
}

// ── Status ─────────────────────────────────────────────────────────────

export interface StatusOptions {
  reporter?: Reporter;
}

export async function statusCmd(root: string, opts: StatusOptions): Promise<void> {
  const pl = await buildPlan(root);
  if (pl.sources.length === 0) throw new Error("no sources found");

  const reporter = ensureReporter(opts.reporter);
  let missing = 0;
  let stale = 0;
  let upToDate = 0;

  for (const source of pl.sources) {
    const sourceBytes = Buffer.from(await readFile(source.absPath));
    const sourceHash = hashBytes(sourceBytes);
    const lock = await readLock(root, source.sourcePath);

    for (const output of source.outputs) {
      const outputAbs = join(root, output.outputPath);
      const label = `${source.sourcePath} -> ${output.outputPath} (${output.lang})`;
      try {
        await stat(outputAbs);
      } catch (err: any) {
        if (err.code === "ENOENT") {
          missing++;
          reporter.log("Missing", label);
          continue;
        }
        throw err;
      }

      const contextHash = hashStrings(contextPartsFor(source, output.lang));
      if (!lock || lock.source_hash !== sourceHash) {
        stale++;
        reporter.log("Stale", label);
        continue;
      }
      const outputLock = lock.outputs[output.lang];
      if (!outputLock) {
        stale++;
        reporter.log("Stale", label);
        continue;
      }
      const lockedCtxHash = lockContextHash(lock, output.lang);
      if (lockedCtxHash !== contextHash) {
        stale++;
        reporter.log("Stale", label);
        continue;
      }
      if (outputLock.path !== output.outputPath) {
        stale++;
        reporter.log("Stale", label);
        continue;
      }
      upToDate++;
      reporter.log("Ok", label);
    }
  }

  reporter.log("Summary", `${upToDate} ok, ${stale} stale, ${missing} missing`);
  if (stale > 0 || missing > 0) {
    throw new Error("translations out of date");
  }
}

// ── Clean ──────────────────────────────────────────────────────────────

export interface CleanOptions {
  dryRun?: boolean;
  orphans?: boolean;
  reporter?: Reporter;
}

export async function cleanCmd(root: string, opts: CleanOptions): Promise<void> {
  const pl = await buildPlan(root);
  if (pl.sources.length === 0) throw new Error("no sources found");

  const reporter = ensureReporter(opts.reporter);
  const rootAbs = resolve(root);

  const planned = new Map<string, SourcePlan>();
  for (const source of pl.sources) {
    planned.set(source.sourcePath, source);
  }

  let removed = 0;
  let missingCount = 0;
  let lockRemoved = 0;

  for (const source of pl.sources) {
    for (const output of source.outputs) {
      const abs = resolveWithinRoot(rootAbs, output.outputPath);
      const result = await removePath(abs, opts.dryRun);
      if (result === "removed") {
        removed++;
        reporter.log("Removed", output.outputPath);
      } else if (result === "missing") {
        missingCount++;
        reporter.log("Skipped", output.outputPath + " (not found)");
      }
    }
    const lp = lockPath(root, source.sourcePath);
    const result = await removePath(lp, opts.dryRun);
    if (result === "removed") {
      lockRemoved++;
      reporter.log("Removed", lp);
    } else if (result === "missing") {
      missingCount++;
      reporter.log("Skipped", lp + " (not found)");
    }
  }

  if (opts.orphans) {
    const lockDir = join(root, ".l10n", "locks");
    await walkLocks(lockDir, async (path) => {
      if (!path.endsWith(".lock")) return;
      let lock: LockFile;
      try {
        const data = await readFile(path, "utf-8");
        lock = JSON.parse(data);
      } catch {
        return;
      }

      let sourcePath = (lock.source_path ?? "").trim();
      if (!sourcePath) {
        sourcePath = sourcePathFromLock(rootAbs, path);
      }
      if (planned.has(sourcePath)) return;

      for (const output of Object.values(lock.outputs ?? {})) {
        const abs = resolveWithinRoot(rootAbs, output.path);
        const result = await removePath(abs, opts.dryRun);
        if (result === "removed") {
          removed++;
          reporter.log("Removed", output.path);
        } else if (result === "missing") {
          missingCount++;
          reporter.log("Skipped", output.path + " (not found)");
        }
      }
      const result = await removePath(path, opts.dryRun);
      if (result === "removed") {
        lockRemoved++;
        reporter.log("Removed", path);
      } else if (result === "missing") {
        missingCount++;
        reporter.log("Skipped", path + " (not found)");
      }
    });
  }

  reporter.log(
    "Cleaned",
    `${removed} files removed, ${missingCount} not found, ${lockRemoved} lockfiles removed`,
  );
}

// ── Init ───────────────────────────────────────────────────────────────

export interface InitOptions {
  reporter?: Reporter;
}

export async function initCmd(root: string, opts: InitOptions): Promise<void> {
  const reporter = ensureReporter(opts.reporter);

  if (!process.stdin.isTTY) {
    throw new Error("init requires an interactive terminal");
  }

  const rootAbs = resolve(root);
  const l10nPath = join(rootAbs, "L10N.md");

  try {
    await stat(l10nPath);
    throw new Error(`L10N.md already exists at ${l10nPath}`);
  } catch (err: any) {
    if (err.code !== "ENOENT") throw err;
  }

  const locales = defaultLocales();
  const sourceLang = await promptSelect(
    "Source language",
    locales.map((l) => ({ value: l.code, label: localeLabel(l) })),
    "en",
  );
  if (!sourceLang) throw new Error("no source language selected");

  const targets = await promptMultiSelect(
    "Target languages",
    locales
      .filter((l) => l.code !== sourceLang)
      .map((l) => ({ value: l.code, label: localeLabel(l) })),
  );
  if (targets.length === 0) throw new Error("no target languages selected");

  const content = renderL10NTemplate(sourceLang, targets, locales);
  await writeFile(l10nPath, content);
  reporter.log("Created", "L10N.md");

  const gitignorePath = join(rootAbs, ".gitignore");
  if (await ensureLine(gitignorePath, "/.l10n/tmp")) {
    reporter.log("Updated", ".gitignore");
  }

  const attributesPath = join(rootAbs, ".gitattributes");
  if (await ensureLine(attributesPath, ".l10n/locks/** linguist-generated=true")) {
    reporter.log("Updated", ".gitattributes");
  }

  reporter.log("Info", "Next steps:");
  reporter.log("Info", "  1. Open L10N.md and uncomment the example config.");
  reporter.log("Info", "  2. Update source globs, targets, and output paths for your repo.");
  reporter.log("Info", "  3. Set OPENAI_API_KEY (or change the provider/model settings).");
  reporter.log("Info", "  4. Run `l10n translate` to generate drafts.");
}

// ── Helpers ────────────────────────────────────────────────────────────

function pickCheckCmd(flagCmd?: string, entryCmd?: string): string {
  if ((flagCmd ?? "").trim()) return flagCmd!;
  return entryCmd ?? "";
}

function lockContextHash(lock: LockFile, lang: string): string {
  if (lock.outputs?.[lang]?.context_hash) {
    return lock.outputs[lang].context_hash!;
  }
  return lock.context_hash ?? "";
}

function resolveWithinRoot(rootAbs: string, rel: string): string {
  if (!rel.trim()) throw new Error("empty path");
  if (resolve(rel) === rel) {
    throw new Error(`refusing to remove absolute path "${rel}"`);
  }
  const abs = resolve(join(rootAbs, rel));
  if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) {
    throw new Error(`refusing to remove path outside root: ${rel}`);
  }
  return abs;
}

async function removePath(
  path: string,
  dryRun?: boolean,
): Promise<"removed" | "missing" | "skipped"> {
  if (dryRun) return "skipped";
  try {
    await unlink(path);
    return "removed";
  } catch (err: any) {
    if (err.code === "ENOENT") return "missing";
    throw err;
  }
}

function sourcePathFromLock(rootAbs: string, lockFilePath: string): string {
  const base = join(rootAbs, ".l10n", "locks");
  const rel = relative(base, lockFilePath);
  return rel.replace(/\.lock$/, "").replaceAll(sep, "/");
}

async function walkLocks(dir: string, callback: (path: string) => Promise<void>): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkLocks(full, callback);
    } else {
      await callback(full);
    }
  }
}

async function ensureLine(path: string, line: string): Promise<boolean> {
  let content: string;
  try {
    content = await readFile(path, "utf-8");
  } catch (err: any) {
    if (err.code === "ENOENT") {
      await writeFile(path, line + "\n");
      return true;
    }
    throw err;
  }

  content = content.replaceAll("\r\n", "\n");
  for (const existing of content.split("\n")) {
    if (existing.trim() === line.trim()) return false;
  }

  if (!content.endsWith("\n")) content += "\n";
  content += line + "\n";
  await writeFile(path, content);
  return true;
}

function renderL10NTemplate(
  sourceLang: string,
  targets: string[],
  locales: { code: string; name: string }[],
): string {
  targets.sort();
  const names = localeNameByCode(locales);

  const sourceLabel = labelForLocale(sourceLang, names);
  const targetLabel = targets.map((t) => labelForLocale(t, names)).join(", ");

  let b = "";
  b += "+++\n";
  b += "# Example configuration (uncomment to enable)\n";
  b += "# [llm]\n";
  b += '# provider = "openai"\n';
  b += '# api_key = "{{env.OPENAI_API_KEY}}"\n';
  b += "#\n";
  b += "# [[llm.agent]]\n";
  b += '# role = "coordinator"\n';
  b += '# model = "gpt-4o-mini"\n';
  b += "#\n";
  b += "# [[llm.agent]]\n";
  b += '# role = "translator"\n';
  b += '# model = "gpt-4o"\n';
  b += "#\n";
  b += "# [[translate]]\n";
  b += '# source = "docs/**/*.md"\n';
  b += `# targets = ${formatTOMLArray(targets)}\n`;
  b += '# output = "docs/i18n/{lang}/{relpath}"\n';
  b += "+++\n\n";
  b += "Uncomment the example above, then describe your product and tone here.\n";
  b += `Source language: ${sourceLabel}.\n`;
  b += `Target languages: ${targetLabel}.\n`;
  b += "\n";
  return b;
}

function formatTOMLArray(values: string[]): string {
  if (values.length === 0) return "[]";
  return "[" + values.map((v) => `"${v}"`).join(", ") + "]";
}

function labelForLocale(code: string, names: Record<string, string>): string {
  const name = names[code];
  if (name?.trim()) return `${name} (${code})`;
  return code;
}

// ── Interactive prompts (simple readline-based, Node-compatible) ──────

interface SelectOption {
  value: string;
  label: string;
}

async function promptSelect(
  title: string,
  options: SelectOption[],
  defaultValue?: string,
): Promise<string> {
  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  console.error(`\n${title}:`);
  for (let i = 0; i < options.length; i++) {
    const marker = options[i].value === defaultValue ? " *" : "";
    console.error(`  ${i + 1}. ${options[i].label}${marker}`);
  }

  return new Promise<string>((resolve) => {
    rl.question(`Enter number [default: ${defaultValue ?? "1"}]: `, (answer) => {
      rl.close();
      const trimmed = answer.trim();
      if (!trimmed && defaultValue) {
        resolve(defaultValue);
        return;
      }
      const idx = parseInt(trimmed, 10) - 1;
      if (idx >= 0 && idx < options.length) {
        resolve(options[idx].value);
      } else if (defaultValue) {
        resolve(defaultValue);
      } else {
        resolve(options[0]?.value ?? "");
      }
    });
  });
}

async function promptMultiSelect(title: string, options: SelectOption[]): Promise<string[]> {
  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  console.error(`\n${title}:`);
  for (let i = 0; i < options.length; i++) {
    console.error(`  ${i + 1}. ${options[i].label}`);
  }

  return new Promise<string[]>((resolve) => {
    rl.question("Enter numbers (comma-separated): ", (answer) => {
      rl.close();
      const indices = answer
        .split(",")
        .map((s) => parseInt(s.trim(), 10) - 1)
        .filter((i) => i >= 0 && i < options.length);
      resolve(indices.map((i) => options[i].value));
    });
  });
}
