import type { Reporter, Verb, ProgressReporter } from "./reporter.js";

// ── ANSI helpers (standard 16-color) ────────────────────────────────

const ESC = "\x1b[";
const RESET = ESC + "0m";
const BOLD = ESC + "1m";
const GREEN = ESC + "32m";
const CYAN = ESC + "36m";
const YELLOW = ESC + "33m";
const RED = ESC + "31m";
const WHITE = ESC + "37m";
const CLEAR_LINE = ESC + "2K";

function verbColor(verb: Verb): string {
  switch (verb) {
    case "Ok":
    case "Translated":
    case "Removed":
    case "Cleaned":
    case "Created":
    case "Updated":
      return GREEN;
    case "Translating":
    case "Validating":
    case "Checking":
      return CYAN;
    case "Stale":
    case "Skipped":
    case "Dry run":
      return YELLOW;
    case "Missing":
      return RED;
    case "Summary":
    case "Info":
      return WHITE;
  }
}

const VERB_COL = 12;

function formatLine(verb: string, message: string, color: boolean): string {
  const padded = verb.padStart(VERB_COL);
  if (!color) return padded + "  " + message;
  const col = verbColor(verb as Verb);
  return BOLD + col + padded + RESET + "  " + message;
}

// ── Renderer ────────────────────────────────────────────────────────

export interface RendererOptions {
  noColor: boolean;
  out: NodeJS.WritableStream;
}

export class Renderer implements Reporter {
  private out: NodeJS.WritableStream;
  private isTTY: boolean;
  private color: boolean;
  private inPlaceLine = false;

  constructor(opts: RendererOptions) {
    this.out = opts.out ?? process.stdout;
    this.isTTY = typeof (this.out as any).isTTY === "boolean" ? (this.out as any).isTTY : false;
    this.color = !opts.noColor && this.isTTY;
  }

  log(verb: Verb, message: string): void {
    this.finalize();
    this.out.write(formatLine(verb, message, this.color) + "\n");
  }

  step(verb: Verb, current: number, total: number, message: string): void {
    const label = `[${current}/${total}] ${message}`;
    const line = formatLine(verb, label, this.color);

    if (this.isTTY) {
      if (this.inPlaceLine) {
        this.out.write("\r" + (this.color ? CLEAR_LINE : ""));
      }
      this.out.write(line);
      this.inPlaceLine = true;
    } else {
      this.out.write(line + "\n");
    }
  }

  blank(): void {
    this.finalize();
    this.out.write("\n");
  }

  progress(verb: Verb, total: number): ProgressReporter {
    if (total <= 0) return { increment() {}, done() {} };
    return new ProgressReporterImpl(this, verb, total);
  }

  private finalize(): void {
    if (this.inPlaceLine) {
      this.out.write("\n");
      this.inPlaceLine = false;
    }
  }
}

class ProgressReporterImpl implements ProgressReporter {
  private renderer: Renderer;
  private verb: Verb;
  private total: number;
  private current = 0;

  constructor(renderer: Renderer, verb: Verb, total: number) {
    this.renderer = renderer;
    this.verb = verb;
    this.total = total;
  }

  increment(label: string): void {
    this.current++;
    this.renderer.step(this.verb, this.current, this.total, label);
  }

  done(): void {
    this.current = this.total;
  }
}
