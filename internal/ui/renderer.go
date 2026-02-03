package ui

import (
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/charmbracelet/bubbles/progress"
	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"
	"golang.org/x/term"

	"github.com/tuist/l10n/internal/app"
)

type Options struct {
	NoColor bool
	Out     io.Writer
}

type Renderer struct {
	out     io.Writer
	isTTY   bool
	noColor bool
	styles  styles
}

type styles struct {
	info    lipgloss.Style
	ok      lipgloss.Style
	warn    lipgloss.Style
	error   lipgloss.Style
	label   lipgloss.Style
	tool    lipgloss.Style
	summary lipgloss.Style
}

func NewRenderer(opts Options) *Renderer {
	out := opts.Out
	if out == nil {
		out = os.Stdout
	}
	isTTY := term.IsTerminal(int(os.Stdout.Fd()))
	profile := termenv.EnvColorProfile()
	if opts.NoColor || !isTTY {
		profile = termenv.Ascii
	}
	lipgloss.SetColorProfile(profile)

	return &Renderer{
		out:     out,
		isTTY:   isTTY,
		noColor: opts.NoColor || profile == termenv.Ascii,
		styles: styles{
			info:    lipgloss.NewStyle().Foreground(lipgloss.Color("69")),
			ok:      lipgloss.NewStyle().Foreground(lipgloss.Color("34")).Bold(true),
			warn:    lipgloss.NewStyle().Foreground(lipgloss.Color("208")).Bold(true),
			error:   lipgloss.NewStyle().Foreground(lipgloss.Color("196")).Bold(true),
			label:   lipgloss.NewStyle().Foreground(lipgloss.Color("244")),
			tool:    lipgloss.NewStyle().Foreground(lipgloss.Color("105")).Bold(true),
			summary: lipgloss.NewStyle().Bold(true),
		},
	}
}

func (r *Renderer) Info(message string) {
	r.println(r.styles.info.Render(message))
}

func (r *Renderer) Tool(name, detail string) {
	label := r.styles.tool.Render("tool")
	msg := label + " " + r.styles.label.Render(name)
	if strings.TrimSpace(detail) != "" {
		msg += ": " + detail
	}
	r.println(msg)
}

func (r *Renderer) Status(kind app.StatusKind, source, output, lang string) {
	label := string(kind)
	style := r.styles.label
	switch kind {
	case app.StatusOK:
		style = r.styles.ok
	case app.StatusMissing:
		style = r.styles.error
	case app.StatusStale:
		style = r.styles.warn
	}
	msg := fmt.Sprintf("%s %s -> %s (%s)", style.Render(label), source, output, lang)
	r.println(msg)
}

func (r *Renderer) StatusSummary(ok, stale, missing int) {
	msg := fmt.Sprintf("summary: %d ok, %d stale, %d missing", ok, stale, missing)
	r.println(r.styles.summary.Render(msg))
}

func (r *Renderer) CleanRemoved(path string) {
	r.println(r.styles.ok.Render("removed") + " " + path)
}

func (r *Renderer) CleanMissing(path string) {
	r.println(r.styles.warn.Render("missing") + " " + path)
}

func (r *Renderer) CleanSummary(removed, missing, lockRemoved int) {
	msg := fmt.Sprintf("cleaned %d files, %d missing, removed %d lockfiles", removed, missing, lockRemoved)
	r.println(r.styles.summary.Render(msg))
}

func (r *Renderer) Progress(label string, total int) app.ProgressReporter {
	if total <= 0 {
		return noopProgress{}
	}
	return &progressReporter{
		out:     r.out,
		render:  r,
		total:   total,
		label:   label,
		enabled: r.isTTY,
		model: progress.New(
			progress.WithWidth(28),
			progress.WithDefaultGradient(),
		),
	}
}

func (r *Renderer) println(message string) {
	if strings.TrimSpace(message) == "" {
		return
	}
	fmt.Fprintln(r.out, message)
}

type progressReporter struct {
	out     io.Writer
	render  *Renderer
	model   progress.Model
	total   int
	current int
	label   string
	enabled bool
}

func (p *progressReporter) Increment(label string) {
	if label != "" {
		p.label = label
	}
	p.current++
	p.renderLine()
}

func (p *progressReporter) Done() {
	if !p.enabled {
		return
	}
	p.current = p.total
	p.renderLine()
}

func (p *progressReporter) renderLine() {
	if !p.enabled {
		line := fmt.Sprintf("%d/%d %s", p.current, p.total, p.label)
		p.render.Info(line)
		return
	}
	percent := float64(p.current) / float64(p.total)
	bar := p.model.ViewAs(percent)
	line := fmt.Sprintf("%s %d/%d %s", bar, p.current, p.total, truncate(p.label, 64))
	fmt.Fprintln(p.out, line)
}

type noopProgress struct{}

func (n noopProgress) Increment(string) {}
func (n noopProgress) Done()            {}

func truncate(value string, max int) string {
	if len(value) <= max {
		return value
	}
	if max <= 3 {
		return value[:max]
	}
	return value[:max-3] + "..."
}
