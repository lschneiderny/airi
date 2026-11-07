# Audio Integration Testing Guide

## OVERVIEW

Recorded microphone cases exercise real web and Electron audio pipelines. Score: 12. Distinct process-test boundary.
Follow the [root guide](../../AGENTS.md) for test skills and shared rules.

## WHERE TO LOOK

| Task | Location | Notes |
| --- | --- | --- |
| Harness API | `src/index.ts`, `src/describe.ts` | Audio-aware Vitest integration |
| Runtime startup | `src/runtimes/` | Web and Electron adapters |
| Instrumentation | `src/setup/` | Session, browser probe, pinned wake-word preparation |
| Assertions | `src/expect-extend.ts` | Transcript normalization and IO spans |
| Case configuration | `cases/shared/configurations/` | Ordered focused preflight callbacks |
| UI operations | `cases/shared/interactions/` | Case-selected actions |
| Provider builders | `cases/shared/providers/` | Explicit case credentials and endpoints |
| Wake-word fixtures | `scripts/generate-wake-word-fixtures.ts` | Regenerated audio requires both-host validation |

## CONVENTIONS

- Cases import audio-aware `describe`, `it`, and `expect` from the local harness.
- Harness startup precedes ordered preflight callbacks.
- Case-specific configuration and UI operations stay under `cases/shared`, not harness internals.
- Process environment overrides package, stage-ui, and repository environment files.
- Web wake-word cases use verified cached model artifacts. Electron uses its bundled model.
- Wake detection routes to the matched character's session without selecting its card.
- Aborted ASR spans are neither completed transcription nor failed transcription.

## ANTI-PATTERNS

- Do not hide Provider combinations inside a shared complete-pipeline preflight.
- Do not use Vitest Browser Mode. Fake microphones require case-specific Chromium process arguments.
- Do not weaken assertions after fixture generation. Correct phrases or pronunciations.
- Do not treat missing-credential skips as successful live Provider validation.

## CHECKS

- Build targets and run: `pnpm -F @proj-airi/testing-audio test:run`.
- Existing builds: `pnpm -F @proj-airi/testing-audio test:existing-builds`.
- Select one host with `exec vitest run --project audio-web` or `--project audio-electron` under this package filter.
- `*.audio.test.ts` runs on both hosts. `.audio.web.test.ts` and `.audio.electron.test.ts` select one.
- Typecheck: `pnpm -F @proj-airi/testing-audio typecheck`.
