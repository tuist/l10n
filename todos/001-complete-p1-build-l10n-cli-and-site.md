---
status: complete
priority: p1
issue_id: "001"
tags: [cli, l10n, website, eleventy]
dependencies: []
---

# Build l10n CLI and localized Eleventy site

## Problem Statement
We need a Go CLI (`l10n`) that translates local files using LLMs with `L10N.md` TOML frontmatter config, plus a localized Eleventy marketing site that uses the same convention.

## Findings
- Repo is empty aside from `.git` and planning docs.
- Config is defined in `L10N.md` with `[[translate]]` entries; no global defaults.
- Translation hash uses source content + ancestor `L10N.md` bodies (frontmatter excluded).
- Per‑file lockfiles stored under `.l10n/locks/` mirroring source paths.

## Proposed Solutions
1) Build CLI + site from scratch following the plan phases.
2) Defer site and ship CLI first.

## Recommended Action
Proceed with full plan: implement CLI foundation, LLM agent pipeline + checks, then Eleventy site and docs.

## Acceptance Criteria
- [ ] CLI supports `translate`, `check`, `status` with `L10N.md` discovery and overrides.
- [ ] Per‑file lockfiles written under `.l10n/locks/` and used for status.
- [ ] Built‑in validators + optional external checks wired into translation flow.
- [ ] OpenAI‑compatible chat completions client with Vertex preset.
- [ ] Eleventy site built and localized with initial blog post.
- [ ] Docs and MIT license included.

## Work Log
### 2026-02-03 - Plan execution started
**By:** Claude Code

**Actions:**
- Created todo tracking file and prepared to implement plan.

**Learnings:**
- None yet.

### 2026-02-03 - Implementation complete
**By:** Claude Code

**Actions:**
- Implemented CLI pipeline (config parsing, plan resolution, hashing, lockfiles, checks, LLM client, agent flow).
- Added unit tests for config, plan merging, and lockfile write/read.
- Added Eleventy site with localized structure, layouts, styling, and initial blog post.
- Added docs, LICENSE, mise.toml, and repo configuration files.

**Learnings:**
- Overlapping globs need explicit precedence; last-in-file and deepest directory rules work well.
