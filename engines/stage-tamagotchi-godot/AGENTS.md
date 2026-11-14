# GODOT STAGE ENGINE KNOWLEDGE BASE

## CONVENTIONS
- The engine uses .NET 10 and explicit C# usings.
- C# uses four spaces, Allman braces, PascalCase members, and `_camelCase` private fields.
- Thin scene scripts delegate durable state and control flow to plain runtime objects.
- Transport boundaries use explicit payload types. Reflection belongs to startup discovery, not frame execution.
- Electron materializes VRM files. Godot owns imported nodes and resources.
- Current runtime import supports VRM 0.x, not the vendored VRM 1.0 extension set.
- Active view state ends with the sidecar process. The retained persistence store is not wired into this path.
- `StageMaterialOverlayOwner` owns overlay writes. `StageCompositorOwner` owns the camera compositor slot.

## COMMANDS
```sh
pnpm -F @proj-airi/stage-tamagotchi-godot dump:render-stages
pnpm -F @proj-airi/stage-tamagotchi-godot dump:render-stages:upper-body
```
After C# or `.editorconfig` changes, run `dotnet format --verify-no-changes` from this engine directory.

## ANTI-PATTERNS
- Do not put Electron host logic, AIRI orchestration, or adaptation-layer protocol definitions in this engine.
- Do not rename vendored addon paths or edit `.gitrepo` metadata manually.
- Do not assign overlays or camera compositors outside their owners.
- Before vendored shader changes, establish that overlay and compositor stages cannot express the required behavior.
- Keep vendor patch records synchronized with local addon changes.
- Do not use editor Run for Electron integration. It lacks the host WebSocket URL.
- Development requires an explicit `GODOT4` executable path.
- Do not commit local VRM fixtures or editor preview scene edits without an explicit repository fixture policy.
- Do not accept viewport texture readback as final visual evidence. Capture the visible window.
- Compare the same model, camera, viewport, and timing before the next renderer change.
- For edge-light work, obey every evidence gate in `docs/technical-art-workflow.md`.
- Do not infer nullable, namespace, record, or primary-constructor policy from formatting tools.
