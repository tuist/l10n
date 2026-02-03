package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/alecthomas/kong"

	"github.com/tuist/l10n/internal/app"
	"github.com/tuist/l10n/internal/ui"
)

type CLI struct {
	NoColor   bool         `help:"Disable color output."`
	Path      string       `help:"Run as if in this directory."`
	Init      InitCmd      `cmd:"" help:"Initialize l10n in this repo."`
	Translate TranslateCmd `cmd:"" help:"Generate translations."`
	Check     CheckCmd     `cmd:"" help:"Validate outputs."`
	Status    StatusCmd    `cmd:"" help:"Report missing or stale outputs."`
	Clean     CleanCmd     `cmd:"" help:"Remove generated outputs and lockfiles."`
}

type InitCmd struct{}

type TranslateCmd struct {
	Force    bool   `help:"Retranslate even if up to date."`
	Yolo     bool   `help:"Skip human review (default true)." default:"true"`
	Retries  int    `help:"Override retry count (-1 uses config or default)." default:"-1"`
	DryRun   bool   `help:"Print actions without writing files."`
	CheckCmd string `help:"Override external check command."`
}

type CheckCmd struct {
	CheckCmd string `help:"Override external check command."`
}

type StatusCmd struct{}

type CleanCmd struct {
	DryRun  bool `help:"Print actions without removing files."`
	Orphans bool `help:"Also remove outputs for sources no longer in config (from lockfiles)."`
}

type Context struct {
	Root     string
	Reporter app.Reporter
}

func (c *InitCmd) Run(ctx *Context) error {
	return app.Init(ctx.Root, app.InitOptions{Reporter: ctx.Reporter})
}

func (c *TranslateCmd) Run(ctx *Context) error {
	return app.Translate(ctx.Root, app.TranslateOptions{
		Force:    c.Force,
		Yolo:     c.Yolo,
		Retries:  c.Retries,
		DryRun:   c.DryRun,
		CheckCmd: c.CheckCmd,
		Reporter: ctx.Reporter,
	})
}

func (c *CheckCmd) Run(ctx *Context) error {
	return app.Check(ctx.Root, app.CheckOptions{
		CheckCmd: c.CheckCmd,
		Reporter: ctx.Reporter,
	})
}

func (c *StatusCmd) Run(ctx *Context) error {
	return app.Status(ctx.Root, app.StatusOptions{Reporter: ctx.Reporter})
}

func (c *CleanCmd) Run(ctx *Context) error {
	return app.Clean(ctx.Root, app.CleanOptions{
		DryRun:   c.DryRun,
		Orphans:  c.Orphans,
		Reporter: ctx.Reporter,
	})
}

func main() {
	var cli CLI
	parser := kong.Must(&cli,
		kong.Name("l10n"),
		kong.Description("Localize like you ship software."),
		kong.UsageOnError(),
	)
	ctx, err := parser.Parse(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}

	cwd, err := os.Getwd()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	baseDir, err := resolveBaseDir(cwd, cli.Path)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	root := app.FindRoot(baseDir)
	noColor := cli.NoColor || os.Getenv("NO_COLOR") != ""
	reporter := ui.NewRenderer(ui.Options{NoColor: noColor, Out: os.Stdout})

	if err := ctx.Run(&Context{Root: root, Reporter: reporter}); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func resolveBaseDir(cwd, override string) (string, error) {
	if strings.TrimSpace(override) == "" {
		return cwd, nil
	}
	path := override
	if !filepath.IsAbs(path) {
		path = filepath.Join(cwd, path)
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		path = filepath.Dir(path)
	}
	return path, nil
}
