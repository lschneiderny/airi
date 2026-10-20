# @proj-airi/qa-tools

## Purpose

Agent-executed QA tooling for AIRI. It resolves the repository's pinned pnpm without going through `.cmd` shims, and is the home for the preflight, known-failure, evidence, and motion QA tools that build on it.

## Usage

```ts
import { resolvePnpm, spawnPnpm } from './src/env/pnpm'

const { version, node, entry } = resolvePnpm({ repoRoot: process.cwd(), env: process.env })
const child = spawnPnpm(['-F', '@proj-airi/qa-tools', 'typecheck'], { cwd: process.cwd() })
```

- `resolvePnpm` finds `<PNPM_HOME>/.tools/pnpm/<version>/node_modules/pnpm/bin/pnpm.mjs` for the `packageManager` version in the root `package.json`. It falls back to `npm_execpath` only when that is a JS file of the same pnpm version, and otherwise throws an error naming the expected path. It never runs `corepack` or `pnpm self-update`.
- `resolveVitestEntry` returns the Vitest CLI file so callers spawn `node <entry>` directly.
- Tests: `pnpm -F @proj-airi/qa-tools exec vitest run --project node`.

### Doctor

Run `pnpm qa:doctor` from the repository root before a QA run. It reports, and never fixes, these checks in order: `node-version` (major.minor against `.tool-versions`), `pnpm`, `install`, `built-packages` (runtime `./dist/` exports of `packages/*` and a current `packages/i18n/dist`), `cubism-core`, `playwright` (Chromium), `rigs` (`AIRI_QA_RIG_FORBOOTH` / `AIRI_QA_RIG_BEAR`), and `stray-electron`.

- `--json` prints the rows `{ id, status, detail, fix }` as JSON.
- `--warm` also runs `packages/stage-ui/src/components/scenes/live2d-blink-ownership.browser.test.ts` once in the browser project. It reruns once only when the first run fails with `optimized dependencies changed`, and then reports `warm: ok after reload`.
- The exit code is 1 when any row is `fail`, 2 for unknown flags, and 0 otherwise. Each check is bounded by a 15 s timeout; a check that hangs becomes a `fail` row.
- `runDoctor(probes)` in `src/env/doctor.ts` takes injectable probes; `createSystemProbes(repoRoot)` supplies the real ones.

## Evidence

Run directories: `createRun({ tool, label, repoRoot })` from `src/evidence/run.ts` creates `.temp/qa/<YYYYMMDD-HHmmss>-<tool>-<label>/` (gitignored) and refuses to reuse an existing directory. The handle offers `path(name)` (rejects paths that leave the run dir), `addArtifact(relPath, kind)` (records sha256) and `finish({ exitCode, summary })`, which writes `run.json`: `runId`, `tool`, `label`, `gitSha`, `dirty`, `startedAt`, `endedAt`, `command`, `env` (only `APP_*` and `AIRI_QA_*` keys), optional `gate`, `artifacts` and `result`. `tool` and `label` accept letters, digits, `.`, `_` and `-` only.

Archiving: before a worktree is removed, copy its evidence into the main checkout:

```bash
pnpm -F @proj-airi/qa-tools run evidence archive --plan <slug> --from <worktree-path>
```

- The main checkout is the first entry of `git worktree list --porcelain`. `<worktree>/.omo/evidence/<slug>/` is copied to `<main>/.omo/evidence/<slug>/` through a staging dir, then renamed into place. The source is never modified or deleted.
- If a same-named file exists with different bytes, nothing is copied and the command exits 1 (conflicts are listed). Identical files are skipped, so re-running is safe.
- `manifest.json` in the destination lists every file with `sha256` and `bytes`, sorted by path; it is regenerated on each run and is identical when nothing changed.
- Exit codes: 0 archived, 1 refused or failed, 2 usage error. Evidence is never committed (`.omo/evidence/` is gitignored).

## When to use

- A QA script must spawn pnpm or Vitest reliably, for example while `PNPM_HOME` shims may be regenerated (exit 127).
- Running agent QA that needs the shared helpers in this package.

## When not to use

- Product code: nothing in the apps or runtime packages should depend on this package.
- Ordinary development; use `pnpm` directly.
