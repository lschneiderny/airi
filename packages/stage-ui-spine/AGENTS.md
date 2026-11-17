# Spine Guide

## CONVENTIONS

- Patch asset management before canvas construction can synchronously request assets.
- Archive loaders keep raw binary/text distinct from texture URLs.
- Keep persistent renderer settings in their settings owner, not duplicate store refs.
- One-shot requests and loaded-model status are transient.

## ANTI-PATTERNS

- Do not persist `isModelLoaded`. Stored animation lists do not prove a live model exists.
- Do not round-trip ZIP binaries through naive data URIs.
- Keep binary backing buffers at zero offset until upstream BinaryInput honors offsets and lengths.

## CHECKS

- Check archive loading, version selection, replacement, and disposal in the consuming app after renderer changes.
