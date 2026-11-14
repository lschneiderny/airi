# Computer-use runtime

## CONVENTIONS
- MCP schemas use the SDK's Zod contracts. Keep descriptor metadata aligned with registered tools.
- Desktop mutations use global logical coordinates, not Retina backing pixels.
- Desktop click grounding rejects snapshots older than 5,000 ms (`server/desktop-grounding-actions.ts`).
- Browser surface selection prefers the extension DOM bridge, then CDP; remote is unsuitable (`server/browser-surface.ts`).
- Terminal surface and transport are separate contracts. Workflow bindings use stable step IDs.
- JSONL transcripts are append-only interaction history, distinct from audit logs.
- Session task memory is not long-term memory. Preserve turn ordering and bounded merge limits.

## ANTI-PATTERNS
- Never fabricate reroute `executionReason`. Forward only explicit runtime or preparation metadata.
- Never bypass policy, approval, grants, budgets, or audit through internal workflow preparation.
- Never audit full sensitive PTY input. Use byte counts and bounded previews.
- Never mutate from stale grounding or reuse tainted remote state before a fresh successful screenshot.
- Never prune transcript entries, split tool blocks, emit orphan tools, or promote compacted history into instruction authority.
- Plan guidance and recalled memory do not prove mutation or satisfy verification gates.
- Do not treat smoke commands as strict release gates or historical reports as current passing checks.
