# LLM Providers

`l10n` uses OpenAI‑compatible Chat Completions APIs. Configure providers in `L10N.md` under `[llm]`.

## OpenAI‑compatible

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

### Per‑agent providers

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

## Vertex AI (OpenAI‑compatible)

Vertex AI exposes a `chat.completions` endpoint compatible with OpenAI. Provide your endpoint base URL and auth header.

```toml
[llm]
provider = "vertex"
base_url = "https://aiplatform.googleapis.com/v1/projects/PROJECT/locations/LOCATION/endpoints/ENDPOINT"
api_key_env = "VERTEX_ACCESS_TOKEN"
# or api_key = "{{env.VERTEX_ACCESS_TOKEN}}"

[[llm.agent]]
role = "coordinator"
model = "gemma-2"

[[llm.agent]]
role = "translator"
model = "gemma-2"

[llm.headers]
"x-goog-user-project" = "PROJECT"
```

`chat_completions_path` defaults to `/chat/completions`.

Header values support `env:VAR` and `{{env.VAR}}` interpolation.

## Anthropic

Anthropic uses the Messages API with `x-api-key` authentication and requires an `anthropic-version` header.

```toml
[llm]
provider = "anthropic"
api_key_env = "ANTHROPIC_API_KEY"
# or api_key = "{{env.ANTHROPIC_API_KEY}}"
max_tokens = 4096

[[llm.agent]]
role = "coordinator"
model = "claude-opus-4-5"

[[llm.agent]]
role = "translator"
model = "claude-opus-4-5"

[llm.headers]
anthropic-version = "2023-06-01"
```

## Custom

```toml
[llm]
provider = "custom"
base_url = "http://localhost:11434/v1"
api_key_env = "LOCALAI_KEY"
# or api_key = "{{env.LOCALAI_KEY}}"

[[llm.agent]]
role = "coordinator"
model = "local-model"

[[llm.agent]]
role = "translator"
model = "local-model"
```
