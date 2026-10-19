# MediaPipe Motion Capture

## OVERVIEW
Experimental single-person motion capture for stage-web devtools. Score: 3, maintained for existing public-contract and backend requirements.

Parent guidance: [root AGENTS.md](../../AGENTS.md).

## WHERE TO LOOK
| Task | Location |
| --- | --- |
| Stage-facing contract | `src/types.ts` |
| Scheduler, dropped frames, partial merge | `src/engine.ts` |
| Tasks Vision backend | `src/backends/mediapipe.ts` |
| Debug overlay points and connectors | `src/utils/overlay.ts` |
| VRM pose conversion | `src/three/` |
| Model preparation | `tasks/prepare-tasks.ts` |
| Upstream API notes | `references/tasks-vision-api.md` |

## CONVENTIONS
- The pipeline converts camera frames into `PerceptionState`, then draws the overlay.
- Prefer pure functions where practical.
- This package overrides the root class preference. Use factories and closures for stateful modules.
- Use classes only to extend browser APIs or satisfy external library requirements.
- Stage consumers depend on `src/types.ts`.
- This package overrides the root backward-compatibility rule. New fields in `src/types.ts` must be optional.
- Keep MediaPipe backend execution under `src/backends/`.
- Keep upstream documentation and snippets under `references/`.
- The workshop uses single-person VIDEO mode and normalized landmarks.

## ANTI-PATTERNS
- The engine and scheduler must not import `@mediapipe/tasks-vision`.
- Synchronous `detectForVideo()` must not block the UI through unbounded work.
- Drop frames when the backend reports `isBusy()`.
- Cap task rates through scheduler `hz` settings.
- Do not return pose targets without required landmark visibility.

## CHECKS
- `pnpm -F @proj-airi/model-driver-mediapipe typecheck`
- Model preparation runs through the package `postinstall` script.
- Preserve the backend boundary when adding another capture implementation.
