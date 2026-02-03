import type { Reporter, StatusKind, ProgressReporter } from "./reporter.js";

// ANSI color helpers
const ESC = "\x1b[";
const RESET = ESC + "0m";
const BOLD = ESC + "1m";

function ansi256fg(code: number): string {
  return `${ESC}38;5;${code}m`;
}

function style(text: string, ...codes: string[]): string {
  if (codes.length === 0) return text;
  return codes.join("") + text + RESET;
}

export interface RendererOptions {
  noColor: boolean;
  out: NodeJS.WritableStream;
}

export class Renderer implements Reporter {
  private out: NodeJS.WritableStream;
  private isTTY: boolean;
  private noColor: boolean;

  constructor(opts: RendererOptions) {
    this.out = opts.out ?? process.stdout;
    this.isTTY = typeof (this.out as any).isTTY === "boolean" ? (this.out as any).isTTY : false;
    this.noColor = opts.noColor || !this.isTTY;
  }

  info(message: string): void {
    if (!message.trim()) return;
    this.println(this.noColor ? message : style(message, ansi256fg(69)));
  }

  tool(name: string, detail: string): void {
    const label = this.noColor ? "Tool" : style("Tool", BOLD, ansi256fg(105));
    const toolName = this.noColor ? name : style(name, ansi256fg(244));
    let msg = `${label} (${toolName})`;
    if (detail.trim()) msg += ": " + detail;
    this.println(msg);
  }

  activity(stage: string, current: number, total: number, label: string): void {
    const line = formatActivityLine(stage, current, total, label);
    if (!this.isTTY || this.noColor) {
      this.println(line);
      return;
    }
    this.println(this.tintProgressLine(line, current, total));
  }

  status(kind: StatusKind, source: string, output: string, lang: string): void {
    let label: string;
    if (this.noColor) {
      label = kind;
    } else {
      switch (kind) {
        case "ok":
          label = style(kind, BOLD, ansi256fg(34));
          break;
        case "missing":
          label = style(kind, BOLD, ansi256fg(196));
          break;
        case "stale":
          label = style(kind, BOLD, ansi256fg(208));
          break;
        default:
          label = style(kind, ansi256fg(244));
      }
    }
    this.println(`${label} ${source} -> ${output} (${lang})`);
  }

  statusSummary(ok: number, stale: number, missing: number): void {
    const msg = `summary: ${ok} ok, ${stale} stale, ${missing} missing`;
    this.println(this.noColor ? msg : style(msg, BOLD));
  }

  cleanRemoved(path: string): void {
    const label = this.noColor ? "removed" : style("removed", BOLD, ansi256fg(34));
    this.println(`${label} ${path}`);
  }

  cleanMissing(path: string): void {
    const label = this.noColor ? "missing" : style("missing", BOLD, ansi256fg(208));
    this.println(`${label} ${path}`);
  }

  cleanSummary(removed: number, missing: number, lockRemoved: number): void {
    const msg = `cleaned ${removed} files, ${missing} missing, removed ${lockRemoved} lockfiles`;
    this.println(this.noColor ? msg : style(msg, BOLD));
  }

  progress(label: string, total: number): ProgressReporter {
    if (total <= 0) return { increment() {}, done() {} };
    return new ProgressReporterImpl(this, label, total);
  }

  private println(message: string): void {
    if (!message.trim()) return;
    this.out.write(message + "\n");
  }

  private tintProgressLine(line: string, current: number, total: number): string {
    if (this.noColor || total <= 0 || line.length === 0) return line;
    current = Math.max(0, Math.min(current, total));
    let activeLen = Math.round((line.length * current) / total);
    if (activeLen < 8) activeLen = Math.min(8, line.length);
    if (activeLen > line.length) activeLen = line.length;
    const active = style(line.slice(0, activeLen), BOLD, ansi256fg(252));
    const idle = style(line.slice(activeLen), ansi256fg(240));
    return active + idle;
  }
}

class ProgressReporterImpl implements ProgressReporter {
  private renderer: Renderer;
  private stage: string;
  private total: number;
  private current = 0;
  private label = "";

  constructor(renderer: Renderer, stage: string, total: number) {
    this.renderer = renderer;
    this.stage = stage;
    this.total = total;
  }

  increment(label: string): void {
    if (label) this.label = label;
    this.current++;
    this.renderer.activity(this.stage, this.current, this.total, this.label);
  }

  done(): void {
    this.current = this.total;
    this.renderer.activity(this.stage, this.current, this.total, this.label);
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  if (max <= 3) return value.slice(0, max);
  return value.slice(0, max - 3) + "...";
}

function formatActivityLine(stage: string, current: number, total: number, label: string): string {
  stage = (stage || "Working").trim();
  label = truncate(label, 80);
  if (label.trim() && !label.endsWith("...")) {
    label += " ...";
  }
  return `${stage} ${current}/${total} ${label}`;
}
