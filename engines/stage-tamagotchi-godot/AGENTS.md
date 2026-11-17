# GODOT STAGE ENGINE KNOWLEDGE BASE

## CONVENTIONS
- `StageMaterialOverlayOwner` owns overlay writes. `StageCompositorOwner` owns the camera compositor slot.

## ANTI-PATTERNS
- Do not rename vendored addon paths or edit `.gitrepo` metadata manually.
- Do not assign overlays or camera compositors outside their owners.
- Before vendored shader changes, establish that overlay and compositor stages cannot express the required behavior.
- Keep vendor patch records synchronized with local addon changes.
- Do not accept viewport texture readback as final visual evidence. Capture the visible window.
- Compare the same model, camera, viewport, and timing before the next renderer change.
- For edge-light work, obey every evidence gate in `docs/technical-art-workflow.md`.
