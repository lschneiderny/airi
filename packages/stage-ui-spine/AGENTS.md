# Spine Guide

## CONVENTIONS

- Runtime loading supports Spine 4.0, 4.1, and 4.2 through lazy WebGL modules.
- Patch asset management before canvas construction can synchronously request assets.
- Archive loaders keep raw binary/text distinct from texture URLs.
- Call the ZIP loader's `dispose()` on unload and replacement to revoke Blob URLs.
- Idle uses track 0. One-shot emotions use track 1 and clean up completion listeners.
- Keep persistent renderer settings in their settings owner, not duplicate store refs.
- One-shot requests and loaded-model status are transient.

## ANTI-PATTERNS

- Do not persist `isModelLoaded`. Stored animation lists do not prove a live model exists.
- Do not round-trip ZIP binaries through naive data URIs.
- Keep binary backing buffers at zero offset until upstream BinaryInput honors offsets and lengths.
- Preserve the raw-GL blend branch while Spine 4.0 remains supported.
- Do not apply the original code's MIT license to Spine runtimes.
- Follow `LICENSE.md` for Editor-license requirements and redistributed runtime notices.

## CHECKS

- Check archive loading, version selection, replacement, and disposal in the consuming app after renderer changes.
