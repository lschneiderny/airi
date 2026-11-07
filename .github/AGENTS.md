# GitHub Directory Guide

## OVERVIEW

This personal fork keeps no GitHub Actions workflows, release automation, or issue and pull request tooling. GitHub Actions is disabled for the repository. `pnpm verify` and the pre-commit hook are the only checks.
Parent guidance: [root AGENTS.md](../AGENTS.md).

## STRUCTURE

| Path | Role |
| --- | --- |
| `CONTRIBUTING.md` | Developer guide for setting up, running, and checking this fork |
| `copilot-instructions.md` | Repository instructions that coding agents load |
| `scripts/check-locales.ts` | Locale catalog validation CLI and its regression test |

## WHERE TO LOOK

| Task | Location | Notes |
| --- | --- | --- |
| Locale rules | `checkLocales()` in `scripts/check-locales.ts` | `en` is the source locale. A key present only in `en` is not an issue; apps fall back to English. |
| Placeholder parsing | exported `placeholders()` | Matches `{name}`, `{0}`, and `@:key`. Literal spans such as `{'@'}` are text. Exported for tools such as the i18n rules skill. |
| Choice separators | `choiceSeparatorWarning()` | A pipe without `{count}` or `{n}` warns, in `en` too. Write a literal pipe as `{'\|'}`. |
| Base comparison | `--base <dir>` | Enables removed-translation and moved-translation checks. Problems already on the base drop to warnings. |
| Output | `main()` | Prints `::error`/`::warning` annotation lines to stdout; `--summary <file>` writes a Markdown table. |
| Regression cases | `scripts/check-locales.test.ts` | Builds temp locale trees with `locales({...})`; cases cite upstream PRs and ROOT CAUSE notes. |

## CONVENTIONS

- For TypeScript changes, read [TypeScript rules](../.agents/skills/enforce-rules-for-typescript/SKILL.md).
- For test changes, read [Vitest rules](../.agents/skills/enforce-rules-for-vitest/SKILL.md).
- For locale changes, read [i18n guidance](../packages/i18n/AGENTS.md).
- Root Vitest owns these scripts through the `github-scripts` project, not a package workspace.
- Run the regression test with `pnpm exec vitest run --project github-scripts .github/scripts/check-locales.test.ts`.
- Run locale validation with `node .github/scripts/check-locales.ts --root packages/i18n/src/locales`.
- Locale validation accepts `--base`, `--source-changes warning`, and `--summary`.
- Locale errors fail the CLI. Warnings alone do not.

## ANTI-PATTERNS

- Do not add workflows that need secrets or upstream-only services; the fork has neither.
- Do not restore upstream release, deploy, Crowdin, sponsor, or label automation without asking.
