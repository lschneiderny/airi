# GODOT STAGE ENGINE KNOWLEDGE BASE

## OVERVIEW
Desktop Godot C# sidecar with VRM import and stage-owned rendering. Score: 8, distinct engine project boundary.

Parent guidance: [root AGENTS.md](../../AGENTS.md). Its task-routing skills also apply here.

## STRUCTURE
```text
scenes/    Stage root and local editor preview
scripts/   Lifecycle, scene, transport, view, visuals, and VRM runtime
addons/    Vendored VRM and MToon integrations
assets/    Local engine assets and ignored research fixtures
docs/      Engine architecture and visual acceptance requirements
tests/     Executable C# checks and Godot verification scenes
tools/     Visible-window capture and render-stage export
```

## WHERE TO LOOK
| Task | Location | Notes |
| --- | --- | --- |
| C# architecture | `docs/csharp-development-method.md` | Scene, runtime, transport, discovery, tooling layers |
| C# formatting | `docs/csharp-style.md`, `.editorconfig` | Engine-local conventions |
| Runtime root | `scripts/StageRoot.cs`, `scenes/stage-root.tscn` | Host messages and controller lifecycle |
| Model import | `scripts/vrm/`, `scripts/scene/` | Detached import and atomic avatar replacement |
| View state | `scripts/view/` | Process-lifetime camera state |
| Render ownership | `scripts/visuals/StageRenderEffectsRuntime.cs` | Overlay and compositor owners |
| Visual evidence | `docs/technical-art-workflow.md` | Same-scene reference and intermediate-stage evidence |
| Import and vendor policy | `docs/vrm-runtime-import.md`, `docs/vendor-patches.md` | VRM 0.x boundary, patches, removal conditions |
| Live host debugging | `docs/live-debugging.md`, `README.md` | Electron-owned launch and remote debugger |
| Verification scenes | `docs/verification-scenes.md`, `tests/` | Reproducible fixture and frame gates |

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
pnpm -F @proj-airi/stage-tamagotchi-godot build
pnpm -F @proj-airi/stage-tamagotchi-godot typecheck
pnpm -F @proj-airi/stage-tamagotchi-godot test
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
