export type StatusKind = "ok" | "stale" | "missing";

export interface ProgressReporter {
  increment(label: string): void;
  done(): void;
}

export interface Reporter {
  info(message: string): void;
  tool(name: string, detail: string): void;
  activity(stage: string, current: number, total: number, label: string): void;
  status(kind: StatusKind, source: string, output: string, lang: string): void;
  statusSummary(ok: number, stale: number, missing: number): void;
  cleanRemoved(path: string): void;
  cleanMissing(path: string): void;
  cleanSummary(removed: number, missing: number, lockRemoved: number): void;
  progress(label: string, total: number): ProgressReporter;
}

class NoopProgress implements ProgressReporter {
  increment(_label: string): void {}
  done(): void {}
}

class NoopReporter implements Reporter {
  info(_message: string): void {}
  tool(_name: string, _detail: string): void {}
  activity(_stage: string, _current: number, _total: number, _label: string): void {}
  status(_kind: StatusKind, _source: string, _output: string, _lang: string): void {}
  statusSummary(_ok: number, _stale: number, _missing: number): void {}
  cleanRemoved(_path: string): void {}
  cleanMissing(_path: string): void {}
  cleanSummary(_removed: number, _missing: number, _lockRemoved: number): void {}
  progress(_label: string, _total: number): ProgressReporter {
    return new NoopProgress();
  }
}

export function ensureReporter(reporter?: Reporter): Reporter {
  return reporter ?? new NoopReporter();
}
