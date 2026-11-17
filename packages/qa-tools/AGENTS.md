# QA Tools Guide

- Live2D acceptance on ForBOOTH counts for Bear Pajama too (Luke, 2026-10-18; [motion QA levels ADR](../../docs/ai/adr/2026-10-20-motion-qa-levels.md)).
- A stage run that presses on the character locates her by opaque pixels with an alpha-qualified locator. A locator built from a composite screenshot reports false fall-throughs on transparent edge pixels (`.omo/plans/linux-sensor-parity.md`, todo 34).
- Rig, model, or core assets are not committed.
- Never skip, delete, or weaken a test to clear a failure.
