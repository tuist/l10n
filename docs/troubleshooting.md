# Troubleshooting

## Missing outputs

`l10n check` fails if any expected output file is missing. Run:

```bash
l10n translate
```

## Invalid JSON/YAML/PO

The built‑in validators reject outputs that don’t parse. The CLI retries with the validation error in the prompt (default 2 retries). Increase with `--retries` or per‑entry `retries`.

## External check failed

If `check_cmd` or `check_cmds` is configured, the command must exit successfully. Use `{path}` in the command template to reference the temporary file.

## No sources found

Ensure your root `L10N.md` includes at least one `[[translate]]` entry and that the glob matches existing files.

## Missing model configuration

If you see `translator model is required`, add a translator model in `L10N.md` (via `[[llm.agent]]` or `translator_model`).
