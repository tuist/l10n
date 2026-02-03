---
date: 2026-02-03
topic: l10n-cli
---

# L10N CLI + Site Brainstorm

## What We're Building
We are building a Go CLI named `l10n` that translates local files using LLMs, with configuration defined in `L10N.md` TOML frontmatter (Hugo-style `+++` fences). The CLI detects when translations are needed by hashing the source file content plus the body of all ancestor `L10N.md` files (root to nearest). It defaults to whole-file translation (no chunking), validates outputs via built-in parsers and optional external checks, and retries on validation failures. We will also ship a single-page Eleventy marketing site, localized using the same `L10N.md` convention, with a primary CTA to install via `mise use github:tuist/l10n`.

The home page includes: problem + Tuist story, how it works, config example, features list, FAQ/roadmap/license, plus a blog updates section with one initial English post (to be translated by the tool). Supported formats are Markdown, JSON, YAML, and PO, but treated as raw text with syntax validation afterward.

## Why This Approach
We selected an agent-first pipeline (Approach B) to keep the surface area small while making the translation flow extensible. The coordinator model can invoke a built-in “check” tool (and optional external commands) to validate output and guide retries. This lets us add a reviewer model or richer tooling later without rewriting the workflow. The configuration stays lightweight (Markdown + TOML frontmatter), aligns with developer workflows, and supports contextual inheritance as users navigate deeper directory structures.

## Key Decisions
- Config lives in `L10N.md` TOML frontmatter using `[[translate]]` entries; no global defaults.
- `[[translate]]` entries are merged across nested `L10N.md`; deeper entries take precedence when globs overlap.
- Translation-needed hash includes source content + ancestor `L10N.md` bodies (frontmatter excluded).
- Invalid output handling: retry with error feedback (configurable), default retry policy enabled.
- Raw-text translation for all file types, then validate; whole-file translation only; fail if too large.
- Preserve code blocks, inline code, URLs, and placeholders by default; configurable. Markdown frontmatter preserved by default.
- State is persisted per source file under `.l10n/locks/` mirroring the source path.
- CLI commands: `translate`, `check`, `status`; `check` fails if outputs missing.
- Default provider targets OpenAI-compatible Chat Completions; Vertex AI preset uses OpenAI-compatible endpoint.
- Separate models for coordinator and translator now; room for reviewer later. `--yolo` is default (no human review).
- Marketing site localized with locales: `en` (source), `es`, `de`, `ko`, `ja`, `zh-Hans`, `zh-Hant`.

## Open Questions
- Exact `[[translate]]` schema fields (required/optional) and placeholder set for output templates.
- Lockfile format contents and whether to mark as generated in `.gitattributes`.
- Default retry count and external check command configuration format.
- Eleventy i18n folder structure and how translated blog posts are organized.

## Next Steps
→ Run `/workflows:plan` for implementation details.
