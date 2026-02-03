# Changelog

All notable changes to this project will be documented in this file.
## [v0.10.0] - 2026-02-03

### Bug Fixes
- fix: replace em dashes with commas in blog post

https://claude.ai/code/session_011FXxff8XVFLaVpHDJewZnm


### Features
- feat: add blog section with SEO support and first blog post

Add a complete blog infrastructure: listing page at /blog/ with pagination
for all locales, SEO meta tags (Open Graph, Twitter Cards, JSON-LD structured
data, canonical URLs), navigation links, and a homepage blog section.

The first post covers why l10n was built — the overhead of syncing content
with external platforms, the CI failures from tools that can't validate,
the conversation with María José that sparked the agent-based approach,
and the vision for a human input experience beyond the terminal.

https://claude.ai/code/session_011FXxff8XVFLaVpHDJewZnm


### Other
- Merge pull request #7 from tuist/claude/add-localization-blog-post-prJrQ

## [v0.9.0] - 2026-02-03

### Features
- feat: add Progressive Refinement section to homepage

Explain that translations improve iteratively through human review cycles,
drawing on prior art from Kaizen, PEMT, and successive approximation.
Includes vertical timeline UI and translations for all 6 supported languages.

https://claude.ai/code/session_014yfYCnE79UtYxh7rPrSNBs


### Other
- Merge pull request #6 from tuist/claude/add-translation-improvement-section-zgqqI

## [v0.8.2] - 2026-02-03

### Bug Fixes
- fix: improve mobile responsive layout to prevent horizontal overflow

- Add overflow-x: hidden on html to prevent horizontal scroll
- Add min-width: 0 to grid children (step, tool-card, feature, config-card) to prevent content overflow
- Add overflow: hidden on config-card to contain code blocks
- Add max-width: 100% to code blocks for proper containment
- Make code blocks edge-to-edge within config cards on mobile for better space usage
- Adjust small phone breakpoint for config card code blocks

https://claude.ai/code/session_0161yaFEs2sRkn1wXsQhyWic


### Other
- Merge pull request #5 from tuist/claude/fix-mobile-responsive-Y0HcQ

## [v0.8.1] - 2026-02-03

### Bug Fixes
- fix: add proper right margin to code snippets on mobile

Remove edge-to-edge negative margin approach for mobile code snippets
and keep them within their container with consistent margins on both
sides.

https://claude.ai/code/session_01K2xSMD985sweMRxEm82KZM


### Other
- Merge pull request #4 from tuist/claude/fix-mobile-snippet-margin-KEY2k

## [v0.8.0] - 2026-02-03

### Features
- feat: reimplement CLI in Bun/TypeScript

Replace the Go implementation with a Bun/TypeScript implementation that
is also compatible with Node.js for Electron embedding. The CLI produces
standalone portable executables via `bun build --compile`.

- Add Bun as a Mise dependency (replaces Go)
- Implement all CLI commands: init, translate, check, status, clean
- Port config parsing (TOML frontmatter), LLM client (OpenAI/Anthropic),
  plan building, validation, lock files, and TUI reporter
- Use only Node.js-compatible APIs (fs/promises, crypto, child_process)
  so the code runs in both Bun and Node.js/Electron
- Update release workflow to build Bun standalone binaries per platform
- Dependencies: @iarna/toml, js-yaml, minimatch

https://claude.ai/code/session_01RjLfQQg7nhT9YuTjvo8ooK
- feat: add CI workflow and tests

Add a GitHub Actions CI pipeline that runs typecheck, tests, and build
on every push/PR to main. Add unit tests for config parsing, validation,
checks, hashing, format detection, and output expansion.

https://claude.ai/code/session_01RjLfQQg7nhT9YuTjvo8ooK
- feat: add format checking with Biome

Add Biome formatter with format:check CI step. Auto-format all source
files to consistent style (2-space indent, double quotes, semicolons,
trailing commas, 100 char line width).

https://claude.ai/code/session_01RjLfQQg7nhT9YuTjvo8ooK


### Other
- Merge pull request #2 from tuist/claude/cli-bun-reimplementation-xzq8x


### Refactors
- refactor: split CI into separate format, typecheck, test, build jobs

Run each check as an independent parallel job for faster feedback and
clearer failure signals.

https://claude.ai/code/session_01RjLfQQg7nhT9YuTjvo8ooK

## [v0.7.1] - 2026-02-03

### Bug Fixes
- fix: prevent code snippet horizontal overflow on mobile

Add max-width: 100vw and box-sizing: border-box to mobile code blocks
so long lines scroll within the block instead of overflowing the viewport.

https://claude.ai/code/session_01UJZim24FwSdGEt6A3GLzAe


### Other
- Merge pull request #3 from tuist/claude/fix-code-snippet-overflow-Re9Jo

## [v0.7.0] - 2026-02-03

### Features
- feat: make website responsive with mobile menu and multi-breakpoint layout

- Add hamburger menu for mobile navigation (hidden nav links now accessible)
- Add 960px tablet breakpoint for intermediate screen sizes
- Add 400px small phone breakpoint for tighter spacing
- Improve code block display on mobile (edge-to-edge, smaller font)
- Allow CLI command items to wrap on narrow screens
- Scale typography and spacing for mobile viewports

https://claude.ai/code/session_01KFZBTTHaxGaD4EHaG5btCw


### Other
- Merge pull request #1 from tuist/claude/make-website-responsive-As32c

## [v0.6.0] - 2026-02-03

### Features
- feat: format tool lines

## [v0.5.0] - 2026-02-03

### Features
- feat: show translating and validating activity

## [v0.4.0] - 2026-02-03

### Features
- feat: tint progress lines

## [v0.3.0] - 2026-02-03

### Features
- feat: simplify progress output

## [v0.2.0] - 2026-02-03

### Features
- feat: add first-party tools and website section
- feat: surface tool verification steps


### Other
- Add init command and path flag
- Rename release workflow to deploy
- Restore release workflow and deploy site

## [v0.1.4] - 2026-02-03

### Other
- Add Cloudflare Workers deploy workflow
- Add emojis to README headings

## [v0.1.3] - 2026-02-03

### Chores
- chore: add agents guidance and updated translations


### Other
- Drop version from release artifact names
- Add l10n tool to mise config
- Show completed files in progress output

## [v0.1.2] - 2026-02-03

### Other
- Simplify release notes body

## [v0.1.1] - 2026-02-03

### Other
- Adjust git-cliff tags for mise compatibility

## [v0.1.0] - 2026-02-03

### Other
- Build l10n CLI, site, and Anthropic support
- Improve CLI UX with Charm and progress
- Add git-cliff release automation
- Fix git-cliff config regex
- Fix release workflow git-cliff install

<!-- generated by git-cliff -->
