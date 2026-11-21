# Motion Driver Natural

Read `docs/ai/adr/2026-11-12-idle-agency.md` before changing the idle activity
layer (`src/idle-activities.ts`).

Every glance names a `GlanceSource` and goes through `NaturalGazeLayer.glance`;
rank a new caller in `GLANCE_PRIORITY` instead of adding a guard at the caller.
