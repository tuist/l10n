package app

type StatusKind string

const (
	StatusOK      StatusKind = "ok"
	StatusStale   StatusKind = "stale"
	StatusMissing StatusKind = "missing"
)

type ProgressReporter interface {
	Increment(label string)
	Done()
}

type Reporter interface {
	Info(message string)
	Status(kind StatusKind, source, output, lang string)
	StatusSummary(ok, stale, missing int)
	CleanRemoved(path string)
	CleanMissing(path string)
	CleanSummary(removed, missing, lockRemoved int)
	Progress(label string, total int) ProgressReporter
}

type noopReporter struct{}

func (n noopReporter) Info(string)                               {}
func (n noopReporter) Status(StatusKind, string, string, string) {}
func (n noopReporter) StatusSummary(int, int, int)               {}
func (n noopReporter) CleanRemoved(string)                       {}
func (n noopReporter) CleanMissing(string)                       {}
func (n noopReporter) CleanSummary(int, int, int)                {}
func (n noopReporter) Progress(string, int) ProgressReporter     { return noopProgress{} }

type noopProgress struct{}

func (n noopProgress) Increment(string) {}
func (n noopProgress) Done()            {}

func ensureReporter(reporter Reporter) Reporter {
	if reporter == nil {
		return noopReporter{}
	}
	return reporter
}
