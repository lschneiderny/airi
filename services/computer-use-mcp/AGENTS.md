# Computer-use MCP

## CONVENTIONS
- Keep provider-specific behavior in AIRI or `packages/stage-ui`.
- Read `terminal-lane-status.md` before terminal work. Update it with terminal behavior changes.
- Release gates live in `src/support-matrix.ts`. Only `product-supported` entries establish external support claims.

## ANTI-PATTERNS
- Do not touch desktop overlay, Electron bridge, Chrome extension, or MCP registration without explicit task scope.
- Workspace memory, verification gates, and shell guards also require explicit task scope.
- Keep planning, archive eligibility, compaction, provider emission, and runner semantics separate unless evidence requires crossing layers.
- Parser coverage does not prove valid provider messages. Test projectors when final message shape is the contract.
