# scope-and-policy-docs - Work Plan

> Status 2026-11-17: complete; frozen history.

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**Who this is for and what changes for them:** For you and for the coding agents working in this fork. Instead of piecing a rule together from several decision records, there is one place that says what the fork maintains and one current rulebook per area.

**What you'll get:** A short statement of which projects the fork supports, which it keeps as upstream ships them, and which it has retired. The web app and four integrations you don't use (Telegram, Twitter with its in-app X module, Satori, Bilibili) removed, along with the face-tracking package only the web app used. The fork's own dead code removed. A glossary of the character's terms. Four living rulebooks: who moves her body, what makes her act on her own, what the language model is told, and where saved state lives. The decision records frozen as history and pointing to those rulebooks, and the docs arranged the way upstream arranges them.

**Why this approach:** You target the desktop app only, and you asked to keep anything that is not an easy drop. So only cleanly separable projects go. Everything else stays as upstream ships it, and the docs follow upstream's layout so the next upstream sync merges with fewer conflicts.

**What it will NOT do:** It won't remove Home Assistant, Artistry, the server, or the other kept projects. It won't strip the web-only branches inside shared packages, merge upstream, or change how the desktop app behaves. Disagreements between the rules and the code are listed for later, not fixed.

**Effort:** Large
<!-- Effort is exactly ONE band, never hours/days. Quick = single edit, minutes of agent work; Short = one focused change, a few files; Medium = multi-file feature in one session; Large = several waves, one long session; XL = multi-session or architectural work. A written duration is rewritten to a band. -->
**Risk:** Medium - the docs are low risk; removing the web app touches root scripts and the lockfile, guarded by full checks and a clean-start smoke run of the desktop app.
**Decisions to sanity-check:** That `pnpm dev` now starts the desktop app. That Home Assistant and Artistry stay because they are woven into shared code. The four rulebooks and their names.

Your next move: start execution with `/ulw-execute`. Full execution detail follows below.

---

> TL;DR (machine): Large, medium risk; retire apps/stage-web + model-driver-mediapipe + telegram/twitter(X module)/satori/bilibili, README support scope, knip-triaged dead-code removal in fork-added files, docs moved to upstream docs/ai layout, glossary + four policy docs, ADR Status pointers, AGENTS routing; 15 todos in 3 waves plus F1-F4.

## Scope
### Affected user and ideal state
<!-- From the draft ledger: who this touches and how they use the result, then one IS row per property with its reason, then one GAP row per difference with its reason. Every todo below closes a GAP row; ## Success criteria proves every IS row. -->
**Affected user:** (1) Luke, deciding where a new feature's rule or setting belongs and judging whether two features overlap; (2) coding agents, which read `AGENTS.md`, docs, and skills before every change; (3) the next upstream sync (a `git merge` of `upstream/main`, planned separately right after this plan). Today a rule needs up to five ADRs, no page states which projects the fork maintains, and docs sit where upstream no longer keeps them. After this plan, one page states the support scope, four living policy docs plus a glossary state the current rules, ADRs are frozen history that point to them, and the docs layout matches upstream's.

| Row | Statement | Reason |
| --- | --- | --- |
| IS-1 | One section answers which projects the fork supports, carries unchanged from upstream, or has retired | agents and Luke stop spending effort on carried projects and stop re-deciding scope |
| IS-2 | Kept upstream projects (`server`, `integrations/discord-bot`, `integrations/vscode`, `plugins/airi-plugin-claude-code`, `services/computer-use-mcp`, `apps/component-calling`, `packages/memory-pgvector`, `packages/input-playstation-dualsense-5`, `packages/stage-pages/src/pages/v2`) and the kept in-app modules (Home Assistant, Artistry) are unchanged by this plan | Luke: "follow upstream's conventions and projects where possible", and "if it's not an easy drop, just keep it" |
| IS-8 | Only the desktop target ships: the web app, the face-tracking package only it used, and the four dropped integrations are gone, with no reference left | Luke: "focusing on our target platforms"; desktop only (2026-11-16) |
| IS-3 | No dead file or unused export that the fork itself added remains | agents read dead code as live policy |
| IS-4 | Each policy domain (body ownership, autonomous behavior, LLM prompt, state persistence) has exactly one current document, cited by symbol, and every related ADR points to it | today one rule needs up to five ADRs; 14 ADRs carry supersession notes |
| IS-5 | Every domain term used in the policy docs has one definition in one glossary | the same words mean different things across ADRs |
| IS-6 | AI docs live where upstream keeps them: `docs/ai/adr/`, `docs/ai/audits/`, `docs/ai/context/`; user-visible terms stay in `packages/i18n/glossary/terms.yaml` | upstream moved `docs/assets/ai/*` to `docs/ai/*`; matching it shrinks sync conflicts |
| IS-7 | No reference in the repository (outside `.omo/`) points at a moved or deleted path | a broken pointer is worse than no pointer for an agent |
| GAP-1 | No support-scope statement exists; retirements live only in `AGENTS.md` NOTES | IS-1 |
| GAP-2 | The 2026-10-31 audit (H1, H3, H5) recommends deleting projects upstream still changes; Luke chose per project instead: drop Telegram, Twitter, Satori, Bilibili, and the web app; keep the rest | IS-2, IS-8 |
| GAP-3 | knip reports 56 fork-added unused files and 91 fork-added files with unused exports, mostly false positives (route pages, scripts, fixtures, glob-loaded gates); no triage exists | IS-3 |
| GAP-4 | Living docs are scattered: `docs/ai/*.md`, `docs/assets/ai/context/`; the Live2D ownership doc cites line numbers from 2026-11-01 and has no MMD counterpart; no autonomous-behavior, LLM-prompt, or state doc separate from ADRs | IS-4 |
| GAP-5 | No domain glossary | IS-5 |
| GAP-6 | `docs/assets/ai/{adr,audits,context}` still exist in the fork; upstream keeps them under `docs/ai/` | IS-6 |
| GAP-7 | ADRs do not point to a current-rules document (six point to the Live2D ownership doc by an old relative path) | IS-4, IS-7 |
| GAP-8 | `apps/stage-web` (79 files), `packages/model-driver-mediapipe` (only stage-web depends on it), `integrations/{telegram-bot,twitter-services,satori-bot}`, `plugins/airi-plugin-bilibili-laplace`, and the stage-ui X module still exist; root `dev` scripts start the web app | IS-8 |

### Must have
- Removal of `apps/stage-web`, `packages/model-driver-mediapipe`, `integrations/telegram-bot`, `integrations/twitter-services`, `integrations/satori-bot`, `plugins/airi-plugin-bilibili-laplace`, and the stage-ui X module, with every reference outside `.omo/` and frozen history (ADRs, audits) updated.
- A support-scope section in `README.md` and a short rule in `AGENTS.md` that links to it.
- A triage table of every knip candidate in fork-added files, with a verdict and reason, and deletion of exactly the candidates the rules in todo 2 mark dead.
- `git mv` for every move (rename history must survive for the upstream sync).
- `docs/ai/context/glossary.md` and four policy docs: `body-ownership.md`, `autonomous-behavior.md`, `llm-prompt.md`, `state-persistence.md`, each headed by "Verified against the code on <date> (commit <sha>)" and a sentence stating that these rules win over ADRs, which record why.
- Policy docs cite code by repository path plus exported symbol, never by line number.
- A `Current rules:` pointer appended to the `Status:` line of every ADR mapped in todo 10.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- No edit, move, or deletion under the kept paths: `server/`, `integrations/discord-bot/`, `integrations/vscode/`, `plugins/airi-plugin-claude-code/`, `services/computer-use-mcp/`, `apps/component-calling/`, `packages/memory-pgvector/`, `packages/input-playstation-dualsense-5/`, `packages/stage-pages/src/pages/v2/`, `plugins/airi-plugin-web-extension/`, `integrations/minecraft/`, `engines/stage-tamagotchi-godot/`. Verify with `git diff --stat main...HEAD -- server integrations/discord-bot integrations/vscode plugins/airi-plugin-claude-code services/computer-use-mcp apps/component-calling packages/memory-pgvector packages/input-playstation-dualsense-5 packages/stage-pages/src/pages/v2 plugins/airi-plugin-web-extension integrations/minecraft engines/stage-tamagotchi-godot` printing nothing.
- No change to Home Assistant or Artistry code, the 18 `isStageWeb()` call sites in shared packages, or any other shared-package code path that mentions the web app; those are not easy drops.
- Root wiring changes are limited to: removing the `telegram-bot` and `twitter-services` projects from `vitest.config.ts`, the `integrations/telegram-bot` entry from `scripts/dev-tools/test-run-plan.ts`, the web scripts in root `package.json`, and the lockfile change `pnpm install` makes, plus removal of entries that name a retired path (for example the stage-web entries in `scripts/dev-tools/verify-plan.ts`, `scripts/dev-tools/test-run-plan.ts`, and `vitest.browser.config.ts`; amended 2026-11-16 after the gate review found the two guardrails conflicting) and todo 16's removal of catalog entries that no package.json uses (19 at HEAD, tasks-vision among them; amended 2026-11-16 because the catalog lint rejects any edit to the file while dead entries remain). Nothing else in `pnpm-workspace.yaml`, `turbo.json`, `knip.json`, or `scripts/dev-tools/verify-plan.ts` changes.
- No upstream merge or cherry-pick.
- No runtime behavior change: no edit to non-dead source code, settings UI, schedulers, stores, or prompts. Policy docs describe the code as it is; where code and an ADR disagree, the doc states the code's behavior and lists the disagreement under "Known gaps", without fixing it.
- No ADR body rewrite. ADR edits are limited to (a) the `Status:` line pointer and (b) path-only link fixes forced by the moves.
- No new dependency, no new committed tooling, no new tests.
- No edits to non-English locales; no new entries in `packages/i18n/glossary/terms.yaml` unless a policy doc introduces a user-visible term (none is expected).
- No deletion of untracked local files (for example the leftover `apps/stage-pocket/node_modules`).

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: none (Luke, 2026-11-16). Proof is `pnpm verify` after every commit, the knip triage table, the scratch doc-link check below, a carried-path diff check, and `pnpm verify --gate` in the final wave.
- Scratch doc-link check (never committed): write `.omo/evidence/scope-and-policy-docs/check-links.ts` that (1) calls `checkDocPaths` from `packages/qa-tools/src/docs/doc-paths.ts` over the given Markdown files for backtick-quoted paths, and (2) resolves every Markdown link target `](<relative path>)` (skip `http`, `#`, and `mailto:`) against the file's directory and, when the link carries `#fragment` and the target is Markdown, checks that the target has a heading whose GitHub slug (lowercase, spaces to `-`, punctuation other than `-` removed) equals the fragment; it prints `MISSING <file> -> <target>` per failure and exits 1 on any. Run it with `pnpm exec tsx .omo/evidence/scope-and-policy-docs/check-links.ts <files...>`.
- Old-path check: `git grep -n -E 'docs/assets/ai/|docs/ai/(testing|3d-character-roadmap|upstream-watch|browser-test-audit|live2d-parameter-ownership)\.md|\(\.\./(live2d-parameter-ownership|3d-character-roadmap|testing|upstream-watch)\.md' -- ':!.omo'` prints nothing.
- Evidence: `.omo/evidence/scope-and-policy-docs/task-N.txt` per todo, as named in each todo (under ulw-loop, the attempt directory replaces `.omo/evidence/scope-and-policy-docs/`; attemptDir = result.currentAttemptDir from await agentToolkit.status() in a JS eval cell after importing agentToolkit with await import(`${env("OMO_AGENT_TOOLKIT_SDK_ROOT")}/sdk.js`), .omo/evidence/ulw/<session>/<goalId>/a<attempt>; outside ulw-loop use .omo/evidence/)

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.

