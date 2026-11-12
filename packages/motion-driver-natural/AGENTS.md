# Motion Driver Natural

This package owns the renderer-neutral Natural controller and pure motion layers.
Keep its source independent of Three.js, Vue, Pinia, three-mmd, and stage UI
packages. Preserve seeded stream indices, integration order, and numeric behavior.

The idle activity layer (`src/idle-activities.ts`) must stay inert without a
drive: no draw and no contribution, so traces and gates that never set one are
unchanged. Read `docs/ai/adr/2026-11-12-idle-agency.md` before changing it.
