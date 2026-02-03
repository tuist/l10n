package plan

import "strings"

type Format string

const (
	FormatMarkdown Format = "markdown"
	FormatJSON     Format = "json"
	FormatYAML     Format = "yaml"
	FormatPO       Format = "po"
	FormatText     Format = "text"
)

func DetectFormat(path string) Format {
	switch strings.ToLower(strings.TrimPrefix(ext(path), ".")) {
	case "md", "markdown":
		return FormatMarkdown
	case "json":
		return FormatJSON
	case "yaml", "yml":
		return FormatYAML
	case "po":
		return FormatPO
	default:
		return FormatText
	}
}

func ext(path string) string {
	idx := strings.LastIndex(path, ".")
	if idx == -1 {
		return ""
	}
	return path[idx:]
}