Work on branch `luke/docs/scope-and-policy-docs` created from `main` in the main checkout. Todos in one wave touch disjoint files; run them in parallel only when their file sets in the matrix do not overlap, otherwise in todo order.

- Wave 1: 13 (retire small integrations), then 14 (retire Twitter and the X module; both edit `vitest.config.ts`), 15 (retire the web app), 3 (doc moves), 4 (glossary)
- Wave 2: 1 (support scope), 2 (knip triage, after the retirements so it sees the final tree), 6 (body ownership), 7 (autonomous behavior), 8 (LLM prompt), 9 (state persistence)
- Wave 3: 5 (dead-code deletion), 10 (ADR pointers), 11 (agent guidance), 12 (glossary closure)
- Final: F1-F4

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 13 | - | 14, 1, 2, 11 | 15, 3, 4 |
| 14 | 13 | 1, 2, 11 | 15, 3, 4 |
| 15 | - | 1, 2, 11 | 13, 14, 3, 4 |
| 3 | - | 6, 10, 11 | 13, 14, 15, 4 |
| 4 | - | 7, 12 | 13, 14, 15, 3 |
| 1 | 3, 13, 14, 15 | 11 | 2, 6, 7, 8, 9 |
| 2 | 13, 14, 15 | 5 | 1, 6, 7, 8, 9 |
| 6 | 3 | 10, 12 | 1, 2, 7, 8, 9 |
| 7 | 4 | 10, 12 | 1, 2, 6, 8, 9 |
| 8 | wave 1 | 10, 12 | 1, 2, 6, 7, 9 |
| 9 | wave 1 | 10, 12 | 1, 2, 6, 7, 8 |
| 5 | 2 | F1-F4 | 10, 11, 12 |
| 10 | 3, 6, 7, 8, 9 | F1-F4 | 5, 11, 12 |
| 11 | 1, 3, 6, 7, 8, 9, 13, 14, 15 | F1-F4 | 5, 10, 12 |
| 12 | 4, 6, 7, 8, 9 | F1-F4 | 5, 10, 11 |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [x] 1. State the fork's support scope in the README
  What to do: In `README.md`, replace the `## Apps` table row for Stage Web (the app is gone) and add a section `## Support scope` directly after `## Platform support`. Target platform: the Electron desktop app on Linux, macOS, and Windows. Three tables (Path | Status | Meaning):
  - **Supported** (fork features land here; bugs are fixed): `apps/stage-tamagotchi`, `engines/stage-tamagotchi-godot` (VRM stage), `integrations/minecraft` (bot, module, and situation sensor), `plugins/airi-plugin-web-extension` (Presence browser activity), every `packages/*` entry not listed below, `scripts/`.
  - **Kept from upstream** (not developed by the fork; changed only to keep the workspace building; syncs bring upstream's changes): `server`, `integrations/discord-bot`, `integrations/vscode`, `plugins/airi-plugin-claude-code`, `services/computer-use-mcp`, `apps/component-calling`, `packages/memory-pgvector`, `packages/input-playstation-dualsense-5`, `packages/stage-pages/src/pages/v2`, and the in-app Home Assistant and Artistry modules (kept because they are woven into shared code).
  - **Retired** (removed; upstream changes to these paths are dropped on sync): `apps/stage-tamagotchi-kirie` (2026-10-31), `apps/stage-pocket`, `packages/cap-vite`, `apps/ui-server-auth` (2026-11-04), and from this plan `apps/stage-web`, `packages/model-driver-mediapipe`, `integrations/telegram-bot`, `integrations/twitter-services`, `integrations/satori-bot`, `plugins/airi-plugin-bilibili-laplace`, and the stage-ui X module (all dated the merge day). Port-back conditions for Kirie and Pocket are in `docs/ai/context/upstream-watch.md`.
  Add one sentence after the tables: "The Retired table is the path list the upstream sync uses to resolve delete-versus-modify conflicts: a retired path stays deleted."
  Must NOT do: edit `AGENTS.md` (todo 11 owns it); rewrite other README sections beyond the Apps row and the Getting started `pnpm dev` line (point it at the desktop app as todo 15 changes it).
  Closes: GAP-1, GAP-2
  Parallelization: Wave 2 | Blocked by: 3, 13, 14, 15 | Blocks: 11
  References: `README.md` (`## Apps`, `## Platform support`, `## Getting started`); `AGENTS.md` NOTES (Kirie and Pocket dates); `git ls-files apps/ui-server-auth packages/cap-vite` prints nothing (already removed); `docs/ai/audits/2026-10-31-architecture-boundaries.md` section "Host scope".
  Acceptance criteria: `grep -c '^## Support scope' README.md` prints 1; every Supported and Kept path exists (`test -e`) and every Retired path does not; `pnpm verify` passes.
  QA scenarios: happy - run the scratch link check on `README.md` after wave 1 and get exit 0; failure - temporarily misspell one carried path in a scratch copy at `/tmp/readme-check.md`, run the per-path `test -e` loop on it, and confirm it reports that path. Evidence `.omo/evidence/scope-and-policy-docs/task-1.txt`.
  Commit: Y | `docs: state which projects the fork supports, carries, and retired`
  Recommended task executor category: writing - prose in one file with a fixed table.

- [x] 2. Triage knip's dead-code report for fork-added files
  What to do:
  1. Run `pnpm knip --include files,exports --reporter json --no-progress > .omo/evidence/scope-and-policy-docs/knip-raw.txt`; knip exits 1 when it finds issues, which is expected. The output starts with `mode development`/`mode production` lines and a cpu-slots banner, so parse from the first `{`.
  2. Build the fork-added set: `git diff --diff-filter=A --name-only f3e6a244e HEAD`.
  3. Candidates = reported unused files and files with unused exports or types that are in the fork-added set (baseline on 2026-11-16 before the retirements: 56 files, 91 files with exports).
  4. Apply these rules in order; the first match decides:
     - K1 keep: route pages (`**/pages/**/*.vue`), stories (`*.story.vue`), fixtures (`**/fixtures/**`, `**/__fixtures__/**`, `**/test/fixtures/**`), config files (`*.config.ts`).
     - K2 keep: qa-tools gates (`packages/qa-tools/gates/*.ts`) and spikes referenced from `scripts/dev-tools/*.ts`.
     - K3 keep: a file whose repo path, path relative to its package, or path without extension appears in any `package.json` script, `README.md`, `AGENTS.md`, `SKILL.md`, config file, or other source file (`git grep -F` excluding `.omo/` and the file itself), or that is imported anywhere (`git grep -E "from '[^']*<basename without extension>'"`, plus Vue `import` lines).
     - K4 keep an export: `git grep -w <symbol>` finds a use outside the export's own file (tests count).
     - D1 delete a file: none of K1-K3 matched.
     - D2 drop an export: K4 did not match; remove the `export` keyword when the symbol is used inside its file, or delete the symbol when it is not used at all.
  5. Write `.omo/evidence/scope-and-policy-docs/knip-triage.md` as a table: path | symbol (or `file`) | verdict (K1-K4, D1, D2) | evidence (the grep or rule that decided it).
  Must NOT do: delete or edit anything (todo 5 does); triage files outside the fork-added set; change `knip.json`.
  Closes: GAP-3 (inventory half)
  Parallelization: Wave 2 | Blocked by: 13, 14, 15 | Blocks: 5
  References: `knip.json` (root-only workspace config, identical to upstream's); root `package.json` script `knip`; baseline candidates are in this session's analysis and are expected to be mostly K1-K3 (for example `apps/stage-tamagotchi/src/renderer/composables/use-desktop-stage-host.ts` is imported by `apps/stage-tamagotchi/src/renderer/pages/settings/models/index.vue`).
  Acceptance criteria: the triage file has one row per candidate (row count equals the candidate count printed by the script); every D1/D2 row cites the grep commands that returned no match.
  QA scenarios: happy - re-run the triage on one D-row and get the same verdict; failure - pick one K3 row, confirm the cited reference exists with `git grep`, and confirm that dropping that reference in a scratch copy of the logic would flip it to D1 (a reasoning check recorded in the evidence). Evidence `.omo/evidence/scope-and-policy-docs/task-2.txt`.
  Commit: N (evidence only)
  Recommended task executor category: unspecified-low - mechanical analysis across many files with fixed rules.

- [x] 3. Move the AI docs into upstream's layout and fix every reference
  What to do: With `git mv` only:
  - `docs/assets/ai/adr/*` -> `docs/ai/adr/` (8 upstream ADRs; no name collides with the fork's ADRs)
  - `docs/assets/ai/audits/*` -> `docs/ai/audits/`
  - `docs/assets/ai/context/*` -> `docs/ai/context/`
  - `docs/ai/testing.md`, `docs/ai/3d-character-roadmap.md`, `docs/ai/upstream-watch.md` -> `docs/ai/context/`
  - `docs/ai/browser-test-audit.md` -> `docs/ai/audits/browser-test-audit.md`
  - `docs/ai/live2d-parameter-ownership.md` -> `docs/ai/context/body-ownership.md` (content stays unchanged here; todo 6 rewrites it)
  Then update every reference outside `.omo/`: run the old-path check from Verification strategy and fix each hit, plus relative links inside moved files and the six ADRs whose line 6 links `../live2d-parameter-ownership.md` (they become `../context/body-ownership.md`). Make two commits: first every non-agent file (docs, READMEs, ADR links, `DESIGN.md`, `.github/CONTRIBUTING.md`, `docs/ai/audits/*`); second, only agent configuration (`AGENTS.md`, `packages/*/AGENTS.md`, `.agents/skills/**`, `.github/copilot-instructions.md`).
  Must NOT do: change any moved file's content beyond link paths; touch `.omo/`; leave `docs/assets/ai/` behind (remove the empty directory).
  Closes: GAP-6, part of GAP-4 and GAP-7
  Parallelization: Wave 1 | Blocked by: - | Blocks: 6, 10, 11
  References: hits found on 2026-11-16: `AGENTS.md:29`, `AGENTS.md:31`, `DESIGN.md:21`, `.agents/skills/enforce-rules-for-unocss/SKILL.md:37-38`, `packages/stage-ui/README.md`, `docs/ai/audits/2026-10-21-post-merge-qa.md`, the 11 files that cite `docs/ai/testing.md` (`.agents/skills/{agent-browser-electron,enforce-rules-for-vitest,motion-qa,use-agent-browser-for-airi,use-vishot}/SKILL.md`, `.github/CONTRIBUTING.md`, `.github/copilot-instructions.md`, `AGENTS.md`, `docs/ai/adr/2026-11-10-test-tiers.md`, `packages/qa-tools/AGENTS.md`, `packages/qa-tools/README.md`), `.agents/skills/vault-sync/SKILL.md` and `docs/ai/audits/2026-10-31-architecture-boundaries.md` (upstream-watch), and ADR line-6 links in `docs/ai/adr/2026-10-17-natural-motion-v2-performance-state.md`, `2026-10-18-expression-performance.md`, `2026-10-18-live2d-touch-interaction.md`, `2026-10-19-natural-emotion-revamp.md`, `2026-10-24-expression-auto-setup.md`, `2026-10-24-expression-combos-and-reactions.md`, plus `2026-11-03-mmd-clip-actions.md:10` (`../3d-character-roadmap.md`). Upstream layout: `git ls-tree -r --name-only upstream/main docs/ai`. Upstream skill path also used by `.agents/skills/enforce-rules-for-unocss/SKILL.md`.
  Acceptance criteria: the old-path check prints nothing; `test ! -e docs/assets/ai`; `git log --follow --oneline docs/ai/context/body-ownership.md | tail -1` shows the original creation commit; the scratch link check over every moved file and every edited file exits 0; `pnpm verify` passes after each commit.
  QA scenarios: happy - link check exits 0 over `git diff --name-only main...HEAD -- '*.md'`; failure - in a scratch copy, revert one fixed link and confirm the link check prints `MISSING` for it and exits 1. Evidence `.omo/evidence/scope-and-policy-docs/task-3.txt`.
  Commit: Y (2) | `docs: move ai docs into upstream's docs/ai layout` and `chore(agents): point guidance at the moved ai docs`
  Recommended task executor category: unspecified-low - mechanical moves and reference fixes.

- [x] 4. Write the domain glossary
  What to do: Create `docs/ai/context/glossary.md`. Opening paragraph: what the file is (domain terms used in code and docs), how it differs from `packages/i18n/glossary/terms.yaml` (user-visible, translatable terms only, per `packages/i18n/AGENTS.md` "Glossary"), and that a term's definition here wins over ADR wording. Then one `### <Term>` per term, alphabetical, each with: a definition (one or two sentences, describing behavior on `main`), **Code:** the defining path and exported symbol, **Not to be confused with:** the nearby term, and **Avoid:** synonyms seen in docs that should not be used. Cover at least: ACT and DELAY cues, body director, character state (and its layers), clip, combo, conductor, decider (picker, planner), drive (`NaturalIdleDrive`), energy, expression performance, gate (reach-out gate, urge gate), host capability, idle activity, idle errand, leader and follower windows, MAGIC, mood, Natural, own-day reach-out, performer, presence, reaction, reach-out (unprompted turn), reply shape, situation, situation block, Spark Notify, stage contract, stage host (window, desktop), synced settings document, Universal. Find each term's code home with `git grep` and LSP; where two code homes define the same word differently, write both and note the conflict under a final section `## Conflicting usages`.
  Must NOT do: rename code; add terms to `terms.yaml`; define a term from an ADR alone when the code disagrees (the code wins; note the ADR in Conflicting usages).
  Closes: GAP-5
  Parallelization: Wave 1 | Blocked by: - | Blocks: 7, 12
  References: `docs/ai/adr/2026-11-12-idle-agency.md` (drive, idle activity, sleep), `docs/ai/adr/2026-11-03-layered-character-state.md`, `docs/ai/adr/2026-10-29-unprompted-reach-out-cadence.md`, `docs/ai/adr/2026-10-19-situational-presence.md`, `docs/ai/adr/2026-10-18-expression-performance.md` (performer, conductor, decider), `docs/ai/adr/2026-10-31-reply-shape-contract.md`, `docs/ai/adr/2026-11-08-host-capability-contract.md`, `docs/ai/adr/2026-11-01-persistence-tiers.md`; code: `packages/motion-driver-natural/src/{idle-activities,idle-errands,energy,mood}.ts`, `packages/stage-shared/src/situation/{gate,urge-gate,urge,self,render}.ts`, `packages/stage-shared/src/expression-performance/`, `packages/stage-shared/src/stage-contract/index.ts`, `packages/stage-shared/src/character-state/`, `packages/stage-ui-mmd/src/composables/mmd/body/`, `packages/stage-shared/src/composables/use-settings-document/index.ts`.
  Acceptance criteria: every listed term has a heading; every **Code:** path exists (`checkDocPaths` via the scratch link check); `pnpm exec eslint docs/ai/context/glossary.md` passes; `pnpm verify` passes.
  QA scenarios: happy - link check exits 0 on the glossary; failure - for three random terms, `git grep -n '<symbol>' <path>` finds the cited symbol at the cited path (record output); a missing symbol fails the todo. Evidence `.omo/evidence/scope-and-policy-docs/task-4.txt`.
  Commit: Y | `docs(ai): add a domain glossary for the client's character systems`
  Recommended task executor category: writing - definitions grounded in code reading.

- [x] 5. Delete the dead code that the triage marked
  What to do: Apply every D1 (delete file) and D2 (drop export or delete symbol) row from `.omo/evidence/scope-and-policy-docs/knip-triage.md`, nothing else. Group commits by package (one commit per package touched). After each commit run `pnpm verify`; if a deletion breaks typecheck, lint, or tests, restore that item, change its row to K3 with the failing evidence, and continue.
  Must NOT do: delete K-rows; touch carried paths; refactor surrounding code; remove a test to make a deletion pass.
  Closes: GAP-3
  Parallelization: Wave 3 | Blocked by: 2 | Blocks: F1-F4
  References: `.omo/evidence/scope-and-policy-docs/knip-triage.md`; the root `AGENTS.md` rule "Use kebab-case filenames"; `pnpm verify` (incremental typecheck, lint, and related tests).
  Acceptance criteria: every D-row is applied or reclassified with evidence; re-running the knip command and the triage script shows zero D-verdict rows; `pnpm verify` passes after the last commit.
  QA scenarios: happy - re-run triage, zero D rows; failure - `git diff --stat main...HEAD -- server integrations/discord-bot integrations/vscode plugins/airi-plugin-claude-code services/computer-use-mcp apps/component-calling packages/memory-pgvector packages/input-playstation-dualsense-5 packages/stage-pages/src/pages/v2 plugins/airi-plugin-web-extension integrations/minecraft engines/stage-tamagotchi-godot` prints nothing (a non-empty diff fails the todo). Evidence `.omo/evidence/scope-and-policy-docs/task-5.txt`.
  Commit: Y (one per package) | `refactor(<package>): remove unused code`
  Recommended task executor category: unspecified-low - mechanical deletions behind a verify loop.

- [x] 6. Rewrite body ownership as the current Live2D and MMD rulebook
  What to do: Rewrite `docs/ai/context/body-ownership.md` (moved in todo 3). Header: "Verified against the code on <date> (commit <sha>)" and "These rules win over ADRs; ADRs record why." Sections:
  - `## Live2D`: keep the existing channel table and per-state table, but re-verify every row against current code and replace every line reference (`ADP:391`, `MM:725`) with path plus symbol (for example `natural-motion-adapter.ts` `applyPosture`). Rows whose behavior changed since 2026-11-01 (for example the lipsync handoff after `18e1a33d7`, the SDK breath pass, `idleLidFactor` from the idle agency ADR) are updated to today's behavior.
  - `## MMD`: the same two tables for MMD bones and morphs: which writer owns each channel (Natural body, clip actions, the body director, locomotion, gaze, blink, lip sync, expressions, physics), the per-frame order in `frame-pipeline.ts`, and how layers fade (`layer-fade.ts`).
  - `## Known gaps`: each place where an ADR states a rule the code does not follow, with both citations (for example the audit's R8 posture-overwrite question if still true).
  Must NOT do: change code; keep line numbers; restate ADR history.
  Closes: GAP-4 (body)
  Parallelization: Wave 2 | Blocked by: 3 | Blocks: 10, 12
  References: `packages/stage-ui-live2d/src/composables/live2d/{natural-motion-adapter,motion-manager,expression-controller,lipsync-handoff}.ts`, `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue`, `packages/stage-ui-live2d/src/composables/live2d/natural-motion/rig-profile.ts`, `packages/stage-ui-mmd/src/composables/mmd/{frame-pipeline,layer-fade,gaze,blink,lip-sync,expression,morph,stance,action-port,body-tool-port}.ts`, `packages/stage-ui-mmd/src/composables/mmd/{body,natural,rig,touch}/`; ADRs `docs/ai/adr/2026-10-30-3d-character-motion.md`, `2026-11-03-mmd-clip-actions.md`, `2026-11-11-whole-body-performer.md`, `2026-11-12-idle-agency.md`, `2026-11-04-interaction-portability.md`; audit `docs/ai/audits/2026-10-31-architecture-boundaries.md` Lens 5 and R8-R10.
  Acceptance criteria: `grep -nE '[A-Z]{2,4}:[0-9]+' docs/ai/context/body-ownership.md` prints nothing; the link check exits 0; every cited symbol is found by `git grep -n <symbol> <path>`; `pnpm verify` passes.
  QA scenarios: happy - sample five rows, open the cited symbol, and confirm the stated behavior (record the excerpts); failure - for one row, the evidence must show the code excerpt contradicting any stale sentence that was replaced. Evidence `.omo/evidence/scope-and-policy-docs/task-6.txt`.
  Commit: Y | `docs(ai): make body ownership the current rulebook for Live2D and MMD`
  Recommended task executor category: deep-low - careful code reading across two renderers.

- [x] 7. Write the autonomous-behavior policy
  What to do: Create `docs/ai/context/autonomous-behavior.md` (header as in todo 6). Sections:
  - `## Deciders`: one table row per piece of code that makes the character do something unasked: Natural idle activities, idle errands, impulses, cursor attention, touch reactions, expression reactions and combos, beat sync, the reach-out gate and urge gate, own-day reach-outs, the MMD body director (sit, sleep, visit, unasked clip), locomotion, the presence bubble. Columns: decider (glossary term) | code (path + symbol) | trigger | what it emits | rate or cooldown | settings that gate it (setting key + settings page path) | what outranks it | hosts (Live2D, MMD, both).
  - `## Precedence`: the order applied today when two deciders want the same moment or body part, each step cited.
  - `## Known overlaps`: every case where two deciders can act on the same trigger or channel without a single arbiter, cited; this list is input for the later "one scheduler" decision and proposes nothing.
  Must NOT do: propose a redesign; change code; use a term not in the glossary (add missing terms to the glossary in todo 12 instead).
  Closes: GAP-4 (behavior)
  Parallelization: Wave 2 | Blocked by: 4 | Blocks: 10, 12
  References: `packages/motion-driver-natural/src/{idle-activities,idle-errands,impulses,cursor-attention,gestures,cue-gestures,hold}.ts`; `packages/stage-shared/src/situation/{gate,urge-gate,urge,reaction-policy,self,reasons}`; `packages/stage-shared/src/beat-sync/`; `packages/stage-shared/src/expression-performance/`; `packages/stage-ui-mmd/src/composables/mmd/body/{index,attention,locomotion}.ts`, `action-port.ts`; `packages/stage-ui/src/stores/{presence-bubble,touch}.ts`, `packages/stage-ui/src/stores/situation/index.ts`; settings: `packages/stage-ui/src/components/scenarios/settings/model-settings/{live2d,mmd}.vue`, `packages/stage-pages/src/pages/settings/{presence,conversation}/index.vue`, `packages/stage-pages/src/pages/settings/modules/beat-sync.vue`; ADRs `2026-11-12-idle-agency.md`, `2026-10-29-unprompted-reach-out-cadence.md`, `2026-10-19-situational-presence.md`, `2026-10-25-natural-idle-reshape-and-emotion-ducking.md`, `2026-10-24-expression-combos-and-reactions.md`, `2026-10-18-live2d-touch-interaction.md`, `2026-10-24-live2d-cursor-attention.md`, `2026-10-26-natural-screen-aware-attention.md`, `2026-11-03-mmd-clip-actions.md`, `2026-10-31-fullscreen-stage-and-locomotion.md`, `2026-11-03-layered-character-state.md`.
  Acceptance criteria: every decider listed above has a row (a missing one needs a cited reason in the row, for example "merged into idle activities"); link check exits 0; every symbol resolves with `git grep`; `pnpm verify` passes.
  QA scenarios: happy - for three rows, confirm the rate or cooldown value against the code constant (record excerpts); failure - search for undocumented deciders with `git grep -lE 'Exp\(1\)|hazard|cooldown' packages --include=*.ts -- ':!*.test.ts'` and confirm every hit maps to a row or to a non-decider with a stated reason. Evidence `.omo/evidence/scope-and-policy-docs/task-7.txt`.
  Commit: Y | `docs(ai): describe every decider of unprompted character behavior`
  Recommended task executor category: deep-low - cross-package code reading with a fixed table.

- [x] 8. Write the LLM prompt policy
  What to do: Create `docs/ai/context/llm-prompt.md` (header as in todo 6). Sections: `## Segments` (order | segment | composer symbol | budget | enforced in code? | stable prefix or per-request tail); `## Paths` (how chat turns, `ingest`, unprompted turns, Spark Notify, and the qa-tools full-prompt fixture differ, each cited); `## Who may add a segment` (the rule from the prompt composition ADR, as implemented); `## Known gaps`.
  Must NOT do: change prompt code or text; paste prompt text beyond short identifiers.
  Closes: GAP-4 (prompt)
  Parallelization: Wave 2 | Blocked by: - | Blocks: 10, 12
  References: `docs/ai/adr/2026-11-01-prompt-composition.md`, `2026-10-31-reply-shape-contract.md`, `2026-10-31-nonverbal-channels.md`, `2026-10-30-long-term-memory-adoption.md`; audit Lens 7 and R2-R4; code: `packages/stage-shared/src/stage-contract/index.ts` (`composeSystemPrompt`, `renderStageContract`), `packages/stage-ui/src/stores/chat/prompt.ts`, `packages/stage-ui/src/stores/chat.ts`, `packages/stage-ui/src/tools/memory.ts` (`composeMemoryPrompt`), `packages/core-agent/src/runtime/chat-orchestrator-runtime.ts`, `packages/stage-ui/src/stores/character/orchestrator/`, `packages/qa-tools/src/model/prompt.ts`.
  Acceptance criteria: one row per segment that `composeSystemPrompt` and the composer emit (cross-check against the composer's segment list); link check exits 0; `pnpm verify` passes.
  QA scenarios: happy - list the composer's segment identifiers with `git grep` and match them 1:1 to table rows; failure - any composer segment missing from the table fails the todo. Evidence `.omo/evidence/scope-and-policy-docs/task-8.txt`.
  Commit: Y | `docs(ai): document the llm prompt as composed today`
  Recommended task executor category: deep-low - tracing one pipeline across packages.

- [x] 9. Write the state persistence policy
  What to do: Create `docs/ai/context/state-persistence.md` (header as in todo 6). Sections: `## Choosing a tier` (the rule, copied from `docs/ai/adr/2026-11-01-persistence-tiers.md` and updated to today); `## Members` (one row per persisting store found in code: store, key or database, tier, writer (leader or any window), registered in `useDataMaintenance`? yes/no); `## Settings documents` (which tier-1 stores use `useSettingsDocument` and which still hand-roll the same code); `## Named exceptions`; `## Known gaps` (each unregistered store or store outside the table).
  Must NOT do: migrate stores; register stores in `useDataMaintenance`.
  Closes: GAP-4 (state)
  Parallelization: Wave 2 | Blocked by: - | Blocks: 10, 12
  References: `docs/ai/adr/2026-11-01-persistence-tiers.md`, `2026-11-03-layered-character-state.md`, `2026-10-30-long-term-memory-adoption.md`, `2026-10-29-unprompted-reach-out-cadence.md` (inner state); `packages/stage-ui/src/composables/use-data-maintenance.ts`; `packages/stage-shared/src/composables/use-settings-document/index.ts`; members found with `git grep -nE 'useLocalStorageManualReset|useLocalStorage\(|useSettingsDocument|localforage|createStorage' -- 'packages/*/src' 'apps/stage-tamagotchi/src' 'apps/stage-web/src' ':!*.test.ts'`; feature settings stores in `packages/stage-ui/src/features/*/settings.ts`, `packages/stage-ui/src/stores/settings/`, `packages/stage-ui-live2d/src/composables/live2d/natural-settings.ts`, `packages/stage-ui-mmd/src/stores/natural-settings.ts`.
  Acceptance criteria: every grep hit maps to a Members row or a stated non-persisting use; link check exits 0; `pnpm verify` passes.
  QA scenarios: happy - count grep hits and Members rows and record the mapping; failure - pick two rows marked registered and confirm each with `git grep` in `use-data-maintenance.ts`; a wrong mark fails the todo. Evidence `.omo/evidence/scope-and-policy-docs/task-9.txt`.
  Commit: Y | `docs(ai): document where client state lives and how to pick a tier`
  Recommended task executor category: unspecified-low - inventory work with a fixed table.

- [x] 10. Point every related ADR at its current-rules document
  What to do: Append ` Current rules: [Body ownership](../context/body-ownership.md).` (titles: Body ownership, Autonomous behavior, LLM prompt, State persistence; files as in the mapping) to the `Status:` line of each ADR below (several docs separated by commas). For `2026-11-08-host-capability-contract.md` and `2026-11-09-linux-desktop-bridge.md`, which have no `Status:` line, add none. Mapping:
  - body-ownership: `2026-10-17-natural-motion-v2-performance-state`, `2026-10-18-expression-performance`, `2026-10-18-live2d-touch-interaction`, `2026-10-19-natural-emotion-revamp`, `2026-10-24-expression-auto-setup`, `2026-10-24-expression-combos-and-reactions`, `2026-10-24-live2d-cursor-attention`, `2026-10-25-natural-idle-reshape-and-emotion-ducking`, `2026-10-26-natural-screen-aware-attention`, `2026-10-30-3d-character-motion`, `2026-11-03-mmd-clip-actions`, `2026-11-04-interaction-portability`, `2026-11-11-whole-body-performer`, `2026-11-12-idle-agency`
  - autonomous-behavior: `2026-10-19-situational-presence`, `2026-10-29-unprompted-reach-out-cadence`, `2026-11-12-idle-agency`, `2026-11-03-layered-character-state`, `2026-10-24-expression-combos-and-reactions`, `2026-10-31-fullscreen-stage-and-locomotion`, `2026-11-03-mmd-clip-actions`
  - llm-prompt: `2026-11-01-prompt-composition`, `2026-10-31-reply-shape-contract`, `2026-10-31-nonverbal-channels`, `2026-10-30-long-term-memory-adoption`, `2026-10-19-situational-presence`
  - state-persistence: `2026-11-01-persistence-tiers`, `2026-11-03-layered-character-state`, `2026-10-30-long-term-memory-adoption`, `2026-10-29-unprompted-reach-out-cadence`
  Must NOT do: edit ADR bodies; edit the 8 upstream ADRs moved from `docs/assets/ai/adr/`.
  Closes: GAP-7
  Parallelization: Wave 3 | Blocked by: 3, 6, 7, 8, 9 | Blocks: F1-F4
  References: the ADR list in `docs/ai/adr/`; Status lines start with `Status:` near the top (line 3-8).
  Acceptance criteria: `git diff main...HEAD -- docs/ai/adr | grep '^[-+][^-+]' | grep -v 'Status:' | grep -v -E '\]\(\.\./'` prints nothing (only Status lines and path-only link fixes changed); each mapped ADR's Status line contains every mapped link; link check exits 0; `pnpm verify` passes.
  QA scenarios: happy - count ADRs with `Current rules:` equals the 23 distinct mapped ADRs; failure - the body-diff check above prints nothing (any other changed line fails). Evidence `.omo/evidence/scope-and-policy-docs/task-10.txt`.
  Commit: Y | `docs(ai): point accepted adrs at the current policy docs`
  Recommended task executor category: quick - fixed edits to one line per file.

- [x] 11. Route agents to the support scope and policy docs
  What to do: In root `AGENTS.md`: (a) under CONVENTIONS add "Change only Supported projects for fork work. Carried projects stay as upstream ships them; fix them only to keep the workspace building. See `README.md#support-scope`."; (b) add a convention: "The policy docs in `docs/ai/context/` are the current rules. When a change alters a rule they state, update the doc in the same commit. ADRs are history; do not edit their bodies."; (c) add TASK ROUTING rows: body or motion ownership -> `docs/ai/context/body-ownership.md`; anything the character does unasked -> `docs/ai/context/autonomous-behavior.md`; prompt or LLM-facing text -> `docs/ai/context/llm-prompt.md`; new persisted state or settings store -> `docs/ai/context/state-persistence.md`; domain terms -> `docs/ai/context/glossary.md`; (d) replace the "Put project/client ADRs in `docs/ai/adr/`" line to also say reference docs go in `docs/ai/context/`. (e) remove or rewrite every agent-guidance mention of retired paths: `AGENTS.md` line "Reuse existing animations in `apps/stage-web/src/styles`" (point it at `apps/stage-tamagotchi/src/renderer/styles`, which holds `main.css`, `transitions.css`, and `vue-transitions.css`), the `pnpm dev | dev:tamagotchi` command line (match the scripts todo 15 leaves), the root `vitest.config.ts` projects sentence (drop `telegram-bot` and `twitter-services`), the MediaPipe entry in "Explicit contract exceptions", the web layout path in the settings-route rule (keep `packages/stage-layouts` only if `apps/stage-tamagotchi` still uses it, which it does), the NOTES line on mobile browser layouts; `.agents/skills/enforce-rules-for-unocss/SKILL.md:30-31`; `.agents/skills/use-agent-browser-for-airi/SKILL.md` and its `references/web.md` and `references/mobile.md` (delete the two references and the stage-web lines); `.github/copilot-instructions.md` if it names the web app. Keep `AGENTS.md` short, per its own AGENTS.md POLICY.
  Must NOT do: add overviews or directory trees; edit nested `AGENTS.md` beyond path fixes already done in todo 3.
  Closes: GAP-1 (agent side), GAP-4 (discoverability)
  Parallelization: Wave 3 | Blocked by: 1, 3, 6, 7, 8, 9, 13, 14, 15 | Blocks: F1-F4
  References: `AGENTS.md` sections CONVENTIONS, TASK ROUTING, AGENTS.md POLICY; `README.md` `## Support scope` (todo 1).
  Acceptance criteria: link check exits 0 on `AGENTS.md`; `git grep -c 'docs/ai/context/' AGENTS.md` is at least 5; `git grep -n -E 'stage-web|model-driver-mediapipe|telegram-bot|twitter-services|satori-bot|bilibili-laplace' -- AGENTS.md '.agents/**' '.github/copilot-instructions.md' '**/AGENTS.md'` prints nothing; `pnpm verify` passes.
  QA scenarios: happy - the link check resolves the `README.md#support-scope` anchor to a heading (`grep '^## Support scope' README.md`); failure - confirm no routing row points at a missing file (link check exit 1 otherwise). Evidence `.omo/evidence/scope-and-policy-docs/task-11.txt`.
  Commit: Y | `chore(agents): route agents to the support scope and policy docs`
  Recommended task executor category: quick - a few lines in one file.

- [x] 12. Close the glossary over the policy docs
  What to do: Collect every domain term used in the four policy docs (bold terms, table column values naming deciders, segment names, tiers). Each must have a heading in `docs/ai/context/glossary.md`; add missing ones with the same fields as todo 4. Link the first use of each glossary term in each policy doc to `glossary.md#<anchor>`.
  Must NOT do: rename terms in code.
  Closes: GAP-5 (closure)
  Parallelization: Wave 3 | Blocked by: 4, 6, 7, 8, 9 | Blocks: F1-F4
  References: the four policy docs and the glossary.
  Acceptance criteria: link check exits 0 over the five docs (anchors included); a scratch list of terms from the policy docs has zero entries without a glossary heading; `pnpm verify` passes.
  QA scenarios: happy - record the term list and its glossary match; failure - break one anchor in a scratch copy and confirm the link check reports it. Evidence `.omo/evidence/scope-and-policy-docs/task-12.txt`.
  Commit: Y | `docs(ai): link the policy docs to the glossary`
  Recommended task executor category: quick - cross-reference pass.

- [x] 13. Retire the Telegram, Satori, and Bilibili integrations
  What to do: `git rm -r integrations/telegram-bot integrations/satori-bot plugins/airi-plugin-bilibili-laplace`. Remove the `telegram-bot` inline project from root `vitest.config.ts` (the block with `name: 'telegram-bot'`, currently lines 97-102) and the `'integrations/telegram-bot/vitest.config.ts'` entry from `scripts/dev-tools/test-run-plan.ts:50`. Run `pnpm install` once to update `pnpm-lock.yaml`.
  Must NOT do: edit `packages/server-runtime/src/middlewares/route.test.ts` (it uses "telegram-bot" only as a sample peer name); edit `packages/stage-shared/src/situation/window-title.ts` (its `'telegram': 'chat'` classifies the desktop Telegram app); edit `packages/plugin-protocol/src/types/events.ts` (doc example); edit ADRs or audits; edit agent guidance (todo 11).
  Closes: GAP-8 (part)
  Parallelization: Wave 1 | Blocked by: - | Blocks: 14, 1, 2, 11
  References: `vitest.config.ts:97-108`, `scripts/dev-tools/test-run-plan.ts:50` and its test `scripts/dev-tools/test-run-plan.test.ts`, `pnpm-workspace.yaml:22-23` (the `plugins/**` and `integrations/**` globs stay).
  Acceptance criteria: `git ls-files integrations/telegram-bot integrations/satori-bot plugins/airi-plugin-bilibili-laplace` prints nothing; `git grep -n -E 'integrations/(telegram-bot|satori-bot)|bilibili-laplace' -- ':!.omo' ':!docs/ai/adr' ':!docs/ai/audits' ':!pnpm-lock.yaml' ':!AGENTS.md' ':!.agents'` prints nothing; `pnpm install --frozen-lockfile` passes after the lockfile commit; `pnpm verify` passes.
  QA scenarios: happy - `pnpm exec vitest run --project dev-tools scripts/dev-tools/test-run-plan.test.ts` passes; failure - `pnpm exec vitest list --project telegram-bot` reports no such project. Evidence `.omo/evidence/scope-and-policy-docs/task-13.txt`.
  Commit: Y | `chore: retire the telegram, satori, and bilibili integrations`
  Recommended task executor category: quick - directory removals and two config entries.

- [x] 14. Retire the Twitter integration and the in-app X module
  What to do: `git rm -r integrations/twitter-services`; remove the `twitter-services` inline project from root `vitest.config.ts`. In stage-ui and stage-pages delete `packages/stage-ui/src/components/modules/X.vue`, `packages/stage-ui/src/stores/modules/twitter.ts`, `packages/stage-pages/src/pages/settings/modules/x.vue`, and remove their uses in `packages/stage-ui/src/components/modules/index.ts`, `packages/stage-ui/src/stores/modules/index.ts`, `packages/stage-ui/src/composables/use-modules-list.ts` (the `id: 'x'` entry), `packages/stage-ui/src/composables/use-data-maintenance.ts` (the twitter store reset) and `packages/stage-ui/src/composables/use-data-maintenance.browser.test.ts` (only the assertions about the twitter store and its keys), and `apps/stage-web/index.html` is removed by todo 15 (skip it). Remove the English strings under the X module's i18n keys in `packages/i18n/src/locales/en/` (find them with `git grep -n 'modules.x'` and the YAML path `pages.modules.x`); do not edit other locales. Run `pnpm install` if the lockfile changes.
  Must NOT do: touch other modules (Discord stays); add a migration for the old `settings/twitter/*` localStorage keys (no compatibility guards).
  Closes: GAP-8 (part)
  Parallelization: Wave 1 | Blocked by: 13 (both edit `vitest.config.ts`) | Blocks: 1, 2, 11
  References: files listed above; `vitest.config.ts:104-108`; `packages/stage-ui/src/stores/modules/index.ts`; settings home generated from route meta in `packages/stage-pages/src/pages/settings/index.vue` and `apps/stage-tamagotchi/src/renderer/pages/settings/index.vue`.
  Acceptance criteria: `git grep -n -iE 'twitter|useTwitterStore|modules/X\b' -- packages apps ':!packages/i18n/src/locales/[!e]*' ':!*.md'` prints nothing except unrelated matches recorded with a reason; `pnpm -F @proj-airi/stage-ui typecheck`, `pnpm -F @proj-airi/stage-pages typecheck` and `pnpm verify` pass.
  QA scenarios: happy - `pnpm exec vitest run packages/stage-ui/src/composables/use-data-maintenance.browser.test.ts` passes; failure - in the running desktop app (`pnpm qa:display run -- pnpm qa:smoke` plus an `airi_eval` of `location.hash = '#/settings/modules/x'`), the X page no longer resolves and Settings > Modules lists no X entry (screenshot). Evidence `.omo/evidence/scope-and-policy-docs/task-14.txt`.
  Commit: Y | `chore: retire the twitter integration and the x module`
  Recommended task executor category: unspecified-low - contained removal across two packages.

- [x] 15. Retire the web app and the face-tracking package it alone used
  What to do: `git rm -r apps/stage-web packages/model-driver-mediapipe`; remove `.gitignore:120` (`packages/model-driver-mediapipe/tasks/assets/*`). Root `package.json`: delete `dev:web`, `dev:web:https`, and `build:web`; change `dev` to `node scripts/dev.mjs apps/stage-tamagotchi dev` (the same command as `dev:tamagotchi`, which stays). `scripts/dev.mjs:7`: change the example to `apps/stage-tamagotchi`. `packages/qa-tools/src/env/setup.ts:15`: install Cubism Core for `stage-tamagotchi` only; `packages/qa-tools/src/env/doctor.ts:98` and `:236`: drop the stage-web path and say "for stage-tamagotchi"; update `doctor.test.ts:13` and `setup.test.ts:33-46` to match. `DESIGN.md:13` and `apps/stage-tamagotchi/README.md:4`: drop the stage-web mentions. Run `pnpm install` once to update the lockfile.
  Must NOT do: edit the 18 `isStageWeb()` call sites or any shared-package branch for the browser; edit `apps/stage-tamagotchi/src/renderer/components/InteractiveArea.browser.test.ts` (its "stage-web send" case tests a shared synchronized-chat path, not the app); edit ADRs, audits, or `docs/ai/audits/ui-components.csv` (history); edit agent guidance (todo 11).
  Closes: GAP-8 (part)
  Parallelization: Wave 1 | Blocked by: - | Blocks: 1, 2, 11
  References: `package.json:16-19,27`; `scripts/dev.mjs:7`; `packages/qa-tools/src/env/{doctor,setup}.ts` and tests; `.gitignore:120`; `DESIGN.md:13`; `apps/stage-tamagotchi/README.md:4`; the only workspace depending on `@proj-airi/model-driver-mediapipe` is `apps/stage-web/package.json`.
  Acceptance criteria: `git ls-files apps/stage-web packages/model-driver-mediapipe` prints nothing; `git grep -n -E 'apps/stage-web|stage-web|model-driver-mediapipe' -- ':!.omo' ':!docs/ai/adr' ':!docs/ai/audits' ':!pnpm-lock.yaml' ':!AGENTS.md' ':!.agents' ':!.github/copilot-instructions.md'` prints only shared-code matches covered by Must NOT do (record each with its reason); `pnpm exec vitest run packages/qa-tools/src/env` passes; `pnpm typecheck` and `pnpm verify` pass.
  QA scenarios: happy - `AIRI_DEV_QUIET=1 pnpm qa:display run -- pnpm dev` prints the desktop app's ready line (Electron starts), then stop it; failure - `pnpm run dev:web` exits with "Missing script". Evidence `.omo/evidence/scope-and-policy-docs/task-15.txt`.
  Commit: Y | `chore: retire the web app and the mediapipe driver`
  Recommended task executor category: unspecified-low - app removal with root script and qa-tools path updates.

- [x] 16. Remove the web-only remains in testing-audio and the unused MediaPipe catalog entry
  What to do: Follow-up found while executing todo 15 (worker report, commit `38f441067`). `packages/testing-audio` lost its `audio-web` project because it served `apps/stage-web`; remove the now-dead web-target code (`src/runtimes/prepare-web.ts` and every `target === 'web'` branch, plus tests that cover only the web target) and update `packages/testing-audio/README.md`. Remove every `pnpm-workspace.yaml` catalog entry that no package.json uses (the `pnpm/yaml-no-unused-catalog-item` lint lists them; tasks-vision is one) in its own commit `chore: remove unused catalog entries`; this is the one allowed `pnpm-workspace.yaml` change. The stale `audio-web` lines in `packages/testing-audio/AGENTS.md` (lines 9, 25, 26) belong to todo 11.
  Must NOT do: change testing-audio's node or Electron targets; touch other catalog entries.
  Closes: GAP-8 (remainder)
  Parallelization: Wave 2 | Blocked by: 15 | Blocks: 2, 11
  References: `packages/testing-audio/` (`vitest.config.ts`, `package.json`, `src/runtimes/`), `pnpm-workspace.yaml` catalog, evidence `.omo/evidence/scope-and-policy-docs/task-15.txt`.
  Acceptance criteria: `git grep -n -E "prepare-web|'web'" -- packages/testing-audio/src` prints nothing that serves the web target; `git grep -n 'tasks-vision' -- ':!pnpm-lock.yaml' ':!.omo'` prints nothing; `pnpm install --frozen-lockfile` after `pnpm install` passes; `pnpm -F @proj-airi/testing-audio typecheck` and `pnpm verify` pass.
  QA scenarios: happy - `pnpm exec vitest run --project testing-audio:unit` passes; failure - `pnpm install --frozen-lockfile` fails before the lockfile commit and passes after (proves the catalog change landed in the lockfile). Evidence `.omo/evidence/scope-and-policy-docs/task-16.txt`.
  Commit: Y | `chore(testing-audio): remove the web target that served stage-web`
  Recommended task executor category: unspecified-low - contained removal in one package.

- [x] 17. Remove the last references to retired paths found by the final wave
  What to do: Follow-up from F4 (`.omo/evidence/scope-and-policy-docs-f4.md`). (a) `packages/qa-tools/docs/t2-spike.md` names the deleted `apps/stage-web/src/test/setup-live2d.browser.ts`: reword the line without the path, as commit `02893f329` did for the spike config. (b) `docs/ai/context/upstream-watch.md` has a revisit condition that names stage-web: reword it to the desktop app or drop the stage-web clause, keeping the entry's meaning. (c) Agent configuration, separate `chore(agents)` commit: `AGENTS.md` says "Carried" where README's Support scope says "Kept from upstream"; use "Kept from upstream". (d) From F1 (`.omo/evidence/scope-and-policy-docs-f1.md`, blocker B1): commit `30851bf86` un-exported `extraTestConfigs` in `scripts/dev-tools/verify-plan.ts`, which the root-wiring guardrail forbids. Restore `export` on that one declaration in its own commit `fix(dev-tools): keep extraTestConfigs exported under the root-wiring guardrail`, and change row 202 of `.omo/evidence/scope-and-policy-docs/knip-triage.md` from D2 to K4 citing the guardrail. (e) From F2 (`.omo/evidence/scope-and-policy-docs-f2.md`), blocker B1, in the docs commit: `.github/CONTRIBUTING.md` delete the `### Web (Stage Web)` section and drop "Telegram" from the Integrations sentence; `docs/ai/context/upstream-watch.md` Pocket entry delete "Mobile browser layouts remain supported by the web host." (this also covers (b)'s stage-web mention if it is the same entry; fix both); `DESIGN.md` describe the shared settings layout and the desktop app's layout without calling the shared one the web layout. (f) From F2 should-fix: delete the orphaned `// Packages without a Vitest config of their own.` comment in `vitest.config.ts` (allowed: removal left by retiring telegram/twitter projects) in the (d) commit; inline `isReleaseVersion` in `scripts/dev-tools/release-plan.ts` as a module-level regex const at its one call site (`refactor(dev-tools): inline the release version check`, run `pnpm exec vitest run --project dev-tools scripts/dev-tools/release-plan.test.ts`); make the five docs' "these rules win over ADRs" sentence identical; replace "on this branch"/"on this commit" wording in glossary.md, llm-prompt.md and state-persistence.md with timeless wording; remove the "Inventory coverage" process paragraph from state-persistence.md (keep any rule it states); README Support scope: "every path in the repository falls into one of three groups" becomes "every workspace project falls into one of three groups". The verified-against commit hashes stay as they are now; re-pinning them belongs to landing (a rebase merge rewrites hashes). (g) From F3 (`.omo/evidence/scope-and-policy-docs/f3.txt`): in `docs/ai/context/autonomous-behavior.md` replace the bare `gestures.ts` code span with the full path `packages/motion-driver-natural/src/gestures.ts` (docs commit). The two audit rows that name `apps/stage-web` stay: audit bodies are frozen history, the same as the audit rows on main for Pocket and Kirie.
  Must NOT do: edit ADR or audit bodies; change any code other than the one `export` keyword in (d).
  Closes: IS-7, IS-8 remainder, F1 B1
  Parallelization: after F3's gate run | Blocked by: - | Blocks: F1-F4 re-run of the affected checks
  References: F4 report; `git grep -n 'stage-web' -- ':!.omo' ':!docs/ai/adr' ':!docs/ai/audits' ':!pnpm-lock.yaml' ':!README.md'`.
  Acceptance criteria: `git grep -n 'apps/stage-web' -- ':!.omo' ':!docs/ai/adr' ':!docs/ai/audits' ':!pnpm-lock.yaml' ':!README.md'` prints nothing; any remaining `stage-web` match is a shared-code identifier (isStageWeb) listed with its reason; link check over edited files exits 0; `pnpm verify` exits 0.
  QA scenarios: happy - the grep above prints nothing; failure - reverting the t2-spike line in a /tmp copy makes the grep match. Evidence `.omo/evidence/scope-and-policy-docs/task-17.txt`.
  Commit: Y (3) | `docs: drop remaining references to retired paths`, `chore(agents): use the support-scope term kept from upstream`, and the (d) fix commit
  Recommended task executor category: quick - a few line edits.

- [x] 18. Fix the last doc lines the final re-check found
  What to do: From `.omo/evidence/scope-and-policy-docs-final-recheck.md`, one docs commit `docs: describe only the desktop target in the remaining lines`: (D1) `docs/ai/context/llm-prompt.md` "The callers in this branch are devtools and stress tools" -> "The callers are devtools and stress tools"; `docs/ai/context/body-ownership.md` "at this commit" -> timeless wording. (D2) `docs/ai/context/upstream-watch.md`, entry "Chat actions in the tab that has the Stage": Revisit when line becomes exactly "- **Revisit when:** A desktop window without a Stage can become the leader, more than one window mounts a Stage, or upstream settles which Stage tab speaks. Upstream's own review note says that with several Stage tabs, an arbitrary one speaks and a cancel can miss its turn." (D3) README.md apps-folder row description -> "The desktop app and upstream's component-calling demo"; README.md integrations row -> "Discord, Minecraft, and VS Code integrations inherited from upstream"; `.github/CONTRIBUTING.md` row "Web app, desktop app, packages" -> "Desktop app, packages". Confirm each line by grep before editing; change nothing else; no agent config, no ADR/audit bodies.
  Closes: IS-8 remainder, F2 B1 remainder
  Parallelization: after F3 re-run | Blocked by: 17 | Blocks: final re-check
  Acceptance criteria: `git grep -n -i -E 'this branch|this commit' -- docs/ai/context` prints nothing; `git grep -n -i -E 'telegram|web app|for desktop and web' -- README.md .github/CONTRIBUTING.md` prints only Retired-table rows of README (listed with reason) or nothing; link check over edited files has no MISSING new vs main; eslint on edited files 0; `pnpm verify` 0.
  QA scenarios: happy - greps above; failure - restoring one old line in a /tmp copy makes its grep match. Evidence `.omo/evidence/scope-and-policy-docs/task-18.txt`.
  Commit: Y | `docs: describe only the desktop target in the remaining lines`
  Recommended task executor category: quick - five line edits.

- [x] 19. Drop web-host descriptions from the shared package READMEs
  What to do: From `.omo/evidence/scope-and-policy-docs-final-recheck-2.md` (blocker D4), apply its exact per-line edits in `packages/stage-ui/README.md` (delete the `stage-web` Push to Talk row; delete the "Web applies...", "Web clients keep..." and "Web has no control..." sentences; "desktop and web composers" / "Web and Electron composers" -> "chat composers"; drop "as in stage-web") and `packages/stage-shared/README.md` (delete the "web host never writes it" sentence), keeping each surrounding paragraph grammatical. Commit `docs: drop web-host lines from shared package readmes`. Then, in a separate commit: `useStartupResourceTimeout` in stage-ui lost its only production caller (`apps/stage-web/src/App.vue`); confirm with `git grep -nw useStartupResourceTimeout` that only its own file, its test, and re-exports reference it, and remove the composable, its test and its re-exports: `refactor(stage-ui): remove the startup resource timeout that only the web app used`. Update any README line that documents it.
  Must NOT do: change shared code paths beyond removing that composable; touch isStageWeb() call sites; edit agent config, ADRs or audits.
  Closes: IS-8 remainder, F2 B1 remainder
  Parallelization: final | Blocked by: 18 | Blocks: F2, F4 re-check
  Acceptance criteria: `git grep -n -i -E 'stage[- ]web|web host|web app|web client' -- packages/*/README.md` prints nothing that describes a web host as present; `git grep -nw useStartupResourceTimeout` prints nothing; `pnpm -F @proj-airi/stage-ui typecheck` and `pnpm verify` exit 0; eslint on edited files 0.
  QA scenarios: happy - greps above; failure - restoring the README row in a /tmp copy makes the grep match. Evidence `.omo/evidence/scope-and-policy-docs/task-19.txt`.
  Commit: Y (2)
  Recommended task executor category: quick - README line edits plus one contained removal.

- [x] 20. Sweep every living doc for the web app described as present
  What to do: From `.omo/evidence/scope-and-policy-docs-final-recheck-3.md` (blocker D5), apply its six exact edits (stage-ui README lines on X-ASR/Paraformer, OPFS, the excluded page, the shells that create the store; vite-plugin-sherpaw README "Web keeps it remote..." after confirming it describes only a downloaded, not bundled, pack; stage-tamagotchi README "Web and Pocket exclude presence."). Then do your own exhaustive sweep so no further round is needed: read every hit of `git grep -n -E '\b(Web|web|browser|Pocket|mobile)\b' -- '*.md' ':!.omo' ':!docs/ai/adr' ':!docs/ai/audits' ':!packages/i18n' ':!pnpm-lock.yaml'` in README.md, AGENTS.md, DESIGN.md, .github, docs/ai/context, packages/*/README.md, packages/*/docs, apps/*/README.md, .agents/skills, and fix every sentence that presents the web app, mobile web, or Pocket as a current target (generic uses such as "web search", "Web Speech API", "browser tests", "Chromium" stay). Also remove the English string for `stage.startup.model-timeout` if `git grep -n 'startup.model-timeout'` shows no remaining user (English only; other locales frozen). Docs commit: `docs: describe only the desktop target across living docs`; i18n in its own commit `chore(i18n): drop the unused startup model timeout string`; agent configuration, if touched, in its own `chore(agents)` commit.
  Must NOT do: edit source code or source comments (shared-source comments naming the web host are a post-landing follow-up), ADR/audit bodies, or non-English locales.
  Closes: IS-8 remainder, F2 B1 remainder
  Parallelization: final, after F3 re-run 3 | Blocked by: 19 | Blocks: F2, F4
  Acceptance criteria: the reviewer's acceptance grep in final-recheck-3.md prints nothing; the sweep's hit list is saved with a keep/fix verdict per hit; eslint on edited files 0; `pnpm verify` 0.
  QA scenarios: happy - sweep table; failure - one restored line in a /tmp copy is caught by the grep. Evidence `.omo/evidence/scope-and-policy-docs/task-20.txt`.
  Commit: Y (2-3)
  Recommended task executor category: unspecified-low - sweep with judgement per hit.

- [x] 21. Fix the "both apps" lines that still count the web app
  What to do: From `.omo/evidence/scope-and-policy-docs-final-recheck-4.md` (blocker D6): `packages/qa-tools/README.md` "Download Cubism Core for both apps without opening a window." -> "Download Cubism Core for the desktop app without opening a window." (docs commit `docs(qa-tools): say cubism setup serves the desktop app`); `.agents/skills/motion-qa/SKILL.md` "it downloads Cubism Core into both apps without launching them." -> "it downloads Cubism Core into the desktop app without launching it." (`chore(agents): say cubism setup serves the desktop app`). Also run `git grep -n -i -E '\\b(both|two) (apps|hosts|stages|shells|clients|targets)\\b|web and (desktop|electron)|desktop and web|electron and web' -- '*.md' ':!.omo' ':!docs/ai/adr' ':!docs/ai/audits' ':!server'` and fix any other hit that counts the web app as present, in the matching commit.
  Must NOT do: source edits; ADR/audit bodies.
  Closes: IS-8 remainder
  Parallelization: final | Blocked by: 20 | Blocks: F2, F4
  Acceptance criteria: the grep above prints only lines that do not count a retired app (listed with reason) or nothing; eslint on edited files 0; `pnpm verify` 0.
  QA scenarios: happy - grep; failure - restored line in /tmp copy matches. Evidence `.omo/evidence/scope-and-policy-docs/task-21.txt`.
  Commit: Y (2)
  Recommended task executor category: quick.

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [x] F1. Plan compliance audit
  Every todo's acceptance criteria rerun from evidence; Must NOT have checked: the kept-path diff (`git diff --stat main...HEAD -- server integrations/discord-bot integrations/vscode plugins/airi-plugin-claude-code services/computer-use-mcp apps/component-calling packages/memory-pgvector packages/input-playstation-dualsense-5 packages/stage-pages/src/pages/v2 plugins/airi-plugin-web-extension integrations/minecraft engines/stage-tamagotchi-godot`) prints nothing; the Home Assistant and Artistry diff (`git diff --stat main...HEAD -- '*home-assistant*' '*artistry*' '*Artistry*'`) prints nothing; the root-wiring diff (`git diff main...HEAD -- pnpm-workspace.yaml turbo.json knip.json scripts/dev-tools/verify-plan.ts`) contains only removals of retired-path entries and the `@mediapipe/tasks-vision` catalog line, and the `vitest.config.ts`, `package.json`, and `scripts/dev-tools/test-run-plan.ts` diffs contain only the removals todos 13-15 name.
- [x] F2. Code quality review
  A reviewer who is not the executor reads the full branch diff: deletions are dead per the triage table, docs cite symbols not lines, prose follows root `AGENTS.md` UNIQUE STYLES.
- [x] F3. Real manual QA
  `pnpm verify --gate` exits 0; the scratch link check over `README.md`, `AGENTS.md`, `DESIGN.md`, `docs/ai/**/*.md`, `.agents/skills/**/*.md`, and every `packages/*/AGENTS.md` and `README.md` exits 0; the old-path check prints nothing; `pnpm qa:smoke` passes (proves the deletions left the app starting cleanly), run through `pnpm qa:display run --`.
- [x] F4. Ideal-state fidelity
  Check each IS row against the delivered branch 1:1 using the Success criteria table; a shortfall becomes a new numbered todo.

## Commit strategy
Branch `luke/docs/scope-and-policy-docs` from `main`; one pull request against `lschneiderny/airi` (never upstream); the fork rebase-merges, so every commit must pass `pnpm verify` on its own. Agent configuration (`AGENTS.md`, nested `AGENTS.md`, `.agents/skills/**`, `.github/copilot-instructions.md`) is only ever committed in its own `chore(agents): ...` commits (todos 3 and 11); between todos 13-15 and todo 11, agent guidance may name retired paths, which todo 11 fixes. Lockfile changes ride in the commit that caused them. Expected order: todo 13, todo 14, todo 15, todo 3 (two commits), todo 4, todo 1, todos 6-9, todo 5 (per package), todo 10, todo 12, todo 11. Commit messages follow Conventional Commits without gitmoji, lowercase imperative.

## Success criteria
> One row per IS row. The plan is complete only when every IS row has a delivering todo and a proving QA scenario; F4 checks the delivered behavior against these rows 1:1, and a shortfall becomes new `- [ ] N.` rows, never a note.
| IS | Delivering todo(s) | Proving QA scenario | Evidence |
| --- | --- | --- | --- |
| IS-1 | 1, 11 | todo 1 path-existence check; todo 11 anchor check | `.omo/evidence/scope-and-policy-docs/task-1.txt`, `task-11.txt` |
| IS-2 | 1, 5, F1 | kept-path and Home Assistant/Artistry diffs print nothing | `task-5.txt`, F1 evidence |
| IS-8 | 13, 14, 15, 11 | removal greps print nothing; `pnpm dev` starts Electron; `dev:web` is gone | `task-13.txt`, `task-14.txt`, `task-15.txt`, `task-11.txt` |
| IS-3 | 2, 5 | re-run triage shows zero D rows | `task-2.txt`, `task-5.txt` |
| IS-4 | 6, 7, 8, 9, 10 | per-doc symbol checks; ADR pointer count equals 23 | `task-6.txt` ... `task-10.txt` |
| IS-5 | 4, 12 | term list fully matched to glossary headings | `task-4.txt`, `task-12.txt` |
| IS-6 | 3 | `test ! -e docs/assets/ai`; history follows the moves | `task-3.txt` |
| IS-7 | 3, 10, 11, 12, F3 | repository-wide link check and old-path check | F3 evidence |
