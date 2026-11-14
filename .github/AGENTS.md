# GitHub Directory Guide

## CONVENTIONS

- This personal fork keeps no GitHub Actions workflows, release automation, or issue and pull request tooling. GitHub Actions is disabled for the repository. `pnpm verify` and the pre-commit hook are the only checks.
- For TypeScript changes, read [TypeScript rules](../.agents/skills/enforce-rules-for-typescript/SKILL.md).
- For test changes, read [Vitest rules](../.agents/skills/enforce-rules-for-vitest/SKILL.md).
- For locale changes, read [i18n guidance](../packages/i18n/AGENTS.md).
- Root Vitest owns these scripts through the `github-scripts` project, not a package workspace.
- Run the regression test with `pnpm exec vitest run --project github-scripts .github/scripts/check-locales.test.ts`.
- Run locale validation with `node .github/scripts/check-locales.ts --root packages/i18n/src/locales`.
- Locale validation accepts `--base`, `--source-changes warning`, and `--summary`.
- Locale errors fail the CLI. Warnings alone do not.
- `en` is the source locale. A key present only in `en` is not an issue; apps fall back to English.
- `placeholders()` is exported for tools such as the i18n rules skill. It matches `{name}`, `{0}`, and `@:key`. Literal spans such as `{'@'}` are text.
- A pipe without `{count}` or `{n}` warns, in `en` too. Write a literal pipe as `{'\|'}`.
- `--base <dir>` enables removed-translation and moved-translation checks. Problems already on the base drop to warnings.
- Output prints `::error`/`::warning` annotation lines to stdout; `--summary <file>` writes a Markdown table.
- Regression cases build temp locale trees with `locales({...})`; cases cite upstream PRs and ROOT CAUSE notes.

## ANTI-PATTERNS

- Do not add workflows that need secrets or upstream-only services; the fork has neither.
- Do not restore upstream release, deploy, Crowdin, sponsor, or label automation without asking.
