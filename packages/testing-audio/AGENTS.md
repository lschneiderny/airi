# Audio Integration Testing Guide

## CONVENTIONS

- Cases import audio-aware `describe`, `it`, and `expect` from the local harness.
- Harness startup precedes ordered preflight callbacks.
- Case-specific configuration and UI operations stay under `cases/shared`, not harness internals.
- Process environment overrides package, stage-ui, and repository environment files.
- Wake-word cases use the wake-word model bundled with the Electron app.
- Wake detection routes to the matched character's session without selecting its card.
- Aborted ASR spans are neither completed transcription nor failed transcription.
- Wake-word fixtures regenerated with `scripts/generate-wake-word-fixtures.ts` require a passing `test:run` of the wake-word cases.

## ANTI-PATTERNS

- Do not hide Provider combinations inside a shared complete-pipeline preflight.
- Do not use Vitest Browser Mode. Fake microphones require case-specific Chromium process arguments.
- Do not weaken assertions after fixture generation. Correct phrases or pronunciations.
- Do not treat missing-credential skips as successful live Provider validation.

## CHECKS

- Build targets and run: `pnpm -F @proj-airi/testing-audio test:run`.
- Existing builds: `pnpm -F @proj-airi/testing-audio test:existing-builds`.
- Run only the app cases with `exec vitest run --project audio-electron` under this package filter.
- `*.audio.test.ts` and `*.audio.electron.test.ts` both run in the `audio-electron` project.
