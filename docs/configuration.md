# Configuration

`l10n` reads configuration from `L10N.md` files. The root `L10N.md` defines translation entries, and deeper `L10N.md` files add more specific context. Deeper files take precedence when their globs overlap.

## Frontmatter

Use Hugo‑style TOML frontmatter (`+++`).

```toml
[llm]
provider = "openai"
api_key_env = "OPENAI_API_KEY"
# or api_key = "{{env.OPENAI_API_KEY}}"

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
```

## `[[translate]]` fields

- `source` / `path` (required): glob, relative to the `L10N.md` directory
- `targets` (required): list of target languages
- `output` (required): template for output paths
- `exclude` (optional): globs to skip
- `preserve` (optional): `code_blocks`, `inline_code`, `urls`, `placeholders`, or `none`
- `frontmatter` (optional): `preserve` or `translate` for Markdown
- `check_cmd` (optional): external command (use `{path}` placeholder)
- `check_cmds` (optional): map of format → command
- `retries` (optional): retry count when validation fails

`L10N.md` files are always excluded from translation, even if matched by a glob.

### Output placeholders

- `{lang}` — target locale
- `{relpath}` — path relative to glob base
- `{basename}` — filename without extension
- `{ext}` — extension without dot

Example:

```
source = "docs/guide/*.md"
output = "docs/i18n/{lang}/{relpath}"
```

`docs/guide/intro.md` → `docs/i18n/es/intro.md`

## Context inheritance

The translation context is built from the body of all ancestor `L10N.md` files (frontmatter excluded), from root to the nearest file.

You can add language‑specific context by placing files next to each `L10N.md`:

```
L10N.md
L10N/
  es.md
  ja.md
```

Language context is additive: general context + `L10N/<lang>.md` bodies (root → nearest). Context hashes are computed per language, so only affected languages are re‑translated.

## LLM configuration

You can configure the coordinator and translator independently. The translator inherits the coordinator provider and connection settings when its provider is not set.

```toml
[llm]
provider = "openai"
base_url = "https://api.openai.com/v1"
api_key_env = "OPENAI_API_KEY"
# or api_key = "{{env.OPENAI_API_KEY}}"

[[llm.agent]]
role = "coordinator"
model = "gpt-4o-mini"

[[llm.agent]]
role = "translator"
model = "gpt-4o"
```

You can override per agent:

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

Any LLM fields can be overridden per agent (`provider`, `base_url`, `chat_completions_path`, `api_key`, `api_key_env`, `headers`, `temperature`, `max_tokens`, `timeout_seconds`).

## Overrides

When multiple `[[translate]]` entries match the same source file:

- The deepest `L10N.md` wins.
- If two entries at the same depth overlap, the last entry wins.
