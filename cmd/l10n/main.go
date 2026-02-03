package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/tuist/l10n/internal/app"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}

	cwd, err := os.Getwd()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	root := app.FindRoot(cwd)

	switch os.Args[1] {
	case "translate":
		fs := flag.NewFlagSet("translate", flag.ExitOnError)
		force := fs.Bool("force", false, "retranslate even if up to date")
		yolo := fs.Bool("yolo", true, "skip human review (default true)")
		retries := fs.Int("retries", -1, "override retry count (-1 uses config or default)")
		dryRun := fs.Bool("dry-run", false, "print actions without writing files")
		checkCmd := fs.String("check-cmd", "", "override external check command")
		_ = fs.Parse(os.Args[2:])

		if err := app.Translate(root, app.TranslateOptions{
			Force:    *force,
			Yolo:     *yolo,
			Retries:  *retries,
			DryRun:   *dryRun,
			CheckCmd: *checkCmd,
		}); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "check":
		fs := flag.NewFlagSet("check", flag.ExitOnError)
		checkCmd := fs.String("check-cmd", "", "override external check command")
		_ = fs.Parse(os.Args[2:])

		if err := app.Check(root, app.CheckOptions{CheckCmd: *checkCmd}); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "status":
		if err := app.Status(root, app.StatusOptions{}); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "clean":
		fs := flag.NewFlagSet("clean", flag.ExitOnError)
		dryRun := fs.Bool("dry-run", false, "print actions without removing files")
		orphans := fs.Bool("orphans", false, "also remove outputs for sources no longer in config (from lockfiles)")
		_ = fs.Parse(os.Args[2:])

		if err := app.Clean(root, app.CleanOptions{DryRun: *dryRun, Orphans: *orphans}); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "help", "-h", "--help":
		usage()
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n", os.Args[1])
		usage()
		os.Exit(2)
	}
}

func usage() {
	name := filepath.Base(os.Args[0])
	fmt.Printf(`%s translate [options]
%s check [options]
%s status
%s clean [options]

`, name, name, name, name)
}
