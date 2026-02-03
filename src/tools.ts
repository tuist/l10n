export interface ToolSpec {
  name: string;
  category: string;
  description: string;
}

export const firstParty: ToolSpec[] = [
  {
    name: "Syntax validators",
    category: "Syntax",
    description: "Validate JSON, YAML, PO, and Markdown frontmatter syntax.",
  },
  {
    name: "Preserve checks",
    category: "Guards",
    description: "Ensure code blocks, inline code, URLs, and placeholders survive.",
  },
  {
    name: "Custom commands",
    category: "Extensions",
    description: "Run your linters or compilers via check_cmd/check_cmds.",
  },
];

export function toolsSummary(): string {
  return "syntax validators (JSON, YAML, PO, Markdown frontmatter), preserve checks (code blocks, inline code, URLs, placeholders), and optional custom commands";
}
