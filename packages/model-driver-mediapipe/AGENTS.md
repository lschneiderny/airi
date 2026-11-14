# MediaPipe motion capture

## CONVENTIONS
- Prefer pure functions where practical.
- This package overrides the root class preference. Use factories and closures for stateful modules.
- Use classes only to extend browser APIs or satisfy external library requirements.
- Stage consumers depend on `src/types.ts`.
- This package overrides the root backward-compatibility rule. New fields in `src/types.ts` must be optional.
- Keep MediaPipe backend execution under `src/backends/`.
- Keep upstream documentation and snippets under `references/`.
- The workshop uses single-person VIDEO mode and normalized landmarks.
- Model preparation runs through the package `postinstall` script.

## ANTI-PATTERNS
- The engine and scheduler must not import `@mediapipe/tasks-vision`.
- Synchronous `detectForVideo()` must not block the UI through unbounded work.
- Drop frames when the backend reports `isBusy()`.
- Cap task rates through scheduler `hz` settings.
- Do not return pose targets without required landmark visibility.
- Preserve the backend boundary when adding another capture implementation.
