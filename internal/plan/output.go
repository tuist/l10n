package plan

import (
	"path/filepath"
	"strings"
)

type OutputValues struct {
	Lang     string
	RelPath  string
	BaseName string
	Ext      string
}

func ExpandOutput(template string, values OutputValues) string {
	out := template
	out = strings.ReplaceAll(out, "{lang}", values.Lang)
	out = strings.ReplaceAll(out, "{relpath}", filepath.ToSlash(values.RelPath))
	out = strings.ReplaceAll(out, "{basename}", values.BaseName)
	out = strings.ReplaceAll(out, "{ext}", values.Ext)
	out = filepath.FromSlash(out)
	return filepath.Clean(out)
}
