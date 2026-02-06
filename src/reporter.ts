export type Verb =
  | "Translating"
  | "Validating"
  | "Checking"
  | "Ok"
  | "Stale"
  | "Missing"
  | "Removed"
  | "Skipped"
  | "Translated"
  | "Cleaned"
  | "Created"
  | "Updated"
  | "Summary"
  | "Info"
  | "Dry run";

export interface ProgressReporter {
  increment(label: string): void;
  done(): void;
}

export interface Reporter {
  log(verb: Verb, message: string): void;
  step(verb: Verb, current: number, total: number, message: string): void;
  blank(): void;
  progress(verb: Verb, total: number): ProgressReporter;
}

class NoopProgress implements ProgressReporter {
  increment(_label: string): void {}
  done(): void {}
}

class NoopReporter implements Reporter {
  log(_verb: Verb, _message: string): void {}
  step(_verb: Verb, _current: number, _total: number, _message: string): void {}
  blank(): void {}
  progress(_verb: Verb, _total: number): ProgressReporter {
    return new NoopProgress();
  }
}

export function ensureReporter(reporter?: Reporter): Reporter {
  return reporter ?? new NoopReporter();
}
