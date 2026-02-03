# l10n

Localize like you ship software. `l10n` is a Go CLI that translates files locally using LLMs, keeps content in‑repo, and validates output with your own tooling.

## Install

```bash
mise use github:tuist/l10n
```

Or build from source:

```bash
go build ./cmd/l10n
```

## Quick start

Create a `L10N.md` at the repo root with TOML frontmatter:

```markdown
+++
[llm]
provider = "openai"

[[llm.agent]]
role = "coordinator"
model = "gpt-4o-mini"

[[llm.agent]]
role = "translator"
model = "gpt-4o"

[[translate]]
source = "docs/*.md"
targets = ["es", "de"]
output = "docs/i18n/{lang}/{relpath}"
+++

Project context for translators goes here.
```

Translate:

```bash
l10n translate
```

Check what’s stale:

```bash
l10n status
```

Validate outputs:

```bash
l10n check
```

## Configuration

### `L10N.md` frontmatter

- `[[translate]]` entries (required)
  - `source` or `path` (required): glob, relative to the `L10N.md` directory
  - `targets` (required): list of locales
  - `output` (required): template using `{lang}`, `{relpath}`, `{basename}`, `{ext}`
  - `exclude` (optional): list of globs to skip
  - `preserve` (optional): list of preserve categories (`code_blocks`, `inline_code`, `urls`, `placeholders`, or `none`)
  - `frontmatter` (optional): `preserve` or `translate` (Markdown only)
  - `check_cmd` (optional): external check command template (uses `{path}`)
  - `check_cmds` (optional): map of format → command
  - `retries` (optional): retry count when validation fails

### LLM config

```toml
[llm]
provider = "openai" # openai | vertex | anthropic | custom
base_url = "https://api.openai.com/v1" # optional for openai
api_key_env = "OPENAI_API_KEY"
# or api_key = "{{env.OPENAI_API_KEY}}"

[[llm.agent]]
role = "coordinator"
model = "gpt-4o-mini"

[[llm.agent]]
role = "translator"
model = "gpt-4o"

[llm.headers]
# Authorization = "Bearer env:YOUR_TOKEN"
```

You can also set different providers per agent:

```toml
[[llm.agent]]
role = "coordinator"
provider = "vertex"
base_url = "https://aiplatform.googleapis.com/v1/projects/PROJECT/locations/LOCATION/endpoints/ENDPOINT"
model = "gemma-2"

[[llm.agent]]
role = "translator"
provider = "openai"
model = "gpt-4o"
```

If the translator provider is omitted, it inherits the coordinator provider and connection settings.

- `provider = "vertex"` uses the OpenAI‑compatible `chat.completions` endpoint.
- `provider = "anthropic"` uses the Messages API (`/v1/messages`) and `x-api-key` auth.
- `chat_completions_path` defaults to `/chat/completions` (OpenAI/Vertex) or `/v1/messages` (Anthropic).

### Output paths

`{relpath}` is the path relative to the source glob’s base directory. Example:

```
source = "docs/guide/*.md"
output = "docs/i18n/{lang}/{relpath}"
```

`docs/guide/intro.md` → `docs/i18n/es/intro.md`

### Language‑specific context

Add optional language context next to any `L10N.md`:

```
L10N.md
L10N/
  es.md
  ja.md
```

Context is additive per language: general `L10N.md` bodies plus matching `L10N/<lang>.md` bodies from root to nearest.

### Translation state

Per‑file lockfiles are written to `.l10n/locks/` and include source hash plus per‑language context hashes and output metadata.

## Commands

- `l10n translate` — generate translations (YOLO by default)
- `l10n check` — validate outputs (fails if missing)
- `l10n status` — report missing/stale outputs
- `l10n clean` — remove generated outputs and lockfiles (`--orphans` removes outputs from stale lockfiles)

Use `--no-color` or set `NO_COLOR=1` to disable styled output.

## Development

```bash
go test ./...
```

For the website:

```bash
cd site
npm install
npm run dev
```

## License

MIT
