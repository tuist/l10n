#!/usr/bin/env node

import { resolve, isAbsolute, dirname } from "path";
import { statSync } from "fs";
import { findRoot } from "./root.js";
import { Renderer } from "./renderer.js";
import { initCmd, translateCmd, checkCmd, statusCmd, cleanCmd } from "./app.js";

// ── Argument parsing ───────────────────────────────────────────────────

interface ParsedArgs {
  command: string;
  noColor: boolean;
  path: string;
  force: boolean;
  yolo: boolean;
  retries: number;
  dryRun: boolean;
  checkCmd: string;
  orphans: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    command: "",
    noColor: false,
    path: "",
    force: false,
    yolo: true,
    retries: -1,
    dryRun: false,
    checkCmd: "",
    orphans: false,
    help: false,
  };

  const args = argv.slice(2);
  let i = 0;

  while (i < args.length) {
    const arg = args[i];
    switch (arg) {
      case "--no-color":
        result.noColor = true;
        break;
      case "--path":
        result.path = args[++i] ?? "";
        break;
      case "--force":
        result.force = true;
        break;
      case "--yolo":
        result.yolo = true;
        break;
      case "--no-yolo":
        result.yolo = false;
        break;
      case "--retries":
        result.retries = parseInt(args[++i] ?? "-1", 10);
        break;
      case "--dry-run":
        result.dryRun = true;
        break;
      case "--check-cmd":
        result.checkCmd = args[++i] ?? "";
        break;
      case "--orphans":
        result.orphans = true;
        break;
      case "--help":
      case "-h":
        result.help = true;
        break;
      default:
        if (!arg.startsWith("-") && !result.command) {
          result.command = arg;
        }
        break;
    }
    i++;
  }

  return result;
}

// ── Usage ──────────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`l10n - Localize like you ship software.

Usage:
  l10n <command> [flags]

Commands:
  init        Initialize l10n in this repo
  translate   Generate translations
  check       Validate outputs
  status      Report missing or stale outputs
  clean       Remove generated outputs and lockfiles

Global Flags:
  --no-color      Disable color output
  --path <dir>    Run as if in this directory
  -h, --help      Show this help message

Translate Flags:
  --force         Retranslate even if up to date
  --yolo          Skip human review (default true)
  --no-yolo       Enable human review
  --retries <n>   Override retry count (-1 uses config or default)
  --dry-run       Print actions without writing files
  --check-cmd <c> Override external check command

Check Flags:
  --check-cmd <c> Override external check command

Clean Flags:
  --dry-run       Print actions without removing files
  --orphans       Also remove outputs for sources no longer in config
`);
}

// ── Resolve base directory ─────────────────────────────────────────────

function resolveBaseDir(cwd: string, override: string): string {
  if (!override.trim()) return cwd;
  let path = override;
  if (!isAbsolute(path)) path = resolve(cwd, path);
  try {
    const info = statSync(path);
    if (!info.isDirectory()) path = dirname(path);
  } catch {
    // fall through
  }
  return path;
}

// ── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  if (parsed.help || !parsed.command) {
    printUsage();
    if (!parsed.command && !parsed.help) process.exit(2);
    return;
  }

  const cwd = process.cwd();
  const baseDir = resolveBaseDir(cwd, parsed.path);
  const root = findRoot(baseDir);
  const noColor = parsed.noColor || !!process.env.NO_COLOR;
  const reporter = new Renderer({ noColor, out: process.stdout });

  try {
    switch (parsed.command) {
      case "init":
        await initCmd(root, { reporter });
        break;
      case "translate":
        await translateCmd(root, {
          force: parsed.force,
          yolo: parsed.yolo,
          retries: parsed.retries,
          dryRun: parsed.dryRun,
          checkCmd: parsed.checkCmd,
          reporter,
        });
        break;
      case "check":
        await checkCmd(root, {
          checkCmd: parsed.checkCmd,
          reporter,
        });
        break;
      case "status":
        await statusCmd(root, { reporter });
        break;
      case "clean":
        await cleanCmd(root, {
          dryRun: parsed.dryRun,
          orphans: parsed.orphans,
          reporter,
        });
        break;
      default:
        console.error(`unknown command: ${parsed.command}`);
        printUsage();
        process.exit(2);
    }
  } catch (err: any) {
    console.error(err.message ?? err);
    process.exit(1);
  }
}

main();
