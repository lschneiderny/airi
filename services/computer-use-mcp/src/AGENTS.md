# Computer-use runtime

## OVERVIEW
Execution state, MCP tools, OS transports, and provider projection. Score: 16. Follow the [package guide](../AGENTS.md).

## STRUCTURE
| Directory | Role |
| --- | --- |
| `server/` | Runtime wiring, descriptor-backed registration, approval responses, action execution |
| `workflows/` | Declarative steps, preparations, suspension/resume, terminal selection |
| `terminal/`, `runner/`, `executors/` | Local exec/PTY and remote X11 execution |
| `browser-dom/`, `accessibility/`, `display/` | Semantic observation, OS trees, coordinate transforms |
| `transcript/` | Durable interaction blocks, compaction, provider projection |
| `task-memory/`, `planning-orchestration/` | Bounded session state and untrusted plan guidance |
| `bin/`, `e2e/`, `utils/` | Entrypoints, integration probes, process/artifact helpers |

## WHERE TO LOOK
| Task | Location |
| --- | --- |
| Shared runtime dependencies | `server/runtime.ts`, `server/action-executor.ts` |
| Public tool contracts | `server/tool-descriptors/`, `server/register-tools.ts` |
| PTY grants and bindings | `server/register-pty.ts`, `state.ts`, `workflows/engine.ts` |
| Reroute payload meanings | `reroute-contract.ts`, `server/workflow-formatter.ts` |
| Terminal release evidence | `support-matrix.ts`, `terminal-release-gates.test.ts` |
| Provider message validity | `transcript/projector.ts`, `transcript/transcript.test.ts` |
| Action policy decisions | `policy.ts` (`evaluateActionPolicy`), `server/action-executor.ts` |
| Desktop click freshness | `server/desktop-grounding-actions.ts` (snapshots older than 5,000 ms are rejected) |
| Browser surface selection | `server/browser-surface.ts` (extension DOM bridge, then CDP; remote is unsuitable) |

## CONVENTIONS
- MCP schemas use the SDK's Zod contracts. Keep descriptor metadata aligned with registered tools.
- Desktop mutations use global logical coordinates, not Retina backing pixels.
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
