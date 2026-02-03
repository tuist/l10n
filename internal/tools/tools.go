package tools

type ToolSpec struct {
	Name        string
	Category    string
	Description string
}

var firstParty = []ToolSpec{
	{
		Name:        "Syntax validators",
		Category:    "Syntax",
		Description: "Validate JSON, YAML, PO, and Markdown frontmatter syntax.",
	},
	{
		Name:        "Preserve checks",
		Category:    "Guards",
		Description: "Ensure code blocks, inline code, URLs, and placeholders survive.",
	},
	{
		Name:        "Custom commands",
		Category:    "Extensions",
		Description: "Run your linters or compilers via check_cmd/check_cmds.",
	},
}

func FirstParty() []ToolSpec {
	out := make([]ToolSpec, len(firstParty))
	copy(out, firstParty)
	return out
}

func Summary() string {
	return "syntax validators (JSON, YAML, PO, Markdown frontmatter), preserve checks (code blocks, inline code, URLs, placeholders), and optional custom commands"
}
